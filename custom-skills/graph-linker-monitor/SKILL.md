# graph-linker-monitor Skill

监控 graph-linker 实时状态、积压消化速度和健康状况。

## 使用场景
主人说「检查 graph-linker 状态」「graph-linker 积压情况」「查看 graph-linker 速度」时调用。

## 调用方式
```bash
node /home/ai/.openclaw/workspace/custom-skills/graph-linker-monitor/check-graph-linker.js
```

## 输出内容
- Stream 概况（长度、时间跨度、最早/最新消息时间）
- Consumer 状态（Consumer 名、Idle 时间、Pending 数量）
- 积压分析（去重后 memoryId 数、重复投递数）
- 速率分析（Producer / Consumer 条/小时）
- 预估时间（纯消费清空时间、平衡点、稳定所需时间）

## 依赖
- Redis Stream `graph:sync:events`
- Consumer Group `graph-linkers`
- ioredis（在 memory-system/node_modules 下）
