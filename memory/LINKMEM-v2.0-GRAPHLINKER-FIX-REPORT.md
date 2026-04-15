# Graph-Linker 崩溃循环修复报告

**日期**: 2026-04-16 06:56 CST
**问题**: graph-linker PM2 进程持续报错 `redis.xlen is not a function`（累计 7096+ 次循环错误）

## 根因分析

`reliable-stream-consumer.js` 的 `consumeLoop()` 方法（第 56 行）调用 `redis.xlen(this.stream)` 进行 Stream 长度检查和 XTRIM 裁剪。

但 `redis.js` 模块虽然基于 ioredis（ioredis 原生支持 `xlen`），其导出对象中**缺少 `xlen` 包装函数**。导出列表只有：`xadd`, `xreadgroup`, `xack`, `xpending`, `xautoclaim`, `xinfo`，没有 `xlen`。

`reliable-stream-consumer.js` 通过 `const redis = require('./redis')` 引入的是模块导出对象，不是 ioredis 客户端实例，因此 `redis.xlen()` 不存在。

## 修复内容

**文件**: `memory-system/scripts/redis.js`

添加 `xlen` 包装函数并加入导出：

```javascript
/**
 * XLEN - 获取 Stream 长度
 */
async function xlen(stream) {
  const client = getClient();
  return await client.xlen(stream);
}
```

导出列表新增 `xlen`。

## 验证结果

| 检查项 | 结果 |
|--------|------|
| PM2 重启后 error log | ✅ 空（无新错误） |
| PM2 进程状态 | ✅ online, restarts=0, uptime=2m+ |
| 消息处理 | ✅ 正常消费并写入 Neo4j（Created memory node） |
| Redis Stream 长度 | ✅ 6047→6049（正常波动，消费正常） |
| 旧错误循环 | ✅ 已终止（flush 后无新错误） |

## 影响范围

- 仅修改 `redis.js`，添加一个纯透传函数
- 不影响其他消费者或 Redis 操作
- `reliable-stream-consumer.js` 无需修改
