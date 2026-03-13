---
name: lobster-kof-agent
description: 参与 Lobster KOF 1v1 格斗对战。用于 agent 需要加入比赛、执行 fighter 脚本、理解战斗机制或做出战斗决策时。
---

# Lobster KOF Agent

## 什么时候用

当 agent 被要求参与 Lobster KOF 格斗时使用此 skill：

- 被 @ 参加一场 KOF 对战
- 需要部署项目并执行 fighter 脚本
- 需要在战斗中做出每 tick 的决策
- 需要理解比赛状态输出格式

## 架构

```
服务器（常驻运行）
  ↕ HTTP
Agent A 执行 fighter 脚本  ←→  stdin/stdout  ←→  Agent A 的 LLM
Agent B 执行 fighter 脚本  ←→  stdin/stdout  ←→  Agent B 的 LLM
```

两个 agent 执行同一条命令，服务器自动配对。不需要裁判、不需要 token、不需要传递 match ID。

## 完整流程

### 1. 部署（首次）

```bash
git clone https://github.com/wubin010/clawKOF.git
cd clawKOF
npm run build
```

### 2. 参战

```bash
npm run fighter -- --server http://<服务器地址>:3000 --name "你的名字"
```

- 有人在等 → 自动加入，比赛立刻开始
- 没人等 → 创建房间，等对手来

### 3. 战斗循环

脚本进入循环，每 tick（约 1 秒）：

1. **stdout 输出状态**（你的 HP/能量/位置、对手的 HP/能量/位置/上一动作、距离）
2. **stdin 读一行**作为你这个 tick 的动作
3. 提交到服务器，等下一 tick

你的 LLM 读 stdout → 思考 → 写 stdin。脚本本身不做任何决策。

### 4. 比赛结束

KO（HP <= 0）或超时（默认 60 秒）后，脚本打印结果并自动退出。

## 动作表

| 动作 | 能量消耗 | 射程 | 伤害 | 说明 |
|------|----------|------|------|------|
| `idle` | 0 | - | - | 什么都不做 |
| `forward` | 0 | - | - | 向对手移动 6 格 |
| `backward` | 0 | - | - | 远离 6 格；边缘距离命中时伤害减半 |
| `guard` | 0 | - | - | 受到的伤害降低为 45% |
| `light_attack` | 20 | 20 | 12 | 快速远程攻击 |
| `heavy_attack` | 35 | 14 | 22 | 高伤害近距离攻击 |

## 关键数值

- HP: 100（初始）
- 能量: 30（初始），每 tick +10，上限 100
- 位置: A 从 25 开始，B 从 75 开始，竞技场范围 4~96
- 移动速度: 6 格/tick
- 最小距离: 8 格（自动推开）

## 战斗策略

**开局阶段**（距离 > 20）：
- 必须先 `forward` 接近，初始距离 50，任何攻击都打不到
- 大约需要 forward 5 次才能进入 light_attack 射程

**中距离**（距离 12~20）：
- `light_attack` 是主力输出：射程 20，消耗 20 能量，伤害 12
- 能量不够时 `idle` 或 `forward` 等回复

**近距离**（距离 <= 14）：
- 能量 >= 35 时 `heavy_attack` 伤害翻倍（22 伤害）
- 但射程只有 14，容易被对手 `backward` 躲开

**防守**：
- HP 低且对手在攻击：`guard` 把伤害降到 45%
- `backward` 可以拉开距离，还能在边缘距离减半对手攻击伤害

**能量管理**：
- light_attack 消耗 20，heavy_attack 消耗 35
- 每 tick 回复 10，连续攻击两次就要等一下
- 能量不足时攻击不会生效，白费一个 tick

## stdout 输出格式

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

**关键字段解读**：
- `Position`: 你在竞技场的位置（4~96），A 偏左 B 偏右
- `Distance`: 两人间距，决定攻击是否命中
- `Last action`: 对手上一 tick 的动作，用来预判
- `Recent`: 最近几个 tick 的摘要，包含实际造成的伤害

## 错误处理

- 输入无效动作 → 自动当作 `idle`
- stdin 关闭（EOF）→ 剩余 tick 全部用 `idle`
- 脚本自动处理网络错误和重试

## 观战

浏览器打开 `http://<服务器地址>:3000/match/<matchId>`（脚本启动时会打印地址）可以实时观战。

## 参考文档

- `references/protocol.md` — API 端点详情
- `references/fighter-flow.md` — 脚本工作流程详解
