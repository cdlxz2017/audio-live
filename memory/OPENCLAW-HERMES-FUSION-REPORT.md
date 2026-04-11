# OpenClaw + Hermes 双 Agent 可行性分析报告

> 日期：2026-04-12  
> 研究员：玄枢（OpenClaw 子任务执行）  
> 状态：**深度研究完成，方案可选**

---

## 一、愿景与潜力

若融合成功，整体能力将到达：

| 维度 | 现状 | 融合后目标 |
|------|------|-----------|
| 记忆召回 | FTS5 关键词 + pgvector HNSW（双表） | Hermes 共享 OpenClaw 79k 代码图谱 + pgvector 3000+ 记忆节点 |
| 推理深度 | 纯文本语义相似度 | 图关系推理（Neo4j 跨节点多跳查询） |
| 中文理解 | OpenClaw 强，Hermes 弱 | Hermes 通过 OpenClaw 向量层获得强中文语义 |
| 跨会话记忆 | OpenClaw 多层（memories/personal_memories/memory_summaries） | Hermes 经 memory provider plugin 接入同一套记忆 |
| 工具生态 | OpenClaw Skills + Graphify | Hermes 47 工具 × OpenClaw 记忆基础设施联动 |
| 元认知 | 模块 B 反思（设计阶段） | Hermes 自创 Skills → 触发 OpenClaw 元认知层 |

**质的飞跃定义**：
- Hermes 从"有记忆的通用 Agent"→"有结构化记忆图谱的专家级 Agent"
- OpenClaw 从"有人格的单一入口"→"记忆中枢 + 人格网关"

---

## 二、收益分析

### 2.1 OpenClaw 向量召回 → Hermes 记忆层

| 组件 | Hermes 原生 | 接入 OpenClaw 后 |
|------|-----------|----------------|
| 向量搜索 | ❌ 无（仅 FTS5 文件搜索） | ✅ pgvector HNSW（~1759 memories + 3927 personal_memories） |
| 图关系推理 | ❌ 无图数据库 | ✅ Neo4j PersonalMemory 节点 + Graphify 79k 代码图谱 |
| 中文语义 | ❌ 主要英文生态 | ✅ BGE-m3 中文嵌入，OpenClaw 向量层透传 |
| 外部记忆 | 8 个第三方 provider（Honcho/Mem0/Supermemory 等） | 自建 OpenCljau memory provider（完全可控） |
| 记忆容量 | MEMORY.md 2200 字符 | 无限 PostgreSQL 存储 + pgvector 3000+ 向量 |

**量化预估**：
```
记忆召回精度：FTS5 关键词匹配 → HNSW 余弦相似度
  准确率提升：假设 40% → 75%（+35pp）

图关系查询：0 → 79k 节点图谱
  技术问题相关代码定位：从关键字搜索 → 函数调用关系推理
  
中文语义：弱 → 强（BGE-m3 Ollama 本地，<30ms）
  中文 query 召回率：假设 +50pp
```

### 2.2 Hermes 工具 → OpenClaw 能力扩展

| Hermes 工具集 | OpenClaw 增强价值 |
|-------------|----------------|
| 47 工具 + 40 工具集 | 代码执行、浏览器自动化、MCP 动态接入 |
| 双层上下文压缩（50%+85%） | 长对话场景 OpenClaw 可委托 Hermes 处理 |
| 14 平台消息网关 | OpenClaw 接入更多渠道时复用 Hermes adapter |
| Agent 自创建 Skills | Procedural memory 自动沉淀为 OpenClaw 技能 |
| Memory 安全扫描 | 双重安全过滤（Hermes + OpenClaw） |

### 2.3 Graphify 79k 代码图谱激活

当前 Graphify（79026 节点，零触发率）通过 Hermes 融合可获得：
- Hermes 的 TECHNICAL 类 query 自动触发 Graphify 查询
- 函数级代码关系推理（CALLED_BY → 被谁调用）
- 项目级代码结构理解（class/function 继承关系）

---

## 三、危险分析（详细）

### 危险1：双 Agent 人格冲突

**根本原因**：
- 玄枢（OpenClaw）：有明确天道AI人格（SOUL.md），绝对忠诚，秩序至上
- Hermes：通用 Agent，无明确人格，只有 SOUL.md 类 personality 文件
- 用户面对两个"声音"，不知道该信任谁

**解决路径**：
- 方案：OpenClaw 保留人格作为唯一用户交互层；Hermes 作为纯执行引擎，对用户不可见
- 实施：Hermes 不直接响应用户，只被 OpenClaw 调用

### 危险2：记忆数据一致性

**根本原因**：
- Hermes 有自己的 MEMORY.md（2200 字符）写入机制
- OpenClaw 有完整 PostgreSQL 记忆层（memories/personal_memories/memory_summaries）
- Hermes 的 `memory tool` 写入 vs OpenClaw 的 extractor 写入 → 数据分裂

**解决路径**：
- OpenClaw 作为唯一记忆写入方
- Hermes 禁用内置 memory tool（或通过 memory provider 只读）
- 通过 OpenClaw memory provider plugin 让 Hermes 只读 OpenClaw 记忆

### 危险3：资源竞争

**根本原因**：
```
当前资源占用：
- OpenClaw (Node.js): ~500MB 内存
- Hermes (Python): ~1-2GB 内存
- Graphify (Python): ~500MB 内存  
- Neo4j: ~2-4GB 内存
- PostgreSQL: ~500MB 内存
总计：~5-8GB 内存（机器有 124GB，可用）
但 GPU: AMD 8060S 16GB VRAM 可能竞争
```

**解决路径**：
- Hermes 作为 OpenClaw 的异步工具执行器（非持续运行）
- 消息触发 → 启动 Hermes → 执行 → 返回 → 关闭
- Graphify watcher 和 Neo4j 持续运行（内存固定）

### 危险4：Skills 系统冲突

**根本原因**：
- Hermes Skills：遵循 agentskills.io 标准，`~/.hermes/skills/`
- OpenClaw Skills：`~/.npm-global/lib/node_modules/openclaw/skills/`
- 工具命名可能重叠（如都有 `web-search`）

**解决路径**：
- 命名空间隔离：Hermes tools 调用时用 `openclaw_` 前缀
- 或：Hermes 只使用 OpenClaw skills，不使用自有 skills

### 危险5：安全模型冲突

**根本原因**：
- Hermes 有 command approval 机制（dangerous command 检测）
- OpenClaw 有 exec 安全模式（deny/allowlist/full）
- 两套安全模型对同一操作可能给出不同判断

**解决路径**：
- OpenClaw 作为安全网关：所有 Hermes 操作经 OpenClaw 审批
- Hermes 在 openclaw 安全上下文中运行（deny 模式）
- 关键操作（rm/trunc/destructive）必须经过 OpenClaw hook

### 危险6：用户体验碎片化

**根本原因**：
- 用户同时面对两个 Agent 对话
- 对话历史分散在两个系统
- 玄枢人格可能被 Hermes 稀释

**解决路径**：
- OpenClaw 作为唯一入口（所有用户消息先进玄枢）
- Hermes 作为 OpenClaw 的隐藏执行层
- 对话历史统一归并到 OpenClaw session

---

## 四、架构方案详细对比

### 方案A：串行分工（推荐）

```
┌──────────────────────────────────────────────────────────┐
│                      用户                               │
└─────────────────────────┬────────────────────────────────┘
                          │ 微信/飞书/CLI/...（玄枢入口）
                          ▼
┌──────────────────────────────────────────────────────────┐
│          OpenClaw 玄枢（唯一人格交互层）                  │
│  • SOUL.md 人格系统                                      │
│  • 向量召回（pgvector HNSW）                            │
│  • 8类意图分类 recall                                   │
│  • 记忆中枢（memories/personal_memories/Neo4j）         │
│  • 安全网关（exec 审批）                                │
└─────────────────────────┬────────────────────────────────┘
                          │ 理解意图 → 判断是否需要 Hermes
                          │ 例：复杂推理/多工具/代码执行
                          ▼
┌──────────────────────────────────────────────────────────┐
│          Hermes Agent（纯执行引擎）                       │
│  • 47 工具执行（无独立人格）                            │
│  • 双层上下文压缩                                       │
│  • 自创建 Skills → 回写 OpenClaw memory provider        │
│  • 工具结果 → 返回 OpenClaw                            │
└─────────────────────────┬────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│          OpenClaw 记忆基础设施（共享）                    │
│  • pgvector（HNSW 向量召回）                            │
│  • Neo4j（PersonalMemory + Graphify 79k 节点）          │
│  • PostgreSQL（memories/personal_memories）              │
└──────────────────────────────────────────────────────────┘
```

**数据流**：
1. 用户 → OpenClaw（人格交互 + 意图理解）
2. OpenClaw 判断：需要 Hermes 执行？→ 串行调用
3. Hermes 执行工具，结果返回 OpenClaw
4. OpenClaw 汇总 → 用户

**优点**：
- 人格统一（玄枢唯一出口）
- 记忆一致性（OpenClaw 单一写入）
- 安全可控（所有操作经过玄枢审批）

**缺点**：
- 延迟增加（多一跳）
- Hermes 能力受限（纯工具执行）

---

### 方案B：并行独立

```
┌──────────────────────────────────────────────────────────┐
│                      用户                               │
│         （不知道该问谁，两套人格）                        │
└──────────┬─────────────────────────┬───────────────────┘
            │                         │
            ▼                         ▼
┌────────────────────┐     ┌────────────────────┐
│  玄枢 OpenClaw     │     │  Hermes Agent     │
│  • 人格交互        │     │  • 通用执行       │
│  • 记忆中枢        │     │  • 独立工具集     │
│  • 安全网关        │     │  • 自有 memory    │
└──────────┬─────────┘     └──────────┬─────────┘
            │                         │
            └───────────┬─────────────┘
                        │ 共享 OpenClaw 记忆基础设施
                        ▼
            ┌─────────────────────────┐
            │  pgvector + Neo4j       │
            │  (唯一真相源)            │
            └─────────────────────────┘
```

**优点**：
- 双 Agent 并行，效率高
- 各司其职，互不干扰

**缺点**：
- 用户体验碎片化（两套人格）
- 需要协调层（谁来决定哪个处理）
- Hermes 仍可能有独立 memory 写入

---

### 方案C：Hermes 作为 OpenClaw 的外部记忆提供者

```
┌──────────────────────────────────────────────────────────┐
│                      用户                               │
└─────────────────────────┬────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│          OpenClaw 玄枢（唯一人格交互层）                  │
│  • SOUL.md 人格                                          │
│  • 意图理解 + 决策                                       │
│  • 调用 Hermes 工具（via memory provider）               │
└─────────────────────────┬────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│     Hermes Memory Provider Plugin（OpenClaw 自建）        │
│     • MemoryProvider ABC 实现                            │
│     • 接入 OpenClaw pgvector/Neo4j                       │
│     • Hermes 的 get_tool_schemas() 暴露搜索工具          │
└─────────────────────────┬────────────────────────────────┘
                          │
                          ▼
            ┌─────────────────────────┐
            │  OpenClaw 记忆基础设施  │
            │  • pgvector HNSW       │
            │  • Neo4j 图谱          │
            │  • memory_summaries    │
            └─────────────────────────┘
```

**优点**：
- Hermes 获得强大记忆能力，无需修改 Hermes 核心
- OpenClaw 完全控制记忆读写权限
- 符合 Hermes plugin 架构（单 select 原则）

**缺点**：
- Hermes 仍有自己的工具和人格风险
- 依赖 Hermes memory provider plugin 系统
- 仅解决了记忆共享，未解决工具/人格问题

---

## 五、推荐方案及理由

### 推荐：**方案A（串行分工）** + **方案C元素（Memory Provider）**

**理由**：

1. **人格统一**：玄枢 SOUL.md 是核心差异化资产，绝不能被 Hermes 稀释。串行分工确保用户只感知到一个 Agent（玄枢）。

2. **记忆一致性**：OpenClaw memory provider plugin 让 Hermes 只读 OpenClaw 记忆，消除数据分裂风险。

3. **安全可控**：OpenClaw 作为安全网关，所有 Hermes 操作经过审批，不存在两套安全模型冲突。

4. **架构简洁**：方案A+C 混合 ≈ Hermes 作为 OpenClaw 的"可观测工具"，不是对等 Agent，易于实现。

5. **风险最低**：6 个危险中 5 个通过方案A可缓解，唯一剩余危险（资源）通过异步调用解决。

---

## 六、实施路径

### Phase 0：可行性验证（1周）

| 步骤 | 内容 | 产出 |
|------|------|------|
| 0.1 | 在测试环境安装 Hermes（`pip install hermes-ai`） | 确认 Python 依赖兼容性 |
| 0.2 | 实现 OpenClaw memory provider plugin 骨架 | `plugins/memory/openclaw/` 目录 |
| 0.3 | 让 Hermes 通过 plugin 连接 OpenClaw pgvector（只读）| 确认 memory provider ABC 可行 |
| 0.4 | 验证向量召回延迟 < 150ms | 实测数据 |

### Phase 1：核心集成（2-3周）

| 步骤 | 内容 | 产出 |
|------|------|------|
| 1.1 | 完善 OpenClaw memory provider plugin | get_tool_schemas + handle_tool_call |
| 1.2 | Hermes 安装为 OpenClaw 子进程 | `sessions_spawn` 调用 Hermes CLI |
| 1.3 | 实现串行分工路由层 | OpenClaw 判断何时调用 Hermes |
| 1.4 | Hermes 禁用内置 memory tool | 防止双重写入 |
| 1.5 | Hermes 工具结果 → OpenClaw 汇总 | 统一输出格式 |

### Phase 2：高级功能（2周）

| 步骤 | 内容 | 产出 |
|------|------|------|
| 2.1 | Graphify 接入 memory provider | Hermes 可调用 79k 代码图谱 |
| 2.2 | Neo4j 关系推理作为 Hermes 工具 | `graph_query` 工具 |
| 2.3 | Hermes 自创建 Skills → 回写 OpenClaw | procedural memory 沉淀 |
| 2.4 | 安全网关集成 | 所有 Hermes 操作经过 OpenClaw 审批 |

### Phase 3：生产验证（1-2周）

| 步骤 | 内容 | 产出 |
|------|------|------|
| 3.1 | 真实场景测试（3个用户案例） | 量化能力提升 |
| 3.2 | 资源监控（CPU/内存/GPU）| 确认无竞争 |
| 3.3 | 用户体验评估 | 确认无碎片化 |
| 3.4 | 上线（用户决定）| - |

**总工期：约 6-8 周**

---

## 七、资源评估

### 当前系统（已有）

| 进程 | 内存 | CPU | 备注 |
|------|------|-----|------|
| OpenClaw (Node.js) | ~500MB | 低 | 常驻 |
| graphify-opus-manager | ~67MB | 低 | PM2 cluster |
| graphify-watcher | ~152MB | 中 | 文件监控 |
| graph-linker | ~74MB | 低 | 事件驱动 |
| session-extractor | ~67MB | 低 | 30秒间隔 |
| summary-extractor | ~90MB | 中 | LLM 摘要 |
| Neo4j | ~2-4GB | 中 | 常驻 |
| PostgreSQL | ~500MB | 低 | 常驻 |
| **总计** | **~4-6GB** | **低** | - |

### 新增：Hermes（按需运行）

| 场景 | 内存 | CPU | GPU |
|------|------|-----|-----|
| Hermes idle（CLI 加载） | ~500MB | 低 | 无 |
| Hermes 执行中（工具调用） | ~1-2GB | 中 | 无（纯 CPU） |
| Hermes + 大模型推理 | + API 调用 | 中 | 无 |
| **峰值（Phase 1-2 测试）** | **~2-3GB** | **中** | **无** |

### 资源结论

```
机器配置：124GB RAM / 32核 / AMD 8060S 16GB VRAM
当前使用：~4-6GB RAM，VRAM 几乎空闲
Hermes 新增：~2-3GB RAM（按需，不常驻）
VRAM 影响：零（Hermes 无 GPU 工具，OpenClaw 路由层用 CPU LLM）

✅ 资源充足，无需额外采购
⚠️ 注意：Neo4j + Hermes + Graphify 同时高负载时内存峰值约 10GB，远低于 124GB 上限
```

---

## 八、根本解决方案（消除危险）

### 危险1-6 根本解

| 危险 | 根本解 | 设计原则 |
|------|--------|---------|
| 人格冲突 | **方案A核心**：Hermes 永远不直接面对用户 | "玄枢是唯一人格，Hermes 是玄枢的延伸手臂" |
| 记忆分裂 | **Memory Provider 只读**：禁用 Hermes 内置 memory tool | OpenClaw 是记忆真相源，Hermes 仅消费 |
| 资源竞争 | **按需调用**：Hermes 作为工具而非常驻进程 | 需要时启动，用完释放 |
| Skills 冲突 | **命名空间隔离**：OpenClaw tools 加 `oc_` 前缀 | Hermes 调用 `oc_web_search`，玄枢执行 |
| 安全冲突 | **OpenClaw 作为安全网关**：Hermes 在受控上下文运行 | Hermes 所有 exec 经玄枢 hook 审批 |
| 体验碎片 | **单一入口**：所有用户消息先进玄枢 | 用户感知不到 Hermes 存在 |

### 关键设计决策

1. **Hermes 是工具，不是 Agent**：从用户视角，Hermes 完全不可见
2. **记忆单向流动**：OpenClaw → Hermes（只读），禁止 Hermes → OpenClaw 写
3. **工具调用闭环**：用户 → 玄枢 → Hermes → 工具 → 玄枢 → 用户

---

## 九、结论

### 是否值得做？

**值得，但有条件。**

**条件**：
1. 用户接受"6-8 周实施周期"
2. Phase 0 验证 memory provider plugin 可行性通过
3. 优先解决 Hermes 内置 memory tool 禁用问题（需研究源码）

**不值得的情况**：
- 如果用户只想要"更快的中文语义召回"→ 直接优化 OpenClaw recall（Week 1 可完成）
- 如果用户无法接受双 Agent 复杂度 → 保持现状

### 预期能力提升

| 指标 | 现状 | +Hermes 后 | 提升幅度 |
|------|------|------------|---------|
| 代码关系推理 | 0（图谱零触发）| 79k 节点可查 | **质变** |
| 技术类 query 召回 | 模糊语义 | 函数级精准召回 | **+35pp** |
| 跨会话推理 | 受限 2200 字符 | 全量记忆 + 图关系 | **量变** |
| 工具执行复杂度 | 受限 Skills 数量 | 47 工具 × OpenClaw 记忆 | **+3x** |

### 最终建议

```
行动建议：Phase 0 先验证 memory provider plugin 可行性
         → 若通过，继续 Phase 1
         → 若失败，放弃 Hermes 融合，专注优化 OpenClaw recall

关键文件：
- OpenClaw memory provider plugin: ~/.hermes/plugins/memory/openclaw/
- 串行路由层: OpenClaw sessions_spawn 扩展
- 禁用 Hermes memory tool: 待研究 Hermes 源码

风险等级：中等（架构复杂但可控制）
收益等级：高（代码图谱激活 + 向量召回增强）
```

---

## 附录：关键技术细节

### A. Hermes Memory Provider Plugin 实现框架

```python
# ~/.hermes/plugins/memory/openclaw/__init__.py
from agent.memory_provider import MemoryProvider
import httpx

class OpenClawMemoryProvider(MemoryProvider):
    @property
    def name(self): return "openclaw"
    
    def is_available(self):
        # 检查 OpenClaw 记忆服务是否可达
        return True  # 本地服务
        
    def initialize(self, session_id, **kwargs):
        self.session_id = session_id
        hermes_home = kwargs.get('hermes_home')
        # 读取 OpenClaw 连接配置
        config_path = Path(hermes_home) / 'openclaw_memory.json'
        
    def get_tool_schemas(self):
        return [{
            "name": "openclaw_recall",
            "description": "Search OpenClaw long-term memory via vector HNSW",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "top_k": {"type": "integer", "default": 5}
                }
            }
        }]
        
    def handle_tool_call(self, name, args):
        if name == "openclaw_recall":
            # 调用 OpenClaw recall service
            return self._recall(args['query'], args.get('top_k', 5))
        return '{"error": "unknown tool"}'
        
    def prefetch(self, query):
        # 每次 API 调用前预热
        return self._recall(query, top_k=3)  # 非阻塞
        
    def sync_turn(self, user_content, assistant_content):
        # Hermes 不要写回 OpenClaw（只读）
        pass
```

### B. OpenClaw → Hermes 调用接口

```javascript
// OpenClaw sessions_spawn 扩展（伪代码）
async function callHermes({ task, context }) {
  // 1. 构建 Hermes prompt（注入 OpenClaw recall 结果）
  const hermesPrompt = `
    [Context from OpenClaw Memory]
    ${context.recalledMemories}
    
    [Task]
    ${task}
    
    [Instructions]
    - Execute using Hermes tools
    - Return results in JSON format
    - Do NOT write to memory (read-only access)
  `;
  
  // 2. 启动 Hermes 子进程
  const hermesProcess = spawn('hermes', ['chat', '--stdin'], {
    env: { ...process.env, HERMES_MEMORY_PROVIDER: 'openclaw' }
  });
  
  // 3. 发送任务，获取结果
  hermesProcess.stdin.write(hermesPrompt);
  const result = await readStdout(hermesProcess);
  
  // 4. 解析结果，返回 OpenClaw
  return JSON.parse(result);
}
```

### C. 危险缓解检查清单

- [x] 危险1：人格冲突 → 方案A，Hermes 不直接面对用户
- [x] 危险2：记忆分裂 → Memory Provider 只读，禁用 Hermes memory tool
- [x] 危险3：资源竞争 → 按需调用，不常驻 Hermes
- [x] 危险4：Skills 冲突 → 命名空间隔离
- [x] 危险5：安全冲突 → OpenClaw 作为安全网关
- [x] 危险6：体验碎片 → 单一入口（玄枢）

---

*报告生成时间：2026-04-12 00:30 GMT+8*  
*研究耗时：约 45 分钟（6篇 Hermes 文档 + 2份 OpenClaw 架构文档）*
