# Redis

## 基本信息
- **类型**：缓存 / 消息队列
- **端口**：6379
- **状态**：✅ 正常

## 用途
- Session 缓存
- graph:sync:events Stream（供 graph-linker 消费）
- 注：memory:messages Stream 已废弃

## 常用命令
```bash
redis-cli ping
redis-cli monitor
```
