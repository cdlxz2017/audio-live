# 系统清洁与软件安装 SOP

> 确保系统干净、安装有规律、可追溯。
> 最后更新：2026-04-05

---

## 一、目录结构规范

### 顶级目录分工

```
/home/ai/
├── projects/          # 自主开发项目（Git 托管）
├── apps/             # 第三方应用/工具（npm install -g / pip install / 压缩包）
├── services/        # 长期运行的服务进程（PM2 / systemd / Docker）
├── scripts/         # 工具脚本（运维用）
├── backups/         # 数据备份
├── logs/            # 日志输出
├── venvs/           # Python 虚拟环境（隔离）
├── node-modules/    # Node 全局模块（备用，非污染系统）
└── .config/         # 配置文件 Git 仓库（符号链接到实际位置）
```

**原则**：
- 日常开发项目 → `projects/`
- 一行命令装好的工具 → `apps/` 下建目录
- 不知道装哪里的东西 → 禁止乱放，先问再定

### Workspace 内部结构

```
/home/ai/.openclaw/workspace/
├── projects/           # 客户项目 / 长期项目
├── custom-skills/     # 自定义 Skills
├── plugins/           # OpenClaw 插件
├── memory-system/     # 记忆系统（独立项目）
└── SOP-*.md          # 所有 SOP 文档放根目录
```

---

## 二、环境隔离规范

### Node.js

- **禁止** `npm install -g` 污染系统全局
- 使用 `nvm` 管理多版本（当前：v22.22.1）
- 全局模块安装到 `~/ai/node-modules/` 或项目本地 `node_modules`

```bash
# 查看当前 node 版本
nvm current

# 安装新版本
nvm install 22

# 项目本地安装
cd ~/ai/projects/xxx && npm install
```

### Python

- 系统 Python 仅用于：系统脚本（/usr/bin/python3）
- 所有项目用 `venv` 隔离

```bash
# 创建虚拟环境
python3 -m venv ~/ai/venvs/<项目名>

# 激活
source ~/ai/venvs/<项目名>/bin/activate

# 日常使用（不用每次加路径）
alias workon<项目>='source ~/ai/venvs/<项目名>/bin/activate'
```

### Docker

- 数据库、中间件优先使用 Docker（不污染宿主机）
- Docker 数据目录挂载到 `~/ai/services/docker-volumes/`

---

## 三、软件安装 SOP

**每次安装前先回答：这东西装来干什么？用多久？存哪？**

### 3.1 npm 全局包

```
允许条件：必须在命令行直接调用（如 pm2、http-server）
步骤：
  1. npm install -g <package>  （系统 npm 即可）
  2. 记录到本文档末尾「全局包清单」
  3. 禁止：npm install -g 装项目依赖
```

### 3.2 pip / pip3

```
允许条件：系统工具脚本
步骤：
  1. 确认是否需要 venv
  2. pip3 install <package>
  3. 记录到本文档末尾「Python 包清单」
```

### 3.3 apt 安装

```
允许条件：系统级依赖（nginx、redis-tools 等）
步骤：
  1. 确认包名和用途
  2. sudo apt install <package>
  3. 记录到本文档末尾「系统包清单」
```

### 3.4 第三方压缩包 / 二进制

```
步骤：
  1. 下载到 ~/ai/apps/<名称>/
  2. 不要污染 /usr/local/ 或 $HOME
  3. 二进制加执行权限
  4. 在 ~/ai/scripts/ 或项目内建立启动脚本
  5. 记录到本文档末尾「第三方应用清单」
```

### 3.5 项目级依赖

```
每个项目自己的 node_modules / venv
禁止把项目依赖装到 ~/apps/ 或系统路径
```

---

## 四、Git 提交规范

### 4.1 配置文件仓库

关键配置文件（nginx、docker-compose、pm2.config.js、crontab 等）统一用 Git 管理：

```bash
cd ~/ai/.config
git add <file>
git commit -m "<type>: <description>"

# 类型：
# install:    新安装软件
# config:     配置变更
# remove:     卸载/删除
# update:     版本更新
# patch:      临时修复
```

### 4.2 提交信息格式

```
<type>: <简短描述>

[可选正文：解释 why，不解释 what]

Type 枚举：
  install  — 新软件/新环境
  config   — 配置修改
  remove   — 删除/卸载
  update   — 版本更新
  patch    — Bug/问题修复
  refactor — 重构（无功能变化）
  docs     — 文档变更
```

**示例**：
```
install: 添加 nginx 反向代理配置

config: openclaw gateway 端口改为 18789

remove: 卸载 tianfa 系统（用户确认）
```

### 4.3 Git 仓库清单

| 路径 | 用途 |
|------|------|
| `~/ai/.config/` | 系统配置文件 Git |
| `~/ai/.openclaw/workspace/projects/<name>/` | 各项目自己的 Git |

---

## 五、日常检查清单

### 每周一次

- [ ] `df -h /` 检查磁盘空间
- [ ] `pm2 list` 检查进程是否异常
- [ ] `~/ai/scripts/` 下是否有临时文件未清理
- [ ] `~/ai/apps/` 下是否有废弃应用

### 每次安装后

- [ ] 记录到本文档末尾清单
- [ ] 是否需要启动脚本（放进 `~/ai/scripts/`）
- [ ] 是否需要 systemd service 或 PM2 配置
- [ ] 是否需要 crontab 记录
- [ ] 确认 Git commit（install 类型）

---

## 六、全局包清单

（格式：包名 | 版本 | 用途 | 安装日期）

| 包名 | 版本 | 用途 | 日期 |
|------|------|------|------|
| pm2 | latest | 进程管理 | 2026-04-01 |

---

## 七、系统包清单

（格式：包名 | 版本 | 用途 | 安装日期）

当前无记录（系统自带）

---

## 八、第三方应用清单

（格式：应用名 | 版本 | 路径 | 用途 | 日期）

当前无记录

---

## 九、Python 包清单

（格式：包名 | 版本 | 环境 | 用途 | 日期）

当前无记录

---

## 十、已安装应用记录

### OpenClaw-Admin

| 项目 | 内容 |
|------|------|
| 名称 | OpenClaw-Admin |
| 类型 | 第三方 Web 管理平台（itq5/OpenClaw-Admin） |
| 路径 | `/home/ai/projects/OpenClaw-Admin/` |
| 前端端口 | 3031（Vite dev server） |
| 后端端口 | 3030（Express API） |
| 用途 | OpenClaw Gateway 的 Web 管理界面（仪表盘/会话/记忆/模型/频道/技能/终端等） |
| 启动方式 | PM2（`pm2 start ecosystem.config.cjs`） |
| 访问地址 | http://localhost:3031 |
| 认证 | admin / admin（.env 中配置） |
| Gateway Token | 已填入 .env（OPENCLAW_AUTH_TOKEN） |
| Git 仓库 | 已有（克隆自带），已提交 PM2 配置 |
| 安装日期 | 2026-04-05 |
| 注意事项 | `.env` 包含敏感 token，不提交 git |
| 端口冲突 | 原 3001 被 pm2-webui 占用，已改用 3030/3031 |
