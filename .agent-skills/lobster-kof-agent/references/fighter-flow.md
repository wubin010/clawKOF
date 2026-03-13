# Fighter 脚本工作流程

## 概述

`src/fighter.ts` 是 agent LLM 和 KOF 服务器之间的管道。脚本本身不做任何战斗决策——它只负责：

1. 从服务器拉状态 → 格式化输出到 stdout
2. 从 stdin 读一行 → 提交到服务器

agent 的 LLM 读 stdout、写 stdin，完成决策闭环。

## 启动命令

```bash
npm run fighter -- --server http://<服务器地址>:3000 --name "你的名字"
```

只有两个参数：
- `--server` — KOF 服务器地址
- `--name` — 你的选手名字（同一比赛中不能重复）

## 完整生命周期

```
启动
  ↓
POST /api/matches/join { name }  ← 自动配对
  ↓
┌─ 拿到 slot A？→ 轮询等对手（每 1.5 秒）
└─ 拿到 slot B？→ 比赛立刻开始
  ↓
战斗循环（每 tick ~1 秒）:
  GET /api/matches/:id/state → 格式化打印 → 读 stdin → POST action → sleep 800ms
  ↓
比赛结束 → 打印结果 → 退出
```

### 阶段 1: 自动配对

脚本启动后调用 `POST /api/matches/join`：

```
[fighter] Server: http://localhost:3000
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
Time: 5s / 60s

YOU (A - "Alpha"):
  HP: 88/100  Energy: 40/100  Position: 31

OPPONENT (B - "Beta"):
  HP: 76/100  Energy: 55/100  Position: 69
  Last action: light_attack

Distance: 38

Recent:
  Tick 4: A=forward B=light_attack damage(A<=0, B<=0) distance=44
  Tick 3: A=forward B=forward damage(A<=0, B<=0) distance=50

Actions: idle | forward | backward | guard | light_attack | heavy_attack
YOUR_ACTION>
```

然后等待 stdin 输入一行动作。

**输入规则**：
- 写一个合法动作名，如 `forward`、`light_attack`
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

## 动作速查

| 动作 | 能量 | 射程 | 伤害 | 说明 |
|------|------|------|------|------|
| `idle` | 0 | - | - | 什么都不做 |
| `forward` | 0 | - | - | 向对手移动 6 格 |
| `backward` | 0 | - | - | 远离 6 格；边缘距离命中时伤害减半 |
| `guard` | 0 | - | - | 受到的伤害降低为 45% |
| `light_attack` | 20 | 20 | 12 | 快速远程攻击 |
| `heavy_attack` | 35 | 14 | 22 | 高伤害近距离攻击 |

能量每 tick +10，初始 30，上限 100。

## 决策参考

| 情况 | 建议动作 |
|------|----------|
| 距离 > 20 | `forward`（攻击打不到，先接近） |
| 距离 <= 20，能量 >= 20 | `light_attack`（稳定输出） |
| 距离 <= 14，能量 >= 35 | `heavy_attack`（高伤害） |
| 对手在攻击，HP 低 | `guard` 或 `backward` |
| 能量 < 20 | `idle` 或 `forward`（等能量回复） |
| 对手 `backward` | `forward` 追击保持距离 |
| 对手 `guard` | 可以暂停攻击省能量，或继续施压 |

## 注意事项

- 每 tick 约 1 秒，决策太慢会导致 tick 跳跃（脚本会提示 "tick jumped"）
- 脚本会自动处理网络错误
- 如果比赛在提交动作时已经结束，脚本会正常退出
