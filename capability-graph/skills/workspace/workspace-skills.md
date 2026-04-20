# 工作区 Skill（skills/）

## clawteam（v1.0.0）
- **路径**：`skills/clawteam/`
- **能力**：多智能体团队协同。创建团队、任务依赖、消息通信、看板监控
- **模板**：hedge-fund / code-review / research-paper
- **详见**：`tools/clawteam.md`（能力图谱工具卡片）

## defuddle
- **路径**：`skills/defuddle/`
- **能力**：网页内容提取。将 URL 转为干净的 Markdown，去除广告和导航
- **触发**：用户提供 URL 需要读取/分析时
- **限制**：不用于 .md 结尾的 URL

## find-skills-skill
- **路径**：`skills/find-skills-skill/`
- **能力**：搜索和发现 OpenClaw 技能
- **触发**：需要查找新功能或新 skill 时

## json-canvas
- **路径**：`skills/json-canvas/`
- **能力**：创建和编辑 Obsidian Canvas 文件（.canvas）
- **触发**：需要视觉画布/思维导图/流程图时

## obsidian-markdown
- **路径**：`skills/obsidian-markdown/`
- **能力**：创建和编辑 Obsidian 风格的 Markdown（wikilinks/callouts/properties）
- **触发**：处理 .md 文件且需要 Obsidian 特定语法时

## skill-vetter（v1.0.0）
- **路径**：`skills/skill-vetter/`
- **能力**：安全审查。安装任何 skill 前检查权限范围和可疑模式
- **触发**：从 ClawdHub/GitHub 安装 skill 前

## web-search-ex-skill（v1.3.0）
- **路径**：`skills/web-search-ex-skill/`
- **能力**：通用网络搜索（百度/必应/DuckDuckGo）
- **触发**：需要联网搜索实时信息
- **特点**：无需 API 密钥
