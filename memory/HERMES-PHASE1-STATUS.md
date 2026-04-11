# HERMES Phase 1 Status Report
**Updated:** 2026-04-12  
**Executed by:** 玄枢 (Phase 1 subagent)  
**Status:** ✅ COMPLETE

---

## Executive Summary

Phase 1 is fully operational. Hermes agent is integrated with OpenClaw memory and running on MiniMax M2.7-highspeed LLM. The full pipeline — user query → Hermes CLI → recall_memories tool → OpenClaw pgvector → MiniMax response — has been validated end-to-end.

---

## Phase 1 Completion Checklist

| Step | Task | Status | Notes |
|------|------|--------|-------|
| 1.1 | Enhance OpenClaw memory provider plugin | ✅ Done | All hooks implemented |
| 1.2 | Configure Hermes to use MiniMax LLM | ✅ Done | ~/.hermes/.env + config.yaml |
| 1.3 | Serial dispatch router (OpenClaw side) | ✅ Done | hermes-router skill created |
| 1.4 | Hermes uses openclaw memory provider | ✅ Done | config.yaml: memory.provider: openclaw |
| 1.5 | End-to-end validation | ✅ Done | Hermes called recall_memories, got real data |

---

## Step 1.1: Plugin Enhancements

**File:** `/home/ai/apps/hermes-agent/plugins/memory/openclaw/openclaw_provider.py`  
**Version:** 1.0.0 (upgraded from 0.4.0)

### Methods Implemented

All MemoryProvider ABC methods are now complete:

| Method | Status | Description |
|--------|--------|-------------|
| `initialize()` | ✅ | Session init, warm-up stats check |
| `is_available()` | ✅ | PostgreSQL connectivity check |
| `system_prompt_block()` | ✅ | Injects memory counts into system prompt |
| `prefetch()` | ✅ | Vector recall before each turn |
| `sync_turn()` | ✅ | Background thread writes conversation turns |
| `get_tool_schemas()` | ✅ | 4 tools: recall, search, write, stats |
| `handle_tool_call()` | ✅ | Full dispatch for all 4 tools |
| `on_session_end()` | ✅ | **NEW** — saves session summary to memory_summaries |
| `on_memory_write()` | ✅ | **NEW** — mirrors Hermes built-in writes to OpenClaw |
| `on_pre_compress()` | ✅ | **NEW** — extraction before context compression |
| `shutdown()` | ✅ | Clean teardown |

### Validation Test Results

```
recall_memories:    3 results in 89ms  ✅ (target: <150ms)
write_memory:       id=1906624         ✅ 
get_recall_stats:   {memories:1762, summaries:481, personal:3928} ✅
sync_turn:          background thread OK ✅
prefetch:           shows just-written Phase1 test memory ✅
```

---

## Step 1.2: LLM Configuration (MiniMax)

### Key Finding: MiniMax Anthropic-Compatible Endpoint

Hermes uses MiniMax via the **Anthropic Messages API** transport (not OpenAI-compat).

| Item | Value |
|------|-------|
| Transport | `anthropic_messages` |
| API endpoint | `https://api.minimaxi.com/anthropic` (no `/v1` suffix!) |
| Auth | `Authorization: Bearer <key>` (NOT `x-api-key`) |
| Model name | `MiniMax-M2.7-highspeed` |
| Context window | 131,072 tokens |

**Critical:** The Anthropic SDK appends `/v1/messages` to the base URL. So:
- ✅ Correct: `MINIMAX_BASE_URL=https://api.minimaxi.com/anthropic`
- ❌ Wrong:   `MINIMAX_BASE_URL=https://api.minimaxi.com/anthropic/v1` → 404 double `/v1/v1/messages`

### Environment Variables (`~/.hermes/.env`)

```env
MINIMAX_API_KEY=sk-cp-6fK-TWGeJV1NhnYfmtiTeghLHfbaiT_h53vs4LdPqSKCIXiybOmPNTDXhCeK1cjfRebRGDfV4eOJMn9MuCWcamUmD4J8RAoLOIWeM7e12rbG-f3wMRECpnM
MINIMAX_BASE_URL=https://api.minimaxi.com/anthropic
```

### Hermes Config (`~/.hermes/config.yaml`)

```yaml
model:
  default: "MiniMax-M2.7-highspeed"
  provider: "minimax"

memory:
  provider: "openclaw"
```

### Alternative Endpoints Tested

| Endpoint | Result |
|----------|--------|
| `https://api.minimax.chat/v1` (OpenAI-compat) | ✅ HTTP 200 |
| `https://api.minimaxi.com/v1` (OpenAI-compat) | ✅ HTTP 200 |
| `https://api.minimax.io/anthropic/v1` (Anthropic, x-api-key) | ❌ 401 (wrong auth) |
| `https://api.minimaxi.com/anthropic/v1` (Anthropic, Bearer) | ✅ HTTP 200 |
| `https://api.minimaxi.com/anthropic` (Anthropic SDK base) | ✅ **USED** |

---

## Step 1.3: Hermes Router Skill

**Location:** `/home/ai/.openclaw/workspace/custom-skills/hermes-router/`

### Files Created
- `SKILL.md` — routing documentation and usage guide
- `hermes-router.js` — routing logic module

### Routing Logic

```
Complexity Score → Handler
0-2  → OpenClaw (direct)
3+   → Hermes (complex)
```

**Hermes triggers on:** 分析, 比较, 设计, 研究, 评估, 优化, 架构, 重构, 生成, 实现 + English equivalents (analyze, compare, implement, etc.)

**Direct triggers on:** 查一下, 记住, what is, when, 告诉我 (quick lookups)

### Router Test Results

```
[HERMES  ] score=3 | 帮我分析一下这个项目的架构设计
[HERMES  ] score=3 | 生成一个Python函数处理JSON
[HERMES  ] score=3 | analyze and compare the two approaches
[OPENCLAW] score=0 | 今天天气怎么样
[OPENCLAW] score=0 | 查一下任务状态
[HERMES  ] score=3 | please implement a full REST API with auth
```

---

## Step 1.4: OpenClaw Memory Provider Active in Hermes

Configured via `~/.hermes/config.yaml`:
```yaml
memory:
  provider: "openclaw"
```

Hermes discovery confirms:
```
openclaw: ✅ available (pgvector + Redis reachable)
```

The built-in Hermes MEMORY.md/USER.md system remains active in parallel (additive design). OpenClaw provides vector recall on top.

---

## Step 1.5: End-to-End Validation

### Test: Hermes → recall_memories → Real Data → MiniMax Response

```bash
cd /home/ai/apps/hermes-agent && \
  export $(cat ~/.hermes/.env | grep -v '^#' | xargs) && \
  python3 -c "
  sys.argv = ['hermes', 'chat', '-q', 
    'What do you know about projects or tasks in memory? Use recall_memories.',
    '--provider', 'minimax', '-m', 'MiniMax-M2.7-highspeed']
  from hermes_cli.main import main; main()
  "
```

**Result:** ✅ Hermes made 2 tool calls, recalled real memories about 任务管理系统, TASK-20260405-006, ACTIVE_TASKS.md, etc. Response was coherent and accurate.

**Session ID:** `20260412_014833_026219`  
**Duration:** 14s  
**Tool calls:** 2 (recall_memories)  
**Memories retrieved:** Real OpenClaw data (1762 memories in store)

---

## Dependencies Installed

During Phase 1, the following Python packages were installed system-wide:

```
prompt_toolkit  (Hermes CLI UI)
httpx           (Hermes HTTP client)
anthropic       (MiniMax Anthropic-compat transport)
fire            (Hermes CLI)
rich, pydantic, tiktoken  (via requirements.txt)
```

---

## Known Issues / Notes

### 1. MiniMax Returns Thinking Blocks
MiniMax M2.7-highspeed includes `<think>` reasoning blocks in responses. Hermes strips these via the Anthropic adapter. Behavior is normal.

### 2. Hermes is 3 Commits Behind
Banner shows `⚠️ 3 commits behind — run hermes update`. Non-blocking for Phase 1.

### 3. Router Threshold
The router uses a simple keyword score. For production, consider adding:
- ML-based complexity classifier
- Task length heuristic refinement
- Feedback loop from actual Hermes response times

### 4. MiniMax Thinking vs Direct Response
The content response sometimes comes after a ThinkingBlock. The end-to-end test showed the thinking block signature being returned. For better output, consider `max_tokens` tuning or using non-thinking model variant.

### 5. Compression Summary Model
`config.yaml` sets `summary_provider: "main"` to use MiniMax for compression. This has NOT been tested under compression conditions (requires >50% context fill). Monitor.

---

## File Summary

### Created/Modified Files

| File | Action | Purpose |
|------|--------|---------|
| `/home/ai/apps/hermes-agent/plugins/memory/openclaw/openclaw_provider.py` | Modified | Added on_session_end, on_memory_write, on_pre_compress |
| `/home/ai/apps/hermes-agent/plugins/memory/openclaw/plugin.yaml` | Modified | Version → 1.0.0 |
| `~/.hermes/.env` | Created | MiniMax API key + OpenClaw DB creds |
| `~/.hermes/config.yaml` | Created | model: minimax, memory.provider: openclaw |
| `/home/ai/.openclaw/workspace/custom-skills/hermes-router/SKILL.md` | Created | Routing documentation |
| `/home/ai/.openclaw/workspace/custom-skills/hermes-router/hermes-router.js` | Created | Router logic module |

---

## How to Use Hermes in Production

```bash
# Single query (non-interactive)
cd /home/ai/apps/hermes-agent && \
  source ~/.hermes/.env && \
  python3 -c "
import sys
sys.argv = ['hermes', 'chat', '-q', 'YOUR QUERY HERE', '--provider', 'minimax', '-m', 'MiniMax-M2.7-highspeed']
from hermes_cli.main import main; main()
"

# Interactive session
cd /home/ai/apps/hermes-agent && \
  source ~/.hermes/.env && \
  python3 -c "
import sys
sys.argv = ['hermes', 'chat', '--provider', 'minimax', '-m', 'MiniMax-M2.7-highspeed']
from hermes_cli.main import main; main()
"
```

Or via the router:
```javascript
const { route, invokeHermes } = require('/home/ai/.openclaw/workspace/custom-skills/hermes-router/hermes-router.js');
const decision = route(userMessage);
if (decision.handler === 'hermes') {
  const result = invokeHermes(userMessage);
}
```

---

## Phase 2 Recommendations

Based on Phase 1 findings, Phase 2 should focus on:

1. **Streaming responses** — MiniMax supports streaming; Hermes supports it too. Enable for better UX.
2. **write_memory integration** — Have Hermes automatically write key facts via write_memory tool after complex tasks.
3. **on_delegation** — Wire Hermes's subagent delegation back to OpenClaw for cross-session memory.
4. **Router refinement** — Add task duration tracking to improve routing decisions.
5. **Personal memory** — Test queries against `personal_memories` table (3928 rows) for richer context.

---

*Phase 1 完成。Hermes + OpenClaw + MiniMax 三位一体集成成功。*
