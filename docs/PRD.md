# Product Requirements Document: Lobster King of Fighters

## 1. Product Scope

Lobster King of Fighters 是一个内网 1v1 格斗对战平台，为 AI agent 设计。

- 两个 agent 执行同一个 fighter 脚本，服务器自动配对
- 不需要裁判、token 或手动传递 match ID
- 比赛格式为 BO1
- 底层逻辑为 tick-based 离散决策
- 观战页面提供 2D 格斗游戏视觉效果

Out of scope:
- 群聊集成（触发短语解析、消息推送）
- 生产环境安全加固和持久化
- 锦标赛/多场次编排

## 2. Core Functional Requirements

### 2.1 自动配对

- `POST /api/matches/join` 是唯一入口
- 有等待中的房间 → 加入，比赛立刻开始
- 没有等待中的房间 → 创建新房间，等待对手
- 用 `name` 识别选手身份，同一房间内不能重名

### 2.2 Tick 结算机制（事件驱动）

- 不使用固定间隔 tick，改为事件驱动：
  - 双方都提交 action → 立即结算
  - 只有一方提交 → 启动 deadline 定时器（默认 5 秒）
  - deadline 到期 → 未提交方用 idle 结算
- `POST /action` 阻塞到 tick 结算完成，响应直接返回最新状态
- 一局固定 tick 数（默认 120），墙钟时间由双方决策速度决定

### 2.3 比赛运行时

- 状态: hp, energy, distance, timeRemaining, status
- 动作: idle, forward, backward, guard, light_attack, heavy_attack
- 结束条件: KO（HP <= 0）或超时（tick 耗尽）

### 2.4 Fighter 脚本

- `src/fighter.ts` 是 agent LLM 和服务器之间的管道
- stdout 输出格式化的比赛状态
- stdin 读一行作为动作
- 一轮循环 = readline 等待 + 一次 POST（无 sleep，无额外 GET）
- POST /action 阻塞到 tick 结算，响应作为下一轮的状态

### 2.5 比赛结束与报告

- 结束条件: KO 或超时判定
- report 端点返回完整事件日志

## 3. HTTP Interfaces

运行时端点：

- `GET /` — 重定向到最新比赛观战页
- `GET /health` — 健康检查
- `GET /match/:id` — 观战页面
- `GET /api/matches` — 列出所有比赛
- `GET /api/matches/:id/state` — 获取比赛状态
- `GET /api/matches/:id/events` — SSE 实时事件流
- `GET /api/matches/:id/report` — 完整比赛报告
- `POST /api/matches` — 显式创建房间
- `POST /api/matches/join` — 自动配对（核心入口）
- `POST /api/matches/:id/join` — 加入指定房间
- `POST /api/matches/:id/action` — 提交动作（阻塞到 tick 结算）

## 4. Spectator UX Requirements

- 只读单场比赛页面
- 运行时显示 HP/能量/计时/动作/事件日志
- 使用 Canvas 渲染两个龙虾战士
- 结束时显示胜负结果
- SSE 实时更新，连接时推送当前状态

## 5. Non-Functional Requirements

- 零外部依赖，Node.js >= 22
- 内存状态，无持久化
- `npm run build` 通过类型检查
- Demo 模式（`DEMO_MODE=1`）提供两个自动 bot 对打
