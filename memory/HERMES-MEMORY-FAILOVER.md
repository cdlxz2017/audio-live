# Hermes Memory Failover System

**Implemented**: 2026-04-12
**Status**: ✅ Live & Tested

## Problem

When OpenClaw (玄枢) is down and the user connects directly to 玄一 (Hermes Server),
memory writes to PostgreSQL could fail silently. If PostgreSQL is also unreachable,
conversation memories are permanently lost.

## Solution: Three-Tier Failover Chain

```
                  ┌──────────────┐
  sync_turn() ──> │ PostgreSQL   │ ← Tier 1: Normal (direct write)
  write_memory()  └──────┬───────┘
                         │ FAIL
                         ▼
                  ┌──────────────┐
                  │ Redis Queue  │ ← Tier 2: Degraded (queue for later)
                  │ hermes:memory│
                  │ :pending     │
                  └──────┬───────┘
                         │ FAIL
                         ▼
                  ┌──────────────┐
                  │ Local JSONL  │ ← Tier 3: Last Resort (file on disk)
                  │ ~/.hermes/   │
                  │ memory_      │
                  │ fallback.jsonl│
                  └──────────────┘
```

## Files Modified/Created

| File | Change |
|------|--------|
| `plugins/memory/openclaw/openclaw_provider.py` | Added Redis fallback in `write_memory()`, `on_session_end()` |
| `scripts/hermes-memory-recovery.py` | Created — consumes Redis queue + local file → PG |
| `scripts/check-hermes-queue.py` | Created — quick check for pending entries |
| `HEARTBEAT.md` | Updated — added queue check instructions |

## How It Works

### 1. Normal Mode (Tier 1)
`write_memory()` writes directly to PostgreSQL as before. No changes to the happy path.

### 2. Degraded Mode (Tier 2)
If PostgreSQL write fails (connection error, auth error, etc.):
- Entry is serialized as JSON and pushed to Redis list `hermes:memory:pending`
- `write_memory()` returns `{"success": True, "fallback": "redis"}`
- Conversation continues without interruption

### 3. Emergency Mode (Tier 3)
If BOTH PostgreSQL AND Redis fail:
- Entry is appended to `~/.hermes/memory_fallback.jsonl`
- This file survives all service outages (only disk failure loses it)
- `write_memory()` returns `{"success": False, "fallback": "file"}`

### 4. Recovery
When OpenClaw restarts (or on heartbeat), the recovery script:
1. Pops entries from Redis queue (FIFO order preserved)
2. Generates embeddings via Ollama bge-m3
3. Writes to PostgreSQL with deduplication check
4. Then processes the local JSONL file the same way
5. Cleans up: removes consumed queue entries and the fallback file

## Usage

### Check queue status
```bash
python3 scripts/check-hermes-queue.py
# → ✅ No pending Hermes memories
# → ⚠️  3 pending in Redis + 1 in local file = 4 total

python3 scripts/hermes-memory-recovery.py --check
# Same but via the recovery script
```

### Run recovery
```bash
python3 scripts/hermes-memory-recovery.py
# Actually processes the queue

python3 scripts/hermes-memory-recovery.py --dry-run
# Show what would happen without writing
```

## Safety Guarantees

1. **Idempotent**: Recovery script checks for existing entries by (entity, attribute, timestamp).
   Running it multiple times won't create duplicates.

2. **No data loss**: If PG recovery fails mid-way, the failed entry is re-queued to Redis.
   If the file has unrecoverable entries, they stay in the file.

3. **FIFO ordering**: Redis LPUSH/LPOP preserves chronological order.

4. **Non-blocking**: All writes happen in background threads.
   Conversation latency is not affected.

5. **session_summary handling**: `on_session_end()` entries with `memory_type=session_summary`
   are routed to the `memory_summaries` table during recovery.

## Test Results (2026-04-12)

```
Test 1: Normal PG write           ✅ PASSED (id=1906644)
Test 2: PG fail → Redis fallback  ✅ PASSED (fallback=redis)
Test 3: Recovery Redis → PG       ✅ PASSED (1 entry recovered)
Test 4: Local file fallback       ✅ PASSED (file written + recovered)
Test 5: Dedup (re-run recovery)   ✅ PASSED (0 duplicates)
Test 6: Cleanup                   ✅ 3 test entries cleaned
```

## Redis Queue Schema

```json
{
  "content": "User: ...\nAssistant: ...",
  "memory_type": "event",
  "entity": "conversation",
  "attr": "turn",
  "session_id": "abc123",
  "timestamp": "2026-04-12T02:50:00.123456",
  "source": "hermes"
}
```

## Dependencies

- `redis` Python package (already installed: v7.4.0)
- `psycopg2` Python package (already installed)
- Redis server at localhost:6379 (running)
- PostgreSQL at localhost:5432 (independent of OpenClaw)
- Ollama at localhost:11434 (for bge-m3 embeddings during recovery)
