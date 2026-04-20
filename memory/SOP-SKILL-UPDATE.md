# Skill 更新检查 SOP — 自动检查 + 手动确认 + 执行保护

> 版本：v1.0
> 创建：2026-04-21
> 目的：将 skill 从"装完不管"变为"持续维护"

---

## 一、运行机制

```
每天 09:00 cron 自动运行
  │
  ├─→ 检查所有已安装 skill 的最新版本
  │
  ├─→ 对比当前安装版本
  │
  ├─→ 生成《Skill 更新报告》
  │     ├─ 保存到 memory/skill-updates/YYYY-MM-DD.md
  │     └─ 邮件通知主人
  │
  └─→ 等待主人决策
        │
        ├─→ 主人说"更新第X个" → 执行更新（带快照保护）
        │
        └─→ 主人说"全部跳过" → 结束
```

---

## 二、更新执行 SOP（当主人确认后）

### Step 1：执行前检查
```
1. 确认要更新的 skill 名称
2. 读取当前 SKILL.md 对比变化点
3. 确认没有 breaking changes
```

### Step 2：安全审核（强制）
```
skill-vetter <skill-slug>
```
- 必须先完成安全审核才能继续
- 审核不通过 → 终止更新，报告主人
- 审核标准：VT suspicious = ❌ / 外部 API key = ⚠️ / 代码审查通过 = ✅

### Step 3：快照保护（如果已安装 arc-skill-gitops）
```
arc-skill-gitops snapshot --skill ~/.openclaw/workspace/skills/<skill-name> --tag "pre-auto-update-$(date +%Y%m%d)"
```

### Step 4：执行更新
```
clawhub update <skill-slug>
```

### Step 5：验证
```
1. 读取新的 SKILL.md，确认安装成功
2. 运行 health-check.js，确认系统正常
3. 如有异常 → arc-skill-gitops rollback
```

### Step 5：文档闭环
```
1. 更新 memory/skill-updates/YYYY-MM-DD.md（标记已更新）
2. 如有 breaking changes → 更新 SYSTEMS.md 相关章节
3. 如有新增命令/功能 → 更新 TOOLS.md
```

---

## 三、安装新 Skill（不只是更新）

**任何 skill 安装前也必须审核**：
```bash
# 主人说"帮我安装 xxx skill"
# 第一步：安全审核（强制）
skill-vetter <skill-slug>
# 审核不通过 → 终止，报告原因

# 第二步: 审核通过后 → 执行安装
clawhub install <skill-slug>

# 第三步：文档闭环
# 更新 SYSTEMS.md / MEMORY.md / 当日日记
```

## 四、本地 Skill（不在 clawhub）的更新方式

| Skill | 更新方式 |
|-------|---------|
| clawteam | 从原始仓库拉取（`git pull`）|
| defuddle | npm 包更新（`npm update -g defuddle`）|
| json-canvas | 同上 |
| obsidian-markdown | 同上 |

> 本地 skill 检查频率：每月一次（不在每日检查范围内）

---

## 四、文件结构

```
memory/
└── skill-updates/
    ├── 2026-04-21.md   ← 每日更新报告
    └── ...

scripts/
└── skill-update-checker.sh   ← 每日检查脚本
```

---

## 六、禁止事项

- ❌ 禁止未经安全审核安装或更新任何 skill
- ❌ 禁止全自动更新（不经过主人确认）
- ❌ 禁止同时更新多个 skill
- ❌ 禁止跳过验证步骤
- ❌ 禁止在没有快照保护的情况下更新生产环境 skill
