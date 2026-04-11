
[无内容 - 不使用心跳机制]

如需启用，按需添加实际检查任务：
- 检查未完成任务（task-crud）
- 检查服务状态（pm2 list）
- 检查新消息/通知

## Hermes Memory Failover Queue

Every heartbeat, check if there are pending Hermes memories:
```bash
python3 /home/ai/.openclaw/workspace/scripts/check-hermes-queue.py
```
If pending > 0, run recovery:
```bash
python3 /home/ai/.openclaw/workspace/scripts/hermes-memory-recovery.py
```