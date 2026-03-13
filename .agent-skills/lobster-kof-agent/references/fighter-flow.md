# Fighter 脚本工作流程

## 概述

`src/fighter.ts` 是 agent LLM 和 KOF 服务器之间的管道。脚本本身不做任何战斗决策——它只负责：

1. 从服务器拿状态 → 格式化输出到 stdout
2. 从 stdin 读一行 → 提交到服务器

agent 的 LLM 读 stdout、写 stdin，完成决策闭环。

## 启动命令

```bash
# 先配置 .env（首次）
cp .env.example .env
# 编辑 .env，设置 KOF_SERVER=http://<服务器IP>:3000

# 参战
npm run fighter -- --name "你的名字"
```

也可以直接传 `--server` 参数：
```bash
npm run fighter -- --server http://<服务器IP>:3000 --name "你的名字"
```

参数说明：
- `--name`（必填）— 你的选手名字（同一比赛中不能重复）
- `--server`（可选）— 覆盖 `.env` 中的 `KOF_SERVER`

## 完整生命周期

```
启动
  ↓
POST /api/matches/join { name }  ← 自动配对
  ↓
┌─ 拿到 slot A？→ 轮询等对手（每 1.5 秒）
└─ 拿到 slot B？→ 比赛立刻开始
  ↓
战斗循环:
  打印状态 → 读 stdin → POST /action（阻塞到 tick 结算）→ 用响应作新状态
  ↓
比赛结束 → 打印结果 → 退出
```

### 阶段 1: 自动配对

脚本启动后调用 `POST /api/matches/join`：

```
[fighter] Server: http://<服务器IP>:3000
[fighter] Name:   Alpha

[fighter] Joining match (auto-pair)...
[fighter] Match:  a131e18f-28dd-4515-ad89-c67d8dbfc01f
[fighter] Slot:   A
[fighter] Watch:  http://localhost:3000/match/a131e18f-...
```

- 返回 slot `A` → 你是第一个，脚本自动轮询等对手
- 返回 slot `B` → 你加入了别人的房间，比赛立刻开始

### 阶段 2: 等待对手（仅 slot A）

```
[fighter] Waiting for opponent to join...
[fighter] Waiting for opponent to join...
[fighter] Match started!
```

每 1.5 秒检查一次状态，直到对手加入。

### 阶段 3: 战斗循环

每个 tick，脚本输出：

```
--- TICK 5 ---
Time: 5s / 90s

YOU (A - "Alpha"):
  HP: 88/100  Energy: 40/100  Position: 31
  Your last action: forward

OPPONENT (B - "Beta"):
  HP: 76/100  Energy: 55/100  Position: 69
  Last action: light_attack

Distance: 38

Recent:
  Tick 4: A=forward B=light_attack damage(A<=0, B<=0) distance=44
  Tick 3: A=forward B=forward damage(A<=0, B<=0) distance=50

Actions: idle | forward | backward | guard | light_attack | heavy_attack | dash_attack | counter | special
YOUR_ACTION>
```

然后等待 stdin 输入一行动作（10 秒超时，超时自动用 idle）。

POST /action 提交后阻塞到 tick 结算完成，响应就是新状态，直接用于下一轮。

一轮 = readline 等待 + 一次 HTTP POST。**没有 sleep，没有额外 GET**。

**输入规则**：
- 写一个合法动作名，如 `forward`、`light_attack`、`dash_attack`、`counter`、`special`
- 大小写不敏感
- 无效输入自动当作 `idle`
- stdin 关闭（EOF）→ 剩余所有 tick 用 `idle`

### 阶段 4: 比赛结束

```
=== MATCH RESULT ===
Status: finished
Winner: A
Summary: Alpha wins by knockout.
Total ticks: 42
Your HP: 34  Opponent HP: 0
====================
```

## 招式速查

| 招式 | 能量 | 射程 | 伤害 | 说明 |
|------|------|------|------|------|
| `idle` | 0 | - | 0 | 什么都不做 |
| `forward` | 0 | - | 0 | 向对手移动 6 格 |
| `backward` | 0 | - | 0 | 后退 6 格，边缘距离减伤 50% |
| `guard` | 8 | - | 0 | 伤害降至 35%，能量不足变 idle |
| `light_attack` | 18 | 18 | 10 | 远程快攻 |
| `heavy_attack` | 30 | 14 | 20 | 近距离重击 |
| `dash_attack` | 12 | 22 | 6 | 前进 10 格 + 攻击 |
| `counter` | 15 | - | 14反击 | 被攻击时减伤 40% + 反击 14 |
| `special` | 55 | 16 | 32 | 终结技 |

能量每 tick +7，初始 30，上限 100。

## 决策参考

| 情况 | 建议动作 |
|------|----------|
| 距离 > 22 | `forward` 或 `dash_attack`（攻击打不到，先接近） |
| 距离 <= 18，能量 >= 18 | `light_attack`（稳定输出） |
| 距离 <= 14，能量 >= 30 | `heavy_attack`（高伤害） |
| 距离 <= 16，能量 >= 55 | `special`（终结技 32 伤害） |
| 距离 > 16，能量 >= 12 | `dash_attack`（前进 10 格 + 6 伤害） |
| 对手在攻击，HP 低 | `guard`（8 能量）或 `counter`（15 能量，反击 14） |
| 能量 < 12 | `idle` 或 `forward`（等能量回复） |
| 对手 `backward` | `forward` 或 `dash_attack` 追击 |
| 对手 `guard` | 暂停攻击省能量，或继续施压 |
| 对手 `counter` | 不攻击让对方白费 15 能量 |

## 网络错误处理

- HTTP 请求自动重试（最多 3 次），4xx 错误不重试
- POST /action 出错时会 GET /state 重新同步状态
- 比赛已结束时的提交错误会正常退出
