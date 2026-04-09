# 活跃任务

> 基于 2026-04-05 日志提取，首次建立
> 最后更新：2026-04-06

---

## 🔴 进行中

- [ ] gateway 统一入口源码补全
  ID: TASK-20260405-001
  创建: 2026-04-05 17:00
  更新: 2026-04-05 19:46
  优先级: P0
  状态: 进行中
  memory_ref: "gateway 路由分发 JWT 微服务 2026-04-05"
  上下文: /projects/tiandao-system/services/gateway/
  验证方式: curl -s -o /dev/null -w "%{http_code}" localhost:3011/health | grep 200
  超时: 10s
  重试: 3次
  记忆上下文:
    · 2026-04-05 17:00 | gateway 空壳，缺少路由分发源码
    · 2026-04-05 19:46 | 10个微服务已上线，gateway 待对接
    · 待办：Express/Fastify 路由 + JWT 中间件

---

## 🟡 待处理

- [ ] admin-app 前端界面开发
  ID: TASK-20260405-002
  创建: 2026-04-05 17:00
  更新: 2026-04-05 19:46
  优先级: P1
  状态: 待处理
  memory_ref: "admin-app React 前端 2026-04-05"
  上下文: /projects/tiandao-system/services/admin-app/
  验证方式: curl -s localhost:3000 | grep -q "title"
  超时: 10s
  重试: 3次
  依赖: [TASK-20260405-001]
  记忆上下文:
    · 2026-04-05 19:46 | admin-app 是空壳，需要 React/Vue 界面
    · 关联：需 gateway 源码完成后才能对接

---

## ⚫ 阻塞

- [ ] karma-service 重启数异常
  ID: TASK-20260405-003
  创建: 2026-04-05 19:46
  更新: 2026-04-05 19:46
  优先级: P0
  状态: 阻塞
  memory_ref: "karma-service restart 853 2026-04-05"
  上下文: /projects/tiandao-system/services/karma-service/
  阻塞原因: 业力触发逻辑循环调用，导致 853 次重启/小时
  等待: PM2 日志定位根因，检查 karma-service 业务逻辑
  验证方式: pm2 monit（观察1小时 restart count 不增加）
  超时: -
  重试: -
  记忆上下文:
    · 2026-04-05 19:46 | PM2 显示 853 次重启/小时
    · 原因：业力触发逻辑存在循环调用
    · 关联：karma-service 高重启可能影响 gateway 接入

- [ ] technique-service 重启数异常
  ID: TASK-20260405-004
  创建: 2026-04-05 19:46
  更新: 2026-04-05 19:46
  优先级: P1
  状态: 阻塞
  memory_ref: "technique-service restart 9721 2026-04-05"
  上下文: /projects/tiandao-system/services/technique-service/
  阻塞原因: 事件订阅代码 startConsuming 可能死循环，导致 9721 次重启/小时
  等待: 检查 startConsuming 逻辑，定位死循环位置
  验证方式: pm2 monit（观察1小时 restart count 不增加）
  超时: -
  重试: -
  记忆上下文:
    · 2026-04-05 19:46 | PM2 显示 9721 次重启/小时
    · 原因：事件订阅代码 startConsuming 可能死循环

---

- [ ] 远程录音系统文档更新
  ID: TASK-20260406-001
  创建: 2026-04-06 19:26
  更新: 2026-04-06 19:26
  优先级: P2
  状态: 进行中
  memory_ref: "SOP-AUDIO-STREAM.md 更新 2026-04-06"
  上下文: /workspace/custom-skills/audio-stream/ + /workspace/custom-skills/camera-recorder/
  验证方式: cat SOP-AUDIO-STREAM.md | grep "DashScope"
  超时: 5s
  重试: 1次
  依赖: []
  记忆上下文:
    · 2026-04-06 19:26 | SOP 已更新 ASR 流程（DashScope Fun-ASR 主用 + Whisper 备用）
    · 2026-04-06 19:26 | transcriber.py 已重写，双引擎回退
    · 2026-04-06 19:26 | 音频流：stream-server.js → audio_post_process.py → transcriber.py
    · 2026-04-06 19:26 | 文件存储：~/.openclaw/workspace/custom-skills/audio-stream/recordings/
    · 2026-04-06 19:26 | PM2 管理：pm2 list audio-stream
