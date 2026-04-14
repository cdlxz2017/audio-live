# 故障分析 SOP — 深度链路分析法

> **核心原则**：不画等号，不给半成品。
> 每一个故障/信息点，都必须追溯其完整数据链路，
> 找出所有关联点，确保修改不引发连锁反应，修复方案从根因入手。

---

## 一、触发条件

当遇到以下任一情况时，必须启动本 SOP：

- 系统报错、功能异常、行为不符合预期
- 修改某处后出现新问题
- 需要分析某个信息点的所有关联关系
- 主人要求分析某个故障或系统行为

---

## 二、分析流程（五步法）

### 第一步：锁定信息点

**明确要分析的对象是什么。**

- 故障类：是什么报错/异常行为？错误信息是什么？
- 信息类：要分析哪个数据/配置/模块？

**产出**：一句话描述信息点，如"session-recall.js 中的 recall() 方法返回结果不包含 memories 表"

---

### 第二步：绘制数据链路图

**这一步是最核心的环节，禁止跳过。**

对每个信息点，必须回答以下问题：

```
① 数据从哪里来？（写入方）
   - 哪个函数/模块生成的？
   - 写入哪个表/队列/缓存？
   - 写入的格式是什么？

② 数据流经哪些节点？（传递方）
   - 哪些模块会读取这个数据？
   - 读取后做什么处理？
   - 是否会触发其他副作用？

③ 数据流向哪里去？（消费方）
   - 最终被哪些模块使用？
   - 使用后会产生什么结果？
   - 结果又触发什么后续流程？
```

**工具**：使用代码搜索确认每个节点
```bash
# 查找写入点
grep -rn "INSERT INTO\|UPDATE\|write\|publish" <相关文件>

# 查找读取点
grep -rn "SELECT\|query\|get\|load\|fetch\|recall" <相关文件>

# 查找调用链
grep -rn "require\|import" <相关文件>
```

**产出**：完整的调用链/数据流图（文字版即可）

---

### 第三步：识别所有关联点

列出所有与目标信息点存在关联的模块/函数/表/配置。

**关联类型判断标准**：

| 类型 | 判断方法 |
|------|---------|
| 直接调用 | A模块直接调用B模块函数 |
| 共享数据 | A和B都读写同一个表/缓存/文件 |
| 消息队列 | A写入Stream/Queue，B从Stream/Queue消费 |
| 配置耦合 | A和B读取相同的配置文件 |
| 副作用链 | A的输出是B的输入，且B依赖A的输出格式 |

**产出**：关联点清单，格式：
```
关联点 | 关联类型 | 关联内容
-------|---------|--------
extractor-file-based.js | 直接调用 | write() 写入 memories 表
RecallService.recall() | 共享数据 | 从 memories 表读取向量检索结果
memory-garbage-collector.js | 共享数据 | 从 memories 表读取积分/冷存储
```

---

### 第四步：评估修改影响

在动手修改之前，回答以下问题：

```
① 如果删除了 X，哪些功能会受影响？
② 如果修改了 X 的输出格式，哪些模块会出错？
③ 如果 X 所在的队列/缓存失效，哪些流程会中断？
④ 是否有热路径（每次请求必经之路）被影响？
⑤ 是否有异步流程在后台消费 X，数据变更后是否需要同步通知？
```

**产出**：影响评估矩阵

---

### 第五步：制定根因修复方案

**不是修症状，是修根因。**

基于以上四步分析，给出：
1. **问题根因是什么**（不是现象）
2. **为什么之前没有发现**（如果是长期存在的）
3. **修复方案是什么**（步骤+资源）
4. **如何验证修复有效**
5. **如何防止同类问题再次发生**

---

## 三、分析模板

```
## 故障/信息点：[名称]

### 第一步：锁定信息点
[一句话描述]

### 第二步：数据链路图
① 数据来源：
② 数据流向：
③ 经过的节点：

### 第三步：关联点清单
| 关联点 | 类型 | 内容 |
|--------|------|------|

### 第四步：影响评估
- 直接影响：
- 间接影响：
- 热路径影响：
- 异步流程影响：

### 第五步：修复方案
**根因**：
**方案**：
**验证方法**：
**预防措施**：
```

---

## 四、案例：本次 memories 表 recall 剔除分析

### 第一步：锁定信息点
`RecallService.recall()` 每次都查询 memories 表，导致 recall 结果混入 LLM 从对话中提取的二手知识，用户期望 recall 只返回用户直接告知的内容。

### 第二步：数据链路图
```
写入端：
  extractor-file-based.js
    → LLM 提取对话 JSONL 文件
    → memoryWriter.write()
    → memories 表（entity/attr/value）

读取端：
  RecallService.recall()
    → _vectorSearchMemories()  ← 目标：删除这路
    → memory_summaries 表（session 摘要）
    → personal_memories 表（原始对话存档）

消费端：
  recall-hook/handler.js
    → buildMemoryPrompt()
    → 注入 AI prompt
```

### 第三步：关联点清单
| 关联点 | 类型 | 内容 |
|--------|------|------|
| extractor-file-based.js | 直接写入 | 持续写入 memories 表 |
| memory-writer.js | 直接写入 | write() 方法封装 |
| RecallService.recall() | 直接读取 | 向量检索入口（本次修改点）|
| memory-garbage-collector.js | 共享数据 | ModuleE 积分/冷存储，读 personal_memories |
| health-check.js | 共享数据 | 统计 memories 表数量 |
| learning-trigger.js | 共享数据 | 依赖 recallResult.memories 数组 |
| session-context-loader.js | 直接调用 | recallService.recall() |

### 第四步：影响评估
- 直接影响：recall 结果不再包含 memories 表数据
- 间接影响：**无** — health-check/GC/learning-trigger 均读 personal_memories，不依赖 memories 表
- 热路径影响：recall 性能提升（减少一次 HNSW 检索）
- 异步流程影响：**无**

### 第五步：修复方案
- **根因**：recall 设计时将 LLM 提取的二手知识和用户直接告知的内容混在一起查
- **方案**：去掉 `_vectorSearchMemories` 调用，recall 只查 memory_summaries + personal_memories
- **验证**：检查 recall_logs 中 recalled_ids 不再包含 memories 表 ID
- **预防**：新增 recall 数据源 SOP 规范，明确各表职责

---

## 五、注意事项

1. **禁止跳步**：第二步（数据链路图）是必做的，不可以凭感觉直接改
2. **宁多勿少**：关联点多报不报错，漏报才是风险
3. **异步不能忘**：Redis Stream / 消息队列的消费者也要算入关联点
4. **工具辅助**：优先用 grep/find 搜代码，少用脑子猜
5. **写下来**：分析结果必须写到文档里，不能只存在脑子里

---

## 六、触发词

- 触发词：故障分析、深度分析、数据链路、追根溯源
- 同时更新记忆系统：将 SOP 路径写入 MEMORY.md 和 SYSTEMS.md

---

_创建时间：2026-04-15_
