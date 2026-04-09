
const express = require('express');
const QueryLayer = require('./query-layer.js');
const app = express();
app.use(express.json());

const queryLayer = new QueryLayer({ cacheTtl: 300, maxResults: 20 });

// 初始化连接
queryLayer.connect().then(connected => {
  if (!connected) {
    console.error('⚠️  Neo4j 连接失败，查询层降级运行');
  }
});

// 查询接口
app.post('/query', async (req, res) => {
  try {
    const { query, userId, sessionId, context } = req.body;
    if (!query) {
      return res.status(400).json({ success: false, error: 'query is required' });
    }
    const results = await queryLayer.query(query, userId || 'default', sessionId, context || {});
    res.json({ success: true, data: results, stats: queryLayer.getStats() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 健康检查
app.get('/health', async (req, res) => {
  const stats = queryLayer.getStats();
  res.json({
    status: 'healthy',
    layer: 'query',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    stats
  });
});

// 统计信息
app.get('/stats', (req, res) => {
  res.json(queryLayer.getStats());
});

// 清除缓存
app.post('/cache/flush', (req, res) => {
  queryLayer.cache.flushAll();
  res.json({ success: true, message: 'Cache flushed' });
});

const PORT = 31234;
app.listen(PORT, () => {
  console.log(`✅ 查询层 HTTP API 运行在 http://localhost:${PORT}`);
});
