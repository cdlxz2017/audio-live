const Redis = require('redis');
const path = require('path');

/**
 * 用户映射管理：sessionKey -> userId
 * 使用 Redis 存储，TTL 可配置
 */
function getUserMapping(api) {
  const pluginConfig = api.pluginConfig || {};
  const cacheTtl = pluginConfig.cacheTtlSeconds || 86400;
  let redisClient = null;
  let redisConfig = null;
  const workspaceDir = api.config.workspace?.dir || process.env.OPENCLAW_WORKSPACE;

  function loadRedisConfig() {
    if (redisConfig) return redisConfig;
    if (!workspaceDir) {
      api.logger.warn('[memory-recall] No workspace directory, using default Redis config.');
      redisConfig = {};
      return redisConfig;
    }
    try {
      const configPath = path.join(workspaceDir, 'memory-system', 'scripts', 'config.js');
      const memConfig = require(configPath);
      redisConfig = memConfig.redis || {};
    } catch (err) {
      api.logger.warn(`[memory-recall] Failed to load memory-system config: ${err.message}, using defaults.`);
      redisConfig = {};
    }
    return redisConfig;
  }

  function getRedisClient() {
    if (!redisClient) {
      const config = loadRedisConfig();
      const url = process.env.REDIS_URL || config.url || `redis://${config.host || 'localhost'}:${config.port || 6379}`;
      redisClient = Redis.createClient({ url });
      redisClient.on('error', (err) => {
        api.logger.error(`[memory-recall] Redis error: ${err.message}`);
      });
      redisClient.connect().catch(err => {
        api.logger.error(`[memory-recall] Redis connect failed: ${err.message}`);
      });
    }
    return redisClient;
  }

  async function setUserForSession(sessionKey, userId) {
    try {
      const client = getRedisClient();
      const key = `memory:recall:user:${sessionKey}`;
      await client.set(key, userId, { EX: cacheTtl });
    } catch (err) {
      api.logger.warn(`[memory-recall] Failed to set user mapping: ${err.message}`);
    }
  }

  async function getUserForSession(sessionKey) {
    try {
      const client = getRedisClient();
      const key = `memory:recall:user:${sessionKey}`;
      const userId = await client.get(key);
      return userId;
    } catch (err) {
      api.logger.warn(`[memory-recall] Failed to get user mapping: ${err.message}`);
      return null;
    }
  }

  async function removeUserForSession(sessionKey) {
    try {
      const client = getRedisClient();
      const key = `memory:recall:user:${sessionKey}`;
      await client.del(key);
    } catch (err) {
      api.logger.warn(`[memory-recall] Failed to remove user mapping: ${err.message}`);
    }
  }

  return {
    setUserForSession,
    getUserForSession,
    removeUserForSession,
  };
}

module.exports = { getUserMapping };