# AGI 进化方案

> 创建时间：2026-04-04 06:06
> 评审模型：Claude Opus (4sapi) + DeepSeek Reasoner

---

## 一、五个核心方案

### 方案一：长期目标追踪系统 V2
**目标：** 跨会话连续性，主动推进目标

**架构设计：**
```
Neo4j 图结构：
- (Goal) 节点：id, title, status, priority, created_at, updated_at
- (SubGoal) 节点：id, title, status, milestone_id, goal_id
- (Milestone) 节点：id, title, completed, due_date
- (GoalSnapshot) 节点：id, goal_id, snapshot_json, created_at (版本快照防漂移)
- 关系：(Goal) -[:HAS_SUBGOAL]-> (SubGoal)
         (Goal) -[:HAS_MILESTONE]-> (Milestone)
         (SubGoal) -[:PART_OF]-> (Goal)
         (Goal) -[:SNAPSHOT]-> (GoalSnapshot)
```

**关键逻辑：**
- 用户说目标时 → 自动创建 Goal 节点
- cron 每4小时 → 检查目标进展
- 目标卡片 → 输出到 HEARTBEAT.md
- **新增**：目标版本快照 + 冲突检测 + 分解机制

**执行步骤：**
1. Neo4j 创建 Goal/SubGoal/Milestone/GoalSnapshot 标签
2. 实现目标分解逻辑（大目标 → 子目标）
3. 实现冲突检测（多目标并行时的优先级仲裁）
4. cron 任务 + HEARTBEAT.md 集成
5. 目标漂移检测（对比版本快照）

**风险缓解：** 目标漂移 → 加版本快照；复杂度 → 分阶段上线

---

### 方案二：元认知反思日志 V2
**目标：** 从错误中学习，建立真正的学习闭环

**架构设计：**
```
反思层级：
- 单轮纠错（session）：每次被纠正时记录
- 会话级策略复盘（daily）：每天对话分析
- 周级模式发现（weekly）：跨会话模式提取

Neo4j 节点：
- (Reflection) 节点：id, type, content, insight, action_items, created_at
- (ErrorPattern) 节点：id, pattern, frequency, last_seen
- 关系：(Reflection) -[:CORRECTS]-> (ErrorPattern)
         (Reflection) -[:GENERATES]-> (ActionItem)
```

**关键逻辑：**
- 每晚 23:00 cron 触发
- 三级反思：单轮 → 会话 → 周
- 反思质量验证（区分真实归因 vs LLM 幻觉）
- 输出：action_items 供后续执行

**执行步骤：**
1. cron 任务每晚 23:00 触发
2. 读取 memory/YYYY-MM-DD.md
3. 三级反思分析（单轮/会话/周）
4. 反思质量评分，过滤低质量归因
5. 写入 memory/reflection/YYYY-MM-DD.md

**风险缓解：** LLM 虚假归因 → 质量验证层；成本 → 只对异常会话触发深度反思

---

### 方案三：主动学习管道 V2
**目标：** 遇到不熟悉概念时主动研究

**架构设计：**
```
Neo4j 节点：
- (Concept) 节点：id, name, confidence, sources[], verified, created_at
- (LearningTask) 节点：id, concept, status, depth, budget_used
- 关系：(Concept) -[:LEARNED_FROM]-> (LearningTask)
         (Concept) -[:VERIFIED_BY]-> (Source)

来源可信度分级：
- L1: 官方文档/学术论文
- L2: 知名博客/技术报告
- L3: 社区讨论/问答
- L4: 未知来源（需交叉验证）
```

**关键逻辑：**
- 置信度阈值触发（<0.6 触发）
- 严格限制：深度上限(N步) + 每日预算 + 人工审批队列
- 来源可信度分级 + 交叉验证
- 研究结果 → 存入 memory/learned/ + Neo4j Concept

**执行步骤：**
1. 设置置信度阈值检测
2. sessions_spawn 后台研究（deepseek-chat）
3. 来源可信度分级评分
4. 人工审批队列（关键概念）
5. 写入 memory/learned/YYYY-MM-DD.md

**风险缓解：** 无限递归 → 深度上限；信息污染 → 交叉验证 + 审批队列

---

### 方案四：记忆价值评分 + 遗忘机制 V2
**目标：** 记忆不会无限膨胀，保留高价值记忆

**架构设计：**
```
PostgreSQL 表修改：
- personal_memories 增加 value_score (INTEGER, default=5)
- personal_memories 增加 last_accessed (TIMESTAMP)
- personal_memories_legacy (冷存储表)

评分规则：
- 每次召回: value_score +1
- 30天未召回: value_score -1
- 每次主动保存: value_score +3
- 低于阈值(2分): 移入冷存储
```

**关键逻辑：**
- **重新激活机制**：新上下文触发时，从冷存储拉回相关记忆
- **意外价值保护**：随机采样保留部分"低分记忆"防止过度遗忘
- **软删除**：冷存储保留 90 天后才彻底删除

**执行步骤：**
1. personal_memories 表增加字段
2. 实现评分更新逻辑（召回+1，30天未召回-1）
3. 实现冷热数据切换
4. 实现重新激活机制（新上下文触发）
5. 遗忘回溯测试（定期验证）

**风险缓解：** 意外价值丢失 → 随机采样保护；冷热切换 → 软删除 + 90天缓冲

---

### 方案五：推理模式库 V2
**目标：** 积累有效思维框架，推理可复用

**架构设计：**
```
Neo4j 节点：
- (ReasoningPattern) 节点：id, name, type, applicability_conditions, confidence, success_rate, expires_at
- (ReasoningAttempt) 节点：id, pattern_id, task_context, success, feedback
- 关系：(ReasoningPattern) -[:SUCCEEDED_IN]-> (ReasoningAttempt)
         (ReasoningPattern) -[:FAILED_IN]-> (ReasoningAttempt)
         (ReasoningAttempt) -[:USED_FOR]-> (Task)

模式失效检测：
- 每个模式绑定适用条件 + 置信度
- 设置过期时间
- 失败时自动降级到通用推理
```

**关键逻辑：**
- 每次复杂任务 → 标记推理方法
- 模式成功/失败 → 更新置信度
- 过期模式 → 自动降级
- 模式组合机制（复杂问题需要多个模式协同）

**执行步骤：**
1. Neo4j 创建 ReasoningPattern/ReasoningAttempt 标签
2. 实现模式标注接口（每次复杂任务）
3. 实现成功率追踪
4. 实现模式失效检测 + 降级逻辑
5. 定期合并相似模式

**风险缓解：** 泛化性差 → 绑定适用条件 + 过期机制；模式失效 → 定期验证 + 降级

---

## 二、方案优先级

| 阶段 | 方案 | 理由 |
|------|------|------|
| 阶段一（立即） | 方案二（元认知反思） | 技术最简单，立即生效 |
| 阶段二（1个月内） | 方案一（目标追踪）+ 方案二协同 | 建立目标+反思闭环 |
| 阶段三（3个月） | 方案四（记忆遗忘）+ 方案三（主动学习） | 解决膨胀+知识扩充 |
| 阶段四（6个月+） | 方案五（推理模式库） | 需要数据积累 |

---

## 三、统一协调层

**核心问题：** 五个方案有强耦合，需要协调层

**协调接口设计：**
```
协调层职责：
1. 管理方案间的数据流
2. 防止优化方向互相矛盾
3. 统一评估框架

数据流：
方案二（反思）→ 输出 insight → 喂给方案五（模式库）
方案四（记忆）→ 影响方案三（学习管道）的知识留存
方案一（目标）→ 为方案二（反思）提供上下文

协调机制：
- 每周协调检查（cron）
- 跨方案指标对比
- 冲突仲裁规则
```

---

## 四、成功指标

| 方案 | 指标 |
|------|------|
| 方案一 | 跨 N 次会话后目标完成率；目标状态一致性 |
| 方案二 | 同类错误复现率下降；反思产出被采纳比率 |
| 方案三 | 知识命中率；误导率 |
| 方案四 | 记忆库增长率；遗忘后回答质量无显著下降 |
| 方案五 | 模式命中时准确率 vs 未命中对比；模式复用频次 |

---

## 五、待办任务

- [ ] 阶段一：实现元认知反思日志 V2（cron + 三级反思）
- [ ] 阶段二：实现长期目标追踪 V2（Neo4j Goal 图谱）
- [ ] 阶段二：协调层设计
- [ ] 阶段三：记忆价值评分系统
- [ ] 阶段三：主动学习管道
- [ ] 阶段四：推理模式库

---

_评审模型：Claude Opus (4sapi) + DeepSeek Reasoner_
_评审时间：2026-04-04_
