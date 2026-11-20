# 网络协议（A-05 冻结）

> 唯一事实来源：`src/types/network.ts`。本文档解释设计意图，字段定义以代码为准；两者必须同步修改。

## 1. 权限模型：房间 + 中继 + 裁判

服务器**不做**物理模拟，也**不做**位置校验。它只做三件事：

| 职责 | 说明 |
| --- | --- |
| 房间 | 创建/加入/离开、容量控制、房主转移、状态机（大厅 → 倒计时 → 比赛中 → 结算） |
| 中继 | 把 `player_state` 广播给房间内其他玩家，20 Hz |
| 裁判 | 服务器单调时钟完成计时、校验 checkpoint 顺序递增、记录掉落次数 |

客户端位置数据以**客户端权威**上报。这是 V1.1 §12 明确接受的取舍：不做服务端复算，换取实现成本与服务器负载。因此**不做反作弊**，联机仅限熟人间使用。

## 2. 传输

| 阶段 | 传输 | 端点 |
| --- | --- | --- |
| 阶段 B（局域网 2–5 人） | 原始 WebSocket（`websockets` 库） | `ws://<host>:8000/ws` |
| 阶段 G（上线 2–8 人） | FastAPI 包一层反向代理 + 鉴权 | `wss://<domain>/ws` |

消息编码：JSON 对象，必须有 `type` 字段。字段名刻意压短（`p` / `r` / `s` / `a`）以在 20 Hz 下省带宽。

协议版本 `PROTOCOL_VERSION = 1`，客户端握手时校验，不匹配直接拒绝。

## 3. 客户端 → 服务器

| type | 载荷 | 频率 | 说明 |
| --- | --- | --- | --- |
| `create_room` | `nickname`, `color` | 一次 | 创建房间，创建者成为 host |
| `join_room` | `code`, `nickname`, `color` | 一次 | 加入已有房间 |
| `leave_room` | — | 按需 | 主动离开 |
| `start_game` | — | 一次 | 仅 host 有效，否则回 `NOT_HOST` |
| `player_state` | `payload: PlayerStatePayload` | 20 Hz | 位置/朝向/状态/动画相位 |
| `checkpoint` | `index`, `t` | 事件触发 | 顺序必须递增，跳号被拒 |
| `finish` | `t` | 一次 | 到达终点 |
| `ping` | `t` | 2 Hz | 用于估算 RTT |

`PlayerStatePayload`：

```ts
{ t: number;              // 客户端时间戳 ms
  p: [x, y, z];           // 位置
  r: number;              // yaw 弧度
  s: 'idle'|'run'|'jump'|'fall'|'knock'|'respawn'|'finish';
  a: number }             // 动画相位 0–1
```

## 4. 服务器 → 客户端

| type | 载荷 | 说明 |
| --- | --- | --- |
| `room_state` | `code`, `hostId`, `capacity`, `players[]` | 全量快照，进房/有人变动时下发 |
| `player_joined` | `player` | 增量 |
| `player_left` | `playerId` | 增量 |
| `countdown` | `startsAt`, `seconds` | 开局倒计时（服务器时钟） |
| `game_started` | `startsAt` | 正式开跑 |
| `player_state` | `playerId`, `payload` | 其他玩家状态，20 Hz 中继，不回发给发送者 |
| `checkpoint_updated` | `playerId`, `index` | 裁判确认后的进度 |
| `player_finished` | `playerId`, `timeMs` | 服务器计算完成时间 |
| `leaderboard` | `rows[]` | 结算榜 |
| `error` | `code`, `message` | 见下表 |

## 5. 错误码

| code | 场景 |
| --- | --- |
| `ROOM_NOT_FOUND` | 房间码不存在 |
| `ROOM_FULL` | 已达 `capacity` |
| `GAME_IN_PROGRESS` | 比赛中禁止加入 |
| `NOT_HOST` | 非房主发 `start_game` |
| `BAD_MESSAGE` | 字段缺失/类型错误/未知 type |

## 6. 时间与时钟

- **所有比赛计时使用服务器单调时钟**（`time.monotonic()`），不使用系统墙钟，避免调时。
- 客户端只上报相对时间戳，服务器不采信客户端时刻。
- 倒计时以 `startsAt` 下发绝对服务器时刻，客户端自行换算成本地偏移，不信任本地时钟。

## 7. 容量与阶段

| 阶段 | 容量 | 状态机 |
| --- | --- | --- |
| B 局域网 | `ROOM_CAPACITY = 5` | 大厅 → 倒计时 3 s → 比赛 → 结算 |
| G 上线 | 8（改常量并升 `PROTOCOL_VERSION`） | 同上，另加鉴权与限流 |

## 8. 断线与重连

阶段 B 不做重连：连接断开即 `player_left`，其余玩家继续。阶段 G 再评估是否引入 session 恢复（需升协议版本）。
