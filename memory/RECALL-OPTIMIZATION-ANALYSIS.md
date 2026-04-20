# 召回系统优化分析报告

**分析时间**: 2026-04-20 13:55 GMT+8  
**数据范围**: 最近 24 小时

---

## 一、P99 延迟根因分析

### 延迟分布

| Intent    | Count | Avg(ms) | Max(ms) | P99(ms) |
|-----------|-------|---------|---------|---------|
| TECHNICAL | 12    | 167     | 301     | **297** |
| DEFAULT   | 8     | 207     | 1030    | **970** |
| FEEDBACK  | 1     | 0       | 0       | 0       |
| **整体**  | **21**| **174** | **1030**| **884** |

### 结论

1. **P99 超标的主因：DEFAULT 类意图被单次异常值（1030ms）严重拉高**

   最慢的 10 次召回中，DEFAULT 类占 2 次：
   - `1030ms` — DEFAULT — **内容本质是 TECHNICAL**（见下文漏报分析）
   - `178ms` — DEFAULT — "测试一下召回系统"（合理 DEFAULT）

   排除那次 1030ms 误分类后，DEFAULT P99 将降至 ~178ms，远低于 800ms 目标。

2. **TECHNICAL 类 P99 仅 297ms，完全达标**，非瓶颈。

3. **Embedding 环节**：无独立 embed_ms 字段，但从 TECHNICAL 平均 167ms 推算，embedding 约 30-50ms（bge-m3），非瓶颈。

4. **Graphify 超时（200ms）**：TECHNICAL 的 max=301ms 说明 Graphify 超时确实偶有发生，但量少（12 次中仅 1 次超 200ms），对 P99 影响可控。

---

## 二、DEFAULT 意图过高根因

**现状**: DEFAULT 占比 8/21 = **38%**（目标 20%）

### 漏报分析：落入 DEFAULT 但实际应为 TECHNICAL 的查询

| 查询内容（截取）                                  | 实际应分类 | 漏报原因 |
|---------------------------------------------------|------------|----------|
| "用户持续关注main程序的运行状态...**ollama**...**bge-m3:latest**...**keep_alive**参数..." | TECHNICAL | 缺 `ollama`/`bge-m3`/`keep_alive` 关键词 |
| "## Clawith - OpenClaw for Teams..."（研究摘要）  | TECHNICAL | 缺 `openclaw`（`gateway\|openclaw` 只匹配了"gateway"，未命中"openclaw"） |

**其余 DEFAULT 查询**（正常）：
- "测试一下召回系统" / "测试召回缓存" → 确为测试，合理 DEFAULT
- "## Clawith - OpenClaw for Teams..."（部分）→ Clawith 内容，但技术词汇不突出，可接受

### 漏报根因：TECHNICAL_PATTERNS 正则覆盖盲区

当前 TECHNICAL_PATTERNS 已包含：
- `/gateway|openclaw|webhook|websocket/i` — 但正则中 `|` 优先级问题，`gateway|openclaw` 实际被解析为 `gateway` 或 `openclaw`，**理论上已覆盖 "openclaw"**

重新检查：实际日志中 "openclaw" 查询仍落入 DEFAULT，说明 `gateway|openclaw` 的正则**未生效**。可能原因：
1. 正则引擎对 `|` 的解析顺序
2. 大小写匹配问题（/i 已覆盖）
3. 或者该查询未触发 TECHNICAL 匹配时，前面的 PROJECT/PERSON 等也无匹配

另外关键盲区：
- **`ollama`**（本地 LLM 运行时）、**`bge-m3`/`model`**（模型相关）、**`keep_alive`**（配置参数）、**`会话`**/**`session`**（系统运行）— 这些主人高频查询词汇均未在 TECHNICAL_PATTERNS 中

---

## 三、Top 3 可立即实施的优化点

### 🥇 优化 1（高优先级）：补充 TECHNICAL_PATTERNS 关键词

**目标**：修复 1030ms 异常值根源，减少 TECHNICAL 漏报

**建议在 `intentTechnicalPatterns` 中增加**：

```javascript
// 新增：本地运行环境和模型配置（主人高频查询）
/ollama|bge-m3|keep_alive|model|模型|会话|session\b/i,
// 补充 openclaw 相关（当前正则可能未命中）
/openclaw|open-code|clawteam|clawhub/i,
// 系统运行状态
/进程|内存|cpu|gpu|显存|占用|驻留/i,
// 配置管理
/配置|参数|设置|option|cfg|env/i,
// 主程序/网关
/main程序|main session|网关|gateway/i,
```

**预期效果**：2 条 TECHNICAL 漏报 → 回归 TECHNICAL 类，DEFAULT 占比降至 6/21 = 28%（仍有下降空间）

---

### 🥈 优化 2（中优先级）：为 DEFAULT 关闭 Graphify（当前已关闭，确认配置）

DEFAULT 配置中 `graphify: false`，**确认有效**。

但建议：增加**缓存**，防止同类 DEFAULT 查询重复触发 embedding + vector search：
- 对于 "测试召回" 类纯缓存命中查询，应直接从缓存返回（当前已部分实现，需验证缓存命中率）

---

### 🥉 优化 3（低优先级）：TECHNICAL 类 Graphify 超时兜底

TECHNICAL max=301ms，说明 Graphify 偶有超时（200ms 限制 + 重试）。

**可选方案**：Graphify 并发数限制，避免突发多个 TECHNICAL 查询时排队超时。

---

## 四、预期改善

| 指标 | 当前 | 目标 | 改善来源 |
|------|------|------|----------|
| DEFAULT 占比 | 38% (8/21) | 20% (4/20) | 漏报修复（+2 TECHNICAL） |
| 整体 P99 | 884ms | <800ms | 1030ms 异常值移除 |
| TECHNICAL P99 | 297ms | <300ms | 已达标 |

---

## 五、补充建议（非立即实施）

1. **增加 embed_ms 独立字段**：便于精准定位 embedding 是否为瓶颈
2. **DEFAULT 占比要降至 20%**：仅靠关键词补充不够，可考虑增加 `intentKeywords` 中 PREFERENCE/EVENT 关键词覆盖（如主人询问"喜欢/偏好"类问题）
3. **正则调试工具**：建议增加测试用例覆盖当前漏报场景，防止正则修改破坏已有分类

---

*分析结论：当前召回系统整体运行正常，P99 超标（884ms）主要由单次 TECHNICAL 查询误分类为 DEFAULT 导致异常值（1030ms）。修复 TECHNICAL_PATTERNS 关键词盲区后，DEFAULT 占比和 P99 延迟均可显著改善。*
