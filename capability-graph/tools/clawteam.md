# ClawTeam

## 基本信息
- **类型**：CLI / 多智能体协同工具
- **命令**：`clawteam`
- **状态**：✅ 已安装
- **安装方式**：pip

## 核心能力
- 创建团队，每个成员独立运行在 tmux + git worktree
- 任务依赖管理（--blocked-by）
- 团队内消息通信（inbox send/broadcast）
- 看板监控（board show/attach/serve）
- 3 个预置模板：hedge-fund / code-review / research-paper

## 适用场景
- 复杂任务拆分多人并行执行
- 方案设计与审查分离
- 代码开发+测试并行

## 常用命令
```bash
clawteam team spawn-team <name> -d "<desc>" -n <leader>    # 创建团队
clawteam task create <team> "<subject>" -o <owner>          # 创建任务
clawteam spawn -t <team> -n <name> --task "<task>"          # 拉起 Agent
clawteam board show <team>                                   # 看板
clawteam team cleanup <team> --force                         # 清理
```

## 已知限制
- 每个 Agent 消耗独立的 session/token
- 需要 tmux 可用
- 默认使用 openclaw 作为 agent 后端

## 存储路径
- 所有状态：~/.clawteam/

## 卓越执行框架中的角色映射
| 角色 | 首选模型 | 替补 |
|------|---------|------|
| Architect | opus-4-6 | deepseek-reasoner |
| Builder | sonnet-4-6 | deepseek-chat |
| Reviewer | opus-4-6 | deepseek-reasoner |
| Tester | sonnet-4-6 | deepseek-chat |
| Writer | sonnet-4-6 | deepseek-chat |

## 历史使用记录
| 日期 | 任务 | 结果 |
|------|------|------|
| 2026-04-19 | SOP 评审（Opus/DeepSeek 子程序） | ✅ 成功 |
