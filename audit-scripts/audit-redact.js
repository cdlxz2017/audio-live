/**
 * audit-redact.js — 敏感信息脱敏模块
 * v1.0 — 2026-04-20
 * 
 * 使用方式：
 *   const { redact } = require('./audit-redact');
 *   const clean = redact({ password: 'secret123', apiKey: 'sk-xxx' });
 */

'use strict';

// 完全隐藏的字段（P0）
const REDACT_FULL = new Set([
  'password', 'passwd', 'pwd', 'pass',
  'secret', 'token', 'api_key', 'apikey', 'apiKey',
  'private_key', 'privateKey', 'credential', 'credentials',
  'authorization', 'auth_token', 'access_token', 'refresh_token',
  'x-api-key', 'x-api-key',
]);

// 部分隐藏的字段（P1）
const REDACT_PARTIAL = new Set([
  'email', 'phone', 'mobile', 'tel',
  'ip', 'ip_address', 'ipAddress',
  'session_id', 'sessionId', 'session_id',
  'user_id', 'userId', 'user_id',
  'token', 'jwt',
]);

// 大字段截断长度
const MAX_VALUE_LEN = 200;

// 超过此大小认为是「大字段」，不记录内容
const LARGE_FIELD_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * 判断字段名是否匹配脱敏规则
 */
function matchRedact(fieldPath, value) {
  const lower = fieldPath.toLowerCase();
  
  // 检查 P0 完全隐藏
  for (const key of REDACT_FULL) {
    if (lower.includes(key)) return 'full';
  }
  
  // 检查 P1 部分隐藏
  for (const key of REDACT_PARTIAL) {
    if (lower.includes(key)) return 'partial';
  }
  
  // 大字段
  if (typeof value === 'string' && value.length > LARGE_FIELD_SIZE) {
    return 'size';
  }
  
  return null;
}

/**
 * 部分隐藏：显示前3后3位
 */
function partialRedact(str) {
  if (!str || str.length <= 6) return '[REDACTED-P1]';
  return str.slice(0, 3) + '***' + str.slice(-3);
}

/**
 * 大字段：只记录长度和类型
 */
function sizeRedact(value) {
  if (typeof value === 'string') {
    return `[REDACTED-SIZE:${value.length}B]`;
  }
  if (Buffer.isBuffer(value)) {
    return `[REDACTED-BUFFER:${value.length}B]`;
  }
  return '[REDACTED-UNKNOWN]';
}

/**
 * 递归脱敏对象
 */
function redactDeep(obj, path = '') {
  if (obj === null || obj === undefined) return obj;
  
  // 处理数组
  if (Array.isArray(obj)) {
    return obj.map((item, i) => redactDeep(item, `${path}[${i}]`));
  }
  
  // 处理对象
  if (typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      const fieldPath = path ? `${path}.${key}` : key;
      const redactType = matchRedact(key, value);
      
      if (redactType === 'full') {
        result[key] = '[REDACTED-P0]';
      } else if (redactType === 'partial') {
        result[key] = typeof value === 'string' ? partialRedact(value) : value;
      } else if (redactType === 'size') {
        result[key] = sizeRedact(value);
      } else if (typeof value === 'object') {
        result[key] = redactDeep(value, fieldPath);
      } else if (typeof value === 'string' && value.length > MAX_VALUE_LEN) {
        result[key] = value.slice(0, MAX_VALUE_LEN) + '...[TRUNCATED]';
      } else {
        result[key] = value;
      }
    }
    return result;
  }
  
  // 原始类型直接返回
  return obj;
}

/**
 * 主入口：脱敏任意对象
 */
function redact(data) {
  if (!data) return data;
  return redactDeep(data);
}

/**
 * 便捷方法：只脱敏特定字段
 */
function redactFields(data, fields) {
  const result = { ...data };
  for (const field of fields) {
    if (result[field] !== undefined) {
      result[field] = '[REDACTED-P0]';
    }
  }
  return result;
}

module.exports = {
  redact,
  redactFields,
  redactDeep,
  REDACT_FULL,
  REDACT_PARTIAL,
};
