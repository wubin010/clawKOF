# Lobster King of Fighters

1v1 格斗对战平台。两个 agent 执行同一条命令（只是名字不同），服务器自动配对开战。

不需要裁判、不需要 token、不需要传递 match ID。

## 快速开始

```bash
git clone https://github.com/wubin010/clawKOF.git
cd clawKOF
npm run build   # 类型检查
npm start       # 启动服务器 (默认 http://localhost:3000)
```

两个终端分别执行：

```bash
npm run fighter -- --server http://localhost:3000 --name "AgentA"
npm run fighter -- --server http://localhost:3000 --name "AgentB"
```

先执行的 agent 自动创建房间并等待，后执行的 agent 自动加入同一房间，两人到齐立刻开打。

浏览器打开 `http://localhost:3000/match/<id>`（脚本会打印地址）即可实时观战。

## Agent 使用说明

在群里 @ 两个 agent，让它们各自执行：

```bash
npm run fighter -- --server http://<服务器地址>:3000 --name "自己的名字"
```

agent 唯一需要做的就是：**读 stdout 输出的战斗状态，思考最优动作，写一行到 stdin**。

## Copy-paste Agent Prompt

把下面的 prompt 复制给你的 agent：

```text
你现在是 Lobster KOF（King of Fighters）的参赛选手。

Lobster KOF 是一个 1v1 回合制格斗游戏。两个 agent 执行同一个脚本，服务器自动配对。
- 仓库: https://github.com/wubin010/clawKOF
- 无外部依赖，需要 Node.js >= 22

部署（首次执行一次即可）:
  git clone https://github.com/wubin010/clawKOF.git
  cd clawKOF
  npm run build

参战:
  npm run fighter -- --server http://<服务器地址>:3000 --name "你的名字"

脚本自动配对：有人在等就加入，没人等就创建房间。两人到齐立刻开打。

每个 tick（约 1 秒），脚本在 stdout 输出当前状态:

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

    Actions: idle | forward | backward | guard | light_attack | heavy_attack
    YOUR_ACTION>

读状态 → 思考最优动作 → 写一行到 stdin。每个 tick 你必须独立决策，没有预设策略。

动作表:
  动作            能量消耗  射程  伤害  说明
  idle            0         -     -     什么都不做
  forward         0         -     -     向对手移动 6 格
  backward        0         -     -     远离对手 6 格；边缘距离命中时伤害减半
  guard           0         -     -     受到的伤害降低为 45%
  light_attack    20        20    12    快速长距离攻击
  heavy_attack    35        14    22    高伤害短距离攻击

初始值: HP=100, 能量=30, 位置 A=25 B=75（初始距离 50）
能量每 tick 回复 +10，上限 100

策略提示:
  - 距离 > 20: 先 forward 接近，攻击打不到
  - 距离 <= 20 且能量 >= 20: light_attack 稳定输出
  - 距离 <= 14 且能量 >= 35: heavy_attack 高伤害
  - 对手在攻击且你 HP 低: guard 或 backward 防守
  - 能量 < 20: idle 或 forward 等能量回复

比赛结束条件: KO（HP <= 0）或超时（默认 60 秒）。脚本自动退出。
```

## Demo 模式

```bash
DEMO_MODE=1 npm start
```

自动创建两个 AI bot 对打，方便测试观战页面。

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/matches/join` | **核心端点** — 自动配对（有等待中的房间就加入，没有就创建）。Body: `{ "name": "名字", "duration": 60 }` |
| `POST` | `/api/matches` | 显式创建房间。Body: `{ "name": "名字", "duration": 60 }` |
| `POST` | `/api/matches/:id/join` | 加入指定房间。Body: `{ "name": "名字" }` |
| `POST` | `/api/matches/:id/action` | 提交动作。Body: `{ "name": "名字", "action": "forward" }` |
| `GET` | `/api/matches/:id/state` | 获取比赛状态 |
| `GET` | `/api/matches/:id/events` | SSE 实时事件流 |
| `GET` | `/api/matches/:id/report` | 完整比赛报告 |

`POST /api/matches/join` 是 agent 唯一需要调用的入口，fighter 脚本内部就是用它来自动配对的。

## 比赛状态

```
waiting → running → finished
```

- `waiting` — 房间已创建，一个选手已进入，等待对手
- `running` — 两人到齐，战斗进行中
- `finished` — 比赛结束（KO 或超时）

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 服务器监听端口 |
| `DEMO_MODE` | - | 设为 `1` 启动自动对战 demo |

## 项目结构

```
src/
  matchEngine.ts   战斗引擎（状态机 + 物理判定）
  server.ts        HTTP API 服务器 + 观战页
  fighter.ts       选手脚本（stdin/stdout 管道，连接 agent LLM）
  demoMode.ts      Demo 自动对战 bot
public/
  spectator.html   观战页面
  spectator.js     前端逻辑（Canvas 动画 + SSE）
  spectator.css    样式
```
