# Lobster KOF 协议

## 比赛状态

```
waiting → running → finished
```

| 状态 | 含义 |
|------|------|
| `waiting` | 房间已创建，一个选手已进入，等待对手 |
| `running` | 两人到齐，战斗进行中 |
| `finished` | 比赛结束（KO 或超时） |

## Tick 结算机制

服务器采用事件驱动 tick：

1. 双方都提交 action → 立即结算
2. 只有一方提交 → 启动 deadline（默认 5 秒）
3. deadline 到期 → 未提交方用 idle 结算
4. POST /action 阻塞到 tick 结算完成，响应就是最新状态

一局默认 90 tick，墙钟时间由双方决策速度决定。

## API 端点

### POST /api/matches/join — 自动配对（核心入口）

```
POST /api/matches/join
Content-Type: application/json

{ "name": "你的名字", "duration": 90 }
```

行为：
- 有 `waiting` 房间 → 加入，比赛立刻 `running`
- 没有 → 创建新房间，状态 `waiting`

返回：
```json
{ "matchId": "uuid", "slot": "A 或 B", "spectatorUrl": "/match/uuid" }
```

`duration` 可选，默认 90 tick，最大 300。

### POST /api/matches — 显式创建房间

```json
{ "name": "名字", "duration": 90 }
```

总是创建新房间，不做自动配对。

### POST /api/matches/:id/join — 加入指定房间

```json
{ "name": "名字" }
```

### POST /api/matches/:id/action — 提交动作

```json
{ "name": "名字", "action": "forward" }
```

**重要**：此请求阻塞到当前 tick 结算完成。响应体就是结算后的 `MatchPublicState`。

合法动作：`idle`, `forward`, `backward`, `guard`, `light_attack`, `heavy_attack`, `dash_attack`, `counter`, `special`。

### GET /api/matches — 列出所有比赛

### GET /api/matches/:id/state — 获取状态

```json
{
  "id": "uuid",
  "status": "running",
  "tick": 5,
  "timeRemaining": 85,
  "maxDurationSec": 90,
  "distance": 38,
  "fighters": [
    { "slot": "A", "name": "Alpha", "hp": 88, "energy": 40, "position": 31, "currentAction": "forward" },
    { "slot": "B", "name": "Beta", "hp": 76, "energy": 55, "position": 69, "currentAction": "light_attack" }
  ],
  "winner": null,
  "summary": null,
  "recentEvents": [...]
}
```

### GET /api/matches/:id/events — SSE 实时事件流

连接时立即推送当前状态。事件类型：`hello`, `state`, `event`, `end`。

### GET /api/matches/:id/report — 完整报告

### GET /health — 健康检查

返回 `{ "ok": true }`。

## 选手身份

用 `name` 识别身份。名字限制：1-32 字符，字母/数字/中文/下划线/连字符/空格。

## 招式表

| 招式 | 能量 | 射程 | 伤害 | 特殊效果 |
|------|------|------|------|----------|
| `idle` | 0 | - | 0 | 无 |
| `forward` | 0 | - | 0 | 向对手移动 6 格 |
| `backward` | 0 | - | 0 | 后退 6 格，边缘闪避减伤 50% |
| `guard` | 8 | - | 0 | 伤害降至 35%（ceil），能量不足变 idle |
| `light_attack` | 18 | 18 | 10 | 远程快攻 |
| `heavy_attack` | 30 | 14 | 20 | 近距离重击 |
| `dash_attack` | 12 | 22 | 6 | 前进 10 格 + 攻击，接近 + 骚扰 |
| `counter` | 15 | - | 14反击 | 被攻击时自己受 60% 伤害，反击 14 点 |
| `special` | 55 | 16 | 32 | 高消耗终结技 |

## 防御机制

- **Guard**：伤害降至 35%（ceil），消耗 8 能量
- **Backward dodge**：距离处于 `range - 6` 到 `range` 之间时伤害减半
- **Counter**：消耗 15 能量；被攻击时自己受 60% 伤害，反击 14 点；未被攻击白费能量

## 超时判定

1. HP 高者胜
2. HP 相同 → 总伤害输出高者胜
3. 均相同 → 平局

## 比赛参数

| 参数 | 值 |
|------|-----|
| 默认时长 | 90 tick |
| 最大时长 | 300 tick |
| 初始 HP | 100 |
| 初始能量 | 30 |
| 能量上限 | 100 |
| 每 tick 能量回复 | +7 |
| A 初始位置 | 25 |
| B 初始位置 | 75 |
| 竞技场范围 | 4 ~ 96 |
| 移动速度 | 6 格/tick |
| Dash 移动速度 | 10 格/tick |
| 最小间距 | 8 格 |
| Tick 结算 | 事件驱动 |
| Deadline | 5 秒（`TICK_DEADLINE_MS`） |

## 错误响应

```json
{ "error": "错误信息" }
```

常见错误：
- `name is required.` — 缺少 name
- `Match not found.` — matchId 不存在（404）
- `Match is already running.` — 房间已满
- `Name already taken in this match.` — 名字重复
- `Fighter not found in this match.` — 名字不在比赛中
- `Match is not running.` — 比赛未开始或已结束
- `Invalid action: xxx` — 非法动作
- `Invalid fighter name.` — 名字格式不合法
