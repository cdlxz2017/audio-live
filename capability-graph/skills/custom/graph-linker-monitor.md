# graph-linker 监控

## 基本信息
- **类型**：监控工具
- **路径**：`custom-skills/graph-linker-monitor/`
- **来源**：自制
- **状态**：✅ 正常

## 能力
- 查看 graph-linker 实时状态
- Stream 积压分析
- 消费速度评估
- 预估清空时间

## 调用
```bash
node .../check-graph-linker.js
```

## 输出
- Stream 概况（长度/时间跨度）
- Consumer 状态（Idle 时间/Pending 数）
- 积压分析（去重后 memoryId 数）
- 速率分析（Producer/Consumer 条/小时）

## 依赖
- Redis Stream: graph:sync:events
- Consumer Group: graph-linkers
