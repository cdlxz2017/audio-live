#!/usr/bin/env python3
"""
Hermes Memory Recovery Script
==============================
Consume pending memories from the Redis failover queue
(`hermes:memory:pending`) and write them to PostgreSQL.

Safe to run multiple times — uses deduplication via
(entity, attribute, timestamp) to prevent duplicates.

Also processes the local JSONL fallback file if it exists.

Usage:
    python3 hermes-memory-recovery.py          # recover all
    python3 hermes-memory-recovery.py --check   # just report queue depth
    python3 hermes-memory-recovery.py --dry-run  # show what would be recovered
"""
from __future__ import annotations

import json
import logging
import os
import sys
import time
from pathlib import Path

# ── Hermes path setup ────────────────────────────────────────────────────────
HERMES_DIR = os.environ.get("HERMES_DIR", "/home/ai/apps/hermes-agent")
sys.path.insert(0, HERMES_DIR)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("hermes-recovery")

# ── Config ────────────────────────────────────────────────────────────────────
REDIS_QUEUE = "hermes:memory:pending"
LOCAL_FALLBACK = Path(
    os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))
) / "memory_fallback.jsonl"

PG_CONFIG = {
    "host": os.environ.get("OPENCLAW_PGHOST", "localhost"),
    "port": int(os.environ.get("OPENCLAW_PGPORT", "5432")),
    "database": os.environ.get("OPENCLAW_PGDATABASE", "openclaw_memory"),
    "user": os.environ.get("OPENCLAW_PGUSER", "openclaw_ai"),
    "password": os.environ.get("OPENCLAW_PGPASSWORD", "zyxrcy910128"),
}

OLLAMA_URL = os.environ.get("OPENCLAW_OLLAMA_URL", "http://localhost:11434")
EMBED_MODEL = os.environ.get("OPENCLAW_EMBED_MODEL", "bge-m3:latest")


# ── Helpers ───────────────────────────────────────────────────────────────────

def get_redis():
    import redis
    return redis.Redis(host="localhost", port=6379, db=0, decode_responses=True)


def get_pg():
    import psycopg2
    return psycopg2.connect(**PG_CONFIG)


def get_embedding(text: str) -> list[float] | None:
    """Generate embedding via Ollama bge-m3."""
    try:
        import urllib.request
        req_data = json.dumps({"model": EMBED_MODEL, "prompt": text}).encode()
        req = urllib.request.Request(
            f"{OLLAMA_URL}/api/embeddings",
            data=req_data,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read())
        emb = result.get("embedding", [])
        return emb if emb else None
    except Exception as e:
        log.warning(f"Embedding generation failed: {e}")
        return None


def entry_exists(cur, entity: str, attr: str, timestamp: str) -> bool:
    """Check if a memory with the same entity+attr+timestamp already exists."""
    cur.execute("""
        SELECT 1 FROM memories
        WHERE entity = %s AND attribute = %s AND value LIKE %s
        LIMIT 1
    """, (entity, attr, f"%{timestamp[:19]}%"))
    return cur.fetchone() is not None


def write_entry_to_pg(conn, entry: dict, dry_run: bool = False) -> bool:
    """
    Write a single recovered entry to PostgreSQL.
    Returns True if written (or would be written in dry-run), False if skipped.
    """
    content = entry.get("content", "")
    memory_type = entry.get("memory_type", "event")
    entity = entry.get("entity", "conversation")
    attr = entry.get("attr", "turn")
    timestamp = entry.get("timestamp", "")
    source = entry.get("source", "hermes_recovered")

    # Handle session_summary type — write to memory_summaries instead
    if memory_type == "session_summary":
        return write_summary_to_pg(conn, entry, dry_run)

    cur = conn.cursor()

    # Deduplication check
    if entry_exists(cur, entity, attr, timestamp):
        log.debug(f"  SKIP (duplicate): {entity}/{attr} @ {timestamp[:19]}")
        cur.close()
        return False

    if dry_run:
        log.info(f"  DRY-RUN would write: {entity}/{attr} [{memory_type}] @ {timestamp[:19]}")
        cur.close()
        return True

    # Generate embedding
    embedding = get_embedding(content)
    vec_str = "[" + ",".join(map(str, embedding)) + "]" if embedding else None

    cur.execute("""
        INSERT INTO memories (entity, attribute, value, raw_text, memory_type, embedding, source)
        VALUES (%s, %s, %s, %s, %s, %s::vector, %s)
    """, (entity, attr, content, content, memory_type, vec_str, source))

    conn.commit()
    cur.close()
    return True


def write_summary_to_pg(conn, entry: dict, dry_run: bool = False) -> bool:
    """Write a recovered session summary to memory_summaries."""
    content = entry.get("content", "")
    if dry_run:
        log.info(f"  DRY-RUN would write summary: {content[:60]}...")
        return True

    cur = conn.cursor()
    embedding = get_embedding(content)
    vec_str = "[" + ",".join(map(str, embedding)) + "]" if embedding else None

    cur.execute("""
        INSERT INTO memory_summaries (content, summary_type, embedding)
        VALUES (%s, %s, %s::vector)
    """, (content[:2000], "session", vec_str))
    conn.commit()
    cur.close()
    return True


# ── Main recovery flows ──────────────────────────────────────────────────────

def recover_from_redis(dry_run: bool = False) -> int:
    """Consume entries from Redis queue, write to PostgreSQL."""
    r = get_redis()
    queue_len = r.llen(REDIS_QUEUE)
    if queue_len == 0:
        log.info("Redis queue empty — nothing to recover")
        return 0

    log.info(f"Redis queue has {queue_len} pending entries")

    conn = get_pg()
    recovered = 0
    skipped = 0
    failed = 0

    for _ in range(queue_len):
        # Use LPOP (non-blocking) to consume one at a time
        raw = r.lpop(REDIS_QUEUE)
        if raw is None:
            break

        try:
            entry = json.loads(raw)
            if write_entry_to_pg(conn, entry, dry_run=dry_run):
                recovered += 1
            else:
                skipped += 1
        except Exception as e:
            log.error(f"Failed to recover entry: {e}")
            # Re-queue the failed entry at the end
            r.rpush(REDIS_QUEUE, raw)
            failed += 1
            if failed >= 3:
                log.error("Too many consecutive failures, stopping")
                break

    conn.close()
    log.info(f"Redis recovery: {recovered} written, {skipped} skipped (dup), {failed} failed")
    return recovered


def recover_from_file(dry_run: bool = False) -> int:
    """Process the local JSONL fallback file."""
    if not LOCAL_FALLBACK.exists():
        return 0

    lines = LOCAL_FALLBACK.read_text(encoding="utf-8").strip().split("\n")
    if not lines or lines == [""]:
        return 0

    log.info(f"Local fallback file has {len(lines)} entries")

    conn = get_pg()
    recovered = 0
    skipped = 0
    failed_lines = []

    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
            if write_entry_to_pg(conn, entry, dry_run=dry_run):
                recovered += 1
            else:
                skipped += 1
        except Exception as e:
            log.error(f"Failed to recover file entry: {e}")
            failed_lines.append(line)

    conn.close()

    if not dry_run:
        if failed_lines:
            # Rewrite file with only failed entries
            LOCAL_FALLBACK.write_text(
                "\n".join(failed_lines) + "\n", encoding="utf-8"
            )
            log.warning(f"Kept {len(failed_lines)} failed entries in {LOCAL_FALLBACK}")
        else:
            # All recovered — remove the file
            LOCAL_FALLBACK.unlink()
            log.info(f"Removed fully-recovered fallback file: {LOCAL_FALLBACK}")

    log.info(f"File recovery: {recovered} written, {skipped} skipped (dup), {len(failed_lines)} failed")
    return recovered


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Hermes Memory Recovery")
    parser.add_argument("--check", action="store_true", help="Just report queue depth")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be recovered")
    args = parser.parse_args()

    if args.check:
        r = get_redis()
        count = r.llen(REDIS_QUEUE)
        file_count = 0
        if LOCAL_FALLBACK.exists():
            file_count = sum(1 for line in LOCAL_FALLBACK.read_text().strip().split("\n") if line.strip())
        total = count + file_count
        if total > 0:
            print(f"⚠️  {count} pending in Redis + {file_count} in local file = {total} total")
            sys.exit(1)
        else:
            print("✅ No pending memories")
            sys.exit(0)

    start = time.time()
    log.info("=" * 60)
    log.info("Hermes Memory Recovery starting")
    log.info("=" * 60)

    total = 0
    total += recover_from_redis(dry_run=args.dry_run)
    total += recover_from_file(dry_run=args.dry_run)

    elapsed = time.time() - start
    log.info(f"Recovery complete: {total} entries processed in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
