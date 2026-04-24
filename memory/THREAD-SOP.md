# Thread 管理标准操作流程

> **铁律**：主脑 Problem Thread 是所有工作的第一公民。禁止先执行后补 Thread。
> 触发词：Thread / 新建任务 / 开始工作 / 启动卓越模式

---

## 一、Thread 生命周期

```
主人授权 → 创建 Thread → 执行 → 文档闭环 → 更新 Thread → 归档
     ↑           ↑           ↑         ↑          ↑
   起点       确认授权     执行任务   更新文档    标记完成
```

---

## 二、创建标准（何时必须新建 Thread）

| 场景 | 是否新建 | 说明 |
|------|---------|------|
| 主人说「启动卓越模式」「开始工作」 | ✅ 必须先查活跃 Thread | 先查再决定 |
| 主人说「帮我研究XX」「分析XX」 | ✅ 新建 Thread | 独立任务 |
| 主人说「部署XX系统」 | ✅ 新建 Thread | 独立任务 |
| 主人说「查一下XX」| ❌ 不需要 | 简单查询直接执行 |
| 主人说「发个文件」「重启服务」| ❌ 不需要 | 简单操作直接执行 |
| 主人说「给我看看XX状态」| ❌ 不需要 | 查询直接执行 |
| 主人说「启动XX模式」| ✅ 必须先查活跃 Thread | 可能已有相关任务 |

---

## 三、执行流程

### Step 1：收到任务

主人下达任何任务，立即执行：

```bash
# 查询当前活跃 Thread
curl -s "http://localhost:54321/threads?status=active" | python3 -c "
import sys,json
d=json.load(sys.stdin)
threads=d.get('threads',[])
if threads:
    print('当前活跃 Thread：')
    for t in threads:
        print(f'  {t[\"id\"][:8]} | {t[\"title\"]} | {t[\"status\"]}')
else:
    print('当前无活跃 Thread')
"
```

### Step 2：判断是否新建

- **已有相关 Thread** → 继续使用，追加记录
- **无相关 Thread** → 向主人确认：「是否新建 Thread？」
- **独立新任务** → 向主人确认：「是否新建 Thread？」

### Step 3：新建 Thread（如需授权）

```bash
curl -s -X POST "http://localhost:54321/threads" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "<任务名称>",
    "domain": ["<领域1>", "<领域2>"],
    "stage": "problem",
    "stage_problem": {
      "description": "<问题描述>",
      "discovered_by": "灵须子"
    }
  }'
```

### Step 4：执行任务

执行过程中记录关键节点到 Thread：

```bash
# 追加阶段记录
curl -s -X POST "http://localhost:54321/threads/<ID>/stages" \
  -H "Content-Type: application/json" \
  -d '{
    "stage": "analysis",
    "content": "<分析内容>"
  }'
```

### Step 5：完成时更新

```bash
# 更新状态为 completed
curl -s -X PATCH "http://localhost:54321/threads/<ID>/status" \
  -H "Content-Type: application/json" \
  -d '{"status":"completed"}'
```

---

## 四、API 端点速查

| 操作 | API | 示例 |
|------|-----|------|
| 查活跃 Thread | `GET /threads?status=active` | - |
| 查单个 Thread | `GET /threads/:id` | - |
| 新建 Thread | `POST /threads` | 见 Step 3 |
| 追加 Stage | `POST /threads/:id/stages` | 见 Step 4 |
| **更新状态** | `PATCH /threads/:id/status` | `{"status":"completed"}` |

---

## 五、状态值说明

| 状态 | 含义 |
|------|------|
| `new` | 新建，待开始 |
| `in_progress` | 执行中 |
| `blocked` | 被阻塞，等待外部条件 |
| `completed` | 已完成归档 |
| `cancelled` | 已取消 |

---

## 六、快速检查清单

每次收到主人新任务时：

- [ ] 1. 查活跃 Thread（`GET /threads?status=active`）
- [ ] 2. 判断是否需要新建（见"二、创建标准"）
- [ ] 3. 需要新建 → 确认授权 → 执行 POST
- [ ] 4. 任务执行 → 同步记录到 Thread
- [ ] 5. 任务完成 → PATCH status = completed
- [ ] 6. 同步更新 MEMORY.md 和相关文档

---

## 七、常见错误

| 错误 | 后果 | 避免方法 |
|------|------|---------|
| 先执行后补 Thread | 任务与 Thread 分离，追溯困难 | 严格遵守 Step 1-2 |
| 忘记更新 Thread 状态 | Thread 一直显示 in_progress | 完成时必做 Step 5 |
| Thread 标题模糊 | 无法通过标题判断任务 | 标题格式：`<系统/项目> <动作>` |
| 同一任务建多个 Thread | 信息分散 | 执行前必查活跃 Thread |
