# Gateway 重启 SOP（标准操作流程）

> **版本**: v1.0  
> **创建时间**: 2026-04-03  
> **最后更新**: 2026-04-03

---

## 📋 流程概览

```
┌─────────────────────────────────────────────────────────┐
│  1. 阅读技术手册    →    2. 备份配置文件                │
│         ↓                          ↓                    │
│  4. 验证配置文件    ←    3. 语法检查                   │
│         ↓                                               │
│  5. 重启 Gateway    →    6. 验证结果                   │
│                          ↓                              │
│                    ⚠️ 紧急回滚（备用）                  │
└─────────────────────────────────────────────────────────┘
```

---

## 步骤 1：阅读技术手册

**目标**：理解目标配置字段的语法、作用、取值范围

| 检查项 | 说明 |
|--------|------|
| 配置字段含义 | 确认该字段在 OpenClaw 中的作用 |
| 合法取值范围 | 如 `true/false`、数字范围、枚举值 |
| 依赖关系 | 修改是否影响其他字段 |
| 文档位置 | `/home/ai/.npm-global/lib/node_modules/openclaw/docs/` |

**操作**：
```bash
# 查看 OpenClaw 配置文档
cat /home/ai/.npm-global/lib/node_modules/openclaw/docs/configuration.md

# 或使用 jq 查看配置结构
jq 'keys' /home/ai/.openclaw/openclaw.json
```

---

## 步骤 2：备份配置文件

**目标**：确保可以回滚到修改前的状态

| 检查项 | 说明 |
|--------|------|
| 备份文件命名 | `openclaw.json.bak.{timestamp}` |
| 备份完整性 | 备份文件内容与原文件一致 |
| 备份位置 | 与原文件同一目录 |

**操作**：
```bash
# 创建带时间戳的备份
cp /home/ai/.openclaw/openclaw.json /home/ai/.openclaw/openclaw.json.bak.$(date +%Y%m%d%H%M%S)

# 验证备份成功
ls -la /home/ai/.openclaw/openclaw.json.bak.* | tail -3
```

---

## 步骤 3：语法检查

**目标**：确保配置文件是合法的 JSON 格式

| 检查项 | 说明 |
|--------|------|
| JSON 语法 | 无逗号/引号错误 |
| 字段完整性 | 所有必需字段存在 |
| 类型正确 | 字符串、数字、布尔值类型正确 |
| 变更点隔离 | 只修改目标字段 |

**操作**：
```bash
# 使用 jq 验证 JSON 语法
jq empty /home/ai/.openclaw/openclaw.json && echo "✅ JSON 语法正确"

# 验证特定字段存在
jq '.tools.exec' /home/ai/.openclaw/openclaw.json

# 对比备份与当前文件的差异
diff /home/ai/.openclaw/openclaw.json.bak.* /home/ai/.openclaw/openclaw.json
```

---

## 步骤 4：修改配置文件

**目标**：使用 `edit` 工具精确修改目标字段

| 检查项 | 说明 |
|--------|------|
| 编辑工具 | 仅使用 `edit`，禁止 `write` |
| 原子性 | 每次修改一个逻辑单元 |
| 变更记录 | 记录旧值和新值 |

**操作**：
```bash
# 使用 edit 工具，oldText 必须完全匹配文件内容
# newText 为替换内容
```

---

## 步骤 5：二次验证

**目标**：确认修改符合预期，无语法错误

| 检查项 | 说明 |
|--------|------|
| JSON 有效性 | `jq empty` 通过 |
| 字段值正确 | 目标字段已更新 |
| 变更范围 | 无意外变更 |

**操作**：
```bash
# 验证 JSON 语法
jq empty /home/ai/.openclaw/openclaw.json && echo "✅ JSON 语法正确"

# 查看变更的字段
jq '.tools.exec' /home/ai/.openclaw/openclaw.json

# 检查配置有效性（如果 openclaw 有 validate 命令）
openclaw config validate 2>/dev/null || echo "无 validate 命令，跳过"
```

---

## 步骤 6：重启 Gateway

**目标**：使配置生效

| 检查项 | 说明 |
|--------|------|
| 重启前状态 | 记录当前 Gateway PID |
| 重启命令 | 使用 `gateway restart` |
| 重启后验证 | 确认新配置生效 |

**操作**：
```bash
# 重启前记录状态
openclaw gateway status

# 执行重启
openclaw gateway restart

# 重启后验证
sleep 3
openclaw gateway status
```

---

## ⚠️ 紧急回滚流程

### 触发条件

| 情况 | 说明 |
|------|------|
| **A. Gateway 无法启动** | 重启后服务无法正常运行 |
| **B. 功能异常** | 配置变更导致预期外行为 |
| **C. JSON 无效** | `jq empty` 报错 |
| **D. 用户要求** | 用户主动要求回滚 |

### 回滚流程

```
紧急回滚开始
    ↓
步骤 1：立即停止 Gateway
命令：openclaw gateway stop
    ↓
步骤 2：找到最新备份文件
命令：ls -t /home/ai/.openclaw/openclaw.json.bak.*
    ↓
步骤 3：恢复备份到主配置文件
命令：cp /home/ai/.openclaw/openclaw.json.bak.[最新] /home/ai/.openclaw/openclaw.json
    ↓
步骤 4：验证恢复的配置文件
命令：jq empty /home/ai/.openclaw/openclaw.json
    ↓
步骤 5：重启 Gateway
命令：openclaw gateway start
    ↓
步骤 6：验证服务正常
命令：openclaw gateway status
    ↓
紧急回滚完成
```

### 快速回滚命令集

```bash
# === 一键紧急回滚 ===
openclaw gateway stop && \
LATEST=$(ls -t /home/ai/.openclaw/openclaw.json.bak.* 2>/dev/null | head -1) && \
[ -n "$LATEST" ] && cp "$LATEST" /home/ai/.openclaw/openclaw.json && \
jq empty /home/ai/.openclaw/openclaw.json 2>/dev/null && \
echo "✅ 配置已恢复: $LATEST" && \
openclaw gateway start && \
echo "✅ Gateway 已重启"
```

### 回滚后检查清单

| 检查项 | 命令 | 预期结果 |
|--------|------|----------|
| JSON 有效 | `jq empty openclaw.json` | 无输出 |
| 字段值正确 | `jq '.tools.exec' openclaw.json` | 回滚前的值 |
| Gateway 运行 | `openclaw gateway status` | running |
| 功能验证 | (根据变更内容) | 预期行为 |

---

## ❌ 禁止事项

| 禁止 | 说明 |
|------|------|
| 禁止 `write` 工具 | 可能覆盖整个配置文件 |
| 禁止无备份修改 | 无法回滚 |
| 禁止跳过语法检查 | 可能导致 Gateway 无法启动 |
| 禁止跳过手册阅读 | 可能理解错误字段含义 |
| 禁止跳过停止步骤 | 可能导致配置文件被占用 |
| 禁止不验证就启动 | 可能带着错误配置启动 |
| 禁止删除备份 | 回滚后旧备份仍有保留价值 |
| 禁止强制覆盖 | 使用 `cp` 而非重定向 |

---

## 📝 变更记录模板

```
## [时间] 配置变更记录

- 变更文件: /home/ai/.openclaw/openclaw.json
- 变更内容: 
  - 字段: xxx
  - 旧值: xxx
  - 新值: xxx
- 变更原因: xxx
- 备份文件: openclaw.json.bak.[timestamp]
- 执行人: AI / 人工
- 语法检查: ✅/❌
- 重启结果: ✅/❌
- 验证结果: ✅/❌
```

---

## 回滚记录模板

```
## [时间] 紧急回滚记录

- 触发条件: [A/B/C/D]
- 变更文件: /home/ai/.openclaw/openclaw.json
- 回滚备份: openclaw.json.bak.[timestamp]
- 回滚原因: [描述]
- 执行人: AI / 人工
- 验证结果: ✅/❌
```

---

_此 SOP 为 OpenClaw Gateway 配置修改的标准流程，必须严格遵守。_
