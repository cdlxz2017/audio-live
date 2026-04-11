# HERMES-PHASE0-STEP0-3: Plugin Discovery & Connectivity Validation

**Date:** 2026-04-12  
**Status:** ⚠️ PARTIAL — Connectivity validated, plugin loading FAILED

---

## 1. Plugin Discovery Mechanism

**Location:** `/home/ai/apps/hermes-agent/plugins/memory/__init__.py`

Hermes uses a plugin-based architecture for memory providers:

### How Plugins Are Discovered

1. `discover_memory_providers()` scans `plugins/memory/<name>/` directories within the hermes-agent repo
2. Each plugin directory must contain:
   - `__init__.py` — the entry point
   - Optional `plugin.yaml` — metadata (description, dependencies)
   - Optional `cli.py` — CLI commands

3. Loading is done via `_load_provider_from_dir()`:
   - First: look for a `register(ctx)` function and call it with a `_ProviderCollector`
   - Fallback: find any class extending `MemoryProvider` ABC and instantiate it

### Plugin Path Issue Found

**Critical:** Hermes looks in `/home/ai/apps/hermes-agent/plugins/memory/<name>/`  
**NOT** in `~/.hermes/plugins/memory/<name>/`

**Solution applied:** Created symlink:
```bash
ln -s ~/.hermes/plugins/memory/openclaw /home/ai/apps/hermes-agent/plugins/memory/openclaw
```

### Hermes CLI Commands for Memory Plugins

```bash
hermes plugins list              # List all plugins
hermes memory setup             # Interactive memory provider setup
hermes memory status            # Check memory provider status
```

---

## 2. PostgreSQL Connectivity Test

✅ **PASSED**

```
Connection: OK
Memories count: 1761
Query latency: 1.9ms
```

### Test Command (Python)
```python
import psycopg2
conn = psycopg2.connect(
    host='localhost', port=5432, database='openclaw_memory',
    user='openclaw_ai', password='zyxrcy910128'
)
cur = conn.cursor()
cur.execute("SELECT COUNT(*) FROM memories")
# Result: 1761 memories
```

---

## 3. Redis Connectivity Test

✅ **PASSED**

```
Response: PONG
Get/Set test: OK
```

### Test Command
```python
import redis
r = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)
r.ping()  # Returns True
r.set('hermes:test', 'hello')
r.get('hermes:test')  # Returns 'hello'
```

---

## 4. Recall Latency Measurement

✅ **PASSED** — Well under 150ms target

```
PostgreSQL COUNT(*) latency: 1.9ms
```

---

## 5. Plugin Loading Test

❌ **FAILED** — OpenClawProvider does NOT inherit from MemoryProvider ABC

```python
# Discovery result:
openclaw: available=False  # is_available() returns False

# Loading result:
Memory provider 'openclaw' loaded but no provider instance found
```

### Root Cause

`OpenClawProvider` class in `openclaw_provider.py` extends `object` only:

```python
# Current (WRONG):
class OpenClawProvider:
    """..."""
    # No MemoryProvider inheritance!

# Should be:
from agent.memory_provider import MemoryProvider

class OpenClawProvider(MemoryProvider):
    """..."""
    # Must implement all @abstractmethod methods
```

### Hermes MemoryProvider ABC Requirements

Abstract methods that MUST be implemented:
- `name` (property) — return "openclaw"
- `is_available()` — check DB connectivity
- `initialize(session_id, **kwargs)` — setup for session
- `get_tool_schemas()` — return list of tool definitions
- `sync_turn(user_content, assistant_content, *, session_id)` — persist turn
- `handle_tool_call(tool_name, args, **kwargs)` — dispatch tool calls

Optional hooks:
- `prefetch(query, *, session_id)` — background recall
- `system_prompt_block()` — static text for system prompt
- `shutdown()` — clean exit

---

## 6. Summary of Issues

| Component | Status | Notes |
|-----------|--------|-------|
| PostgreSQL | ✅ | 1761 memories, 1.9ms latency |
| Redis | ✅ | PONG, get/set works |
| Plugin Symlink | ✅ | Created to hermes-agent plugins dir |
| MemoryProvider ABC | ❌ | OpenClawProvider doesn't inherit it |
| Plugin Discovery | ⚠️ | Found but `is_available=False` |
| Plugin Loading | ❌ | No MemoryProvider subclass found |

---

## 7. Next Steps (Phase 1)

1. **Fix OpenClawProvider inheritance** — Make it extend `MemoryProvider` ABC
2. **Implement all abstract methods** — `name`, `is_available`, `initialize`, `get_tool_schemas`, `sync_turn`, `handle_tool_call`
3. **Implement optional methods** — `prefetch`, `system_prompt_block` for recall
4. **Test with `hermes memory setup`** — Set `memory.provider: openclaw` in config
5. **End-to-end test** — Run Hermes with OpenClaw memory provider active

---

## 8. Connection Config Reference

```python
PG_CONFIG = {
    "host": "localhost",
    "port": 5432,
    "database": "openclaw_memory",
    "user": "openclaw_ai",
    "password": "zyxrcy910128",
}

REDIS_CONFIG = {
    "host": "localhost",
    "port": 6379,
    "db": 0,
}

NEO4J_CONFIG = {
    "uri": "bolt://localhost:7687",
    "auth": ("neo4j", "openclaw_neo4j_2026"),
}
```
