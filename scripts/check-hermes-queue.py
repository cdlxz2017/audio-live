#!/usr/bin/env python3
"""
Quick check for pending Hermes memories in Redis queue + local fallback file.
Exit code: 0 = clean, 1 = pending entries found.

Usage:
    python3 check-hermes-queue.py
"""
import json
import os
import sys
from pathlib import Path

REDIS_QUEUE = "hermes:memory:pending"
LOCAL_FALLBACK = Path(
    os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))
) / "memory_fallback.jsonl"


def main():
    # Check Redis
    redis_count = 0
    try:
        import redis
        r = redis.Redis(host="localhost", port=6379, db=0, decode_responses=True)
        redis_count = r.llen(REDIS_QUEUE)
    except Exception as e:
        print(f"⚠️  Redis check failed: {e}")

    # Check local file
    file_count = 0
    if LOCAL_FALLBACK.exists():
        try:
            file_count = sum(
                1 for line in LOCAL_FALLBACK.read_text().strip().split("\n")
                if line.strip()
            )
        except Exception:
            pass

    total = redis_count + file_count
    if total > 0:
        parts = []
        if redis_count:
            parts.append(f"{redis_count} in Redis")
        if file_count:
            parts.append(f"{file_count} in local file")
        print(f"⚠️  {total} pending Hermes memories ({', '.join(parts)})")
        return 1
    else:
        print("✅ No pending Hermes memories")
        return 0


if __name__ == "__main__":
    sys.exit(main())
