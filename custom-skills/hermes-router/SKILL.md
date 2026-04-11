# Hermes Router Skill

Routes user requests between direct OpenClaw handling and Hermes agent delegation.

## Purpose

Decides when to invoke the Hermes agent (for complex reasoning / code tasks) vs handle
directly through OpenClaw (for quick recalls, factual lookups, simple tasks).

## Routing Decision

**Invoke Hermes (complex)** when:
- Complex reasoning: analyze, compare, evaluate, design, review, plan
- Code generation or code review
- Deep research requiring multiple tool calls
- Multi-step problem solving
- Keywords: 分析, 比较, 设计, 研究, 评估, 优化, 架构, why, how, compare, analyze, generate, implement, refactor, debug

**Handle directly in OpenClaw (fast)** when:
- Factual recall / memory lookup
- Simple questions with known answers
- Configuration changes
- Quick status checks
- Single-hop tool calls (weather, time, simple search)
- Keywords: 记住, 查一下, what is, when, where, 告诉我

## How to Use This Skill

When routing a task:

1. **Check message against patterns above**
2. **If Hermes needed** — use `exec` to run Hermes CLI:
   ```bash
   cd /home/ai/apps/hermes-agent && \
   HERMES_MEMORY_PROVIDER=openclaw \
   MINIMAX_API_KEY=<from ~/.hermes/.env> \
   python3 -m hermes_cli --prompt "<user message>" --no-interactive
   ```
   Or use `sessions_spawn` for background execution.

3. **If direct** — handle via normal OpenClaw tools.

## Environment

- Hermes home: `~/.hermes/`
- Config: `~/.hermes/config.yaml` (MiniMax provider, openclaw memory)
- Plugin: `/home/ai/apps/hermes-agent/plugins/memory/openclaw/`

## Complexity Score (0-10)

| Score | Action |
|-------|--------|
| 0-3   | Handle directly in OpenClaw |
| 4-6   | Judgment call — consider task duration |
| 7-10  | Delegate to Hermes |

Simple heuristic: if completing the task requires >3 reasoning steps or tool calls, use Hermes.
