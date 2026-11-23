# 网络协议（阶段 B：局域网联机）

> 唯一事实来源：`src/types/network.ts`。本文档解释设计意图，字段定义以代码为准；两者必须同步修改。
> 服务端实现：`server/index.mjs`（Node 22 + `ws`，零业务框架）。

## 1. 权限模型：房间 + 中继 + 裁判

服务器**不做**物理模拟，也**不做**位置校验。它只做三件事：

| 职责 | 说明 |
| --- | --- |
| 房间 | 创建/加入/离开、容量 2–8、房主转移、状态机（大厅 → 倒数 → 比赛中 → 结算 → 大厅）、`GET /rooms` 公开房间列表 |
| 中继 | 把 `player_state` 转发给房间内其他玩家，20 Hz；转发 `attack` / `attack_hit` / `take_hit` |
| 裁判 | 服务器单调时钟算完赛时间、校验 checkpoint 顺序递增、统计掉落次数、出榜单、第一个冲线即宣布全场结算、统计"再来一局"投票 |

客户端位置数据以**客户端权威**上报，命中判定也在攻击者本地算（够近 + 面朝对方 + 落差不大），服务器只把 `attack_hit` 转发给被打的人。这是 V1.1 §12 明确接受的取舍：不做服务端复算，换取实现成本与服务器负载。因此**不做反作弊**，联机仅限熟人间使用。

## 2. 传输

| 阶段 | 传输 | 端点 |
| --- | --- | --- |
| B（局域网 2–8 人） | 原始 WebSocket（Node `ws`） | `ws://<host>:8000/ws` |
| C（上线） | 反向代理 + 鉴权 | `wss://<domain>/ws` |

消息编码：JSON，必须有 `type`。位置包字段刻意压短（`p` / `r` / `s` / `a`）以在 20 Hz 下省带宽。

协议版本 `PROTOCOL_VERSION = 6`（v1 只有单机骨架；v2 加了 `hello`、攻击同步与 `back_to_lobby`；v3 加了血量/死亡广播与击杀计数；v4 在 `PlayerStatePayload` 里补了 `h`（血量）；v5 加房间阶段 `state`、中途加入的 `game_state`、全场结算 `race_over`、再来一局投票 `rematch`/`rematch_status` 与 `GET /rooms`；v6 把 `back_to_lobby` 从"整房回大厅"改成"只把自己送回大厅"并给 `PlayerBrief` 补 `inLobby`）。握手时服务器下发 `hello`，版本不匹配由客户端拒绝进入游戏。

### 2.1 房间状态机

```
lobby ──start_game(≥2 人)──▶ countdown ──3 s──▶ racing ──第一个 finish──▶ results
  ▲                                                                        │
  └────── 全员都 inLobby（各自点"返回房间"，累加）→ room.state 落回 lobby ──┘
  ▲                                                                        │
  └────────── 未回大厅的人全票 rematch → 直接重开 countdown ─────────────────┘
```

- **`leave_room` 不改变阶段**：谁走都只是从 `members` 里移除，比赛照跑；人走光了才解散房间。
- **`join_room` 在 `countdown` / `racing` 也放行**（中途加入），只有 `members.length >= 8` 才回 `ROOM_FULL`；`results` 阶段进房的人 `inLobby = true`，先待在大厅。
- **`finish` 只在第一个冲线时把阶段推到 `results` 并广播 `race_over`**；之后其他人的 `finish` 只更新成绩，不再改阶段。
- **"返回房间"是个人动作**：只有 `results` 阶段允许（`countdown` / `racing` 回 `BAD_MESSAGE`）。它把**自己**标记成 `inLobby = true`、清掉自己的 `rematch`，服务器**只给本人**发 `back_to_lobby`，同时广播 `room_state`（带 `inLobby`）与 `rematch_status`（分母已剔除回大厅的人）。只有**所有人都 `inLobby`** 时才把 `room.state` 落回 `lobby` 并清掉全房成绩。

## 3. 客户端 → 服务器

| type | 载荷 | 频率 | 说明 |
| --- | --- | --- | --- |
| `create_room` | `nickname`, `color` | 一次 | 创建房间，创建者成为 host，房间号由服务器分配 |
| `join_room` | `code`, `nickname`, `color` | 一次 | 加入已有房间；**比赛中也允许**（中途加入），满 8 人才拒 |
| `leave_room` | — | 按需 | 主动离开；不改变房间阶段，房主离开自动转移 |
| `start_game` | — | 一次 | 仅 host 有效且人数 ≥ 2，否则回 `NOT_HOST` / `NOT_ENOUGH_PLAYERS` |
| `back_to_lobby` | — | 按需 | 结算后只把自己送回大厅（服务器只回本人，不动别人） |
| `rematch` | — | 按需 | 结算面板点"再来一局"；未回大厅的人全票通过则服务器自动开下一局 |
| `player_state` | `payload: PlayerStatePayload` | 20 Hz | 位置/朝向/状态/速度归一化 |
| `attack` | `kind: 'light'\|'heavy'`, `side` | 事件触发 | 出招动画广播，别人照着播 |
| `attack_hit` | `targetId`, `kind`, `side`, `x`, `z` | 事件触发 | 攻击者本地判定打到了谁 |
| `died` | `killerId: string \| null` | 事件触发 | 自己血量归零；`killerId` 为最后一击来源，障碍/自杀为 `null` |
| `checkpoint` | `index`, `t` | 事件触发 | 顺序必须递增，跳号被拒 |
| `finish` | `t` | 一次 | 到达终点；官方时间由服务器算 |
| `ping` | `t` | 2 Hz | 估算 RTT |

`PlayerStatePayload`：

```ts
{ t: number;              // 客户端时间戳 ms（只用于调试，服务器不采信）
  p: [x, y, z];           // 位置
  r: number;              // yaw 弧度（角色朝向，跟着移动方向走）
  s: 'idle'|'run'|'jump'|'fall'|'knock'|'respawn'|'finish';
  a: number;              // 速度归一化 0–1，远端据此算跑步动画幅度
  h?: number }            // 血量 0–100（v4 新增，缺省时远端按满血处理）
```

## 4. 服务器 → 客户端

| type | 载荷 | 说明 |
| --- | --- | --- |
| `hello` | `id`, `protocol` | 连上即下发，客户端拿 `id` 认自己 |
| `room_state` | `code`, `hostId`, `capacity`, `state`, `players[]` | 全量快照，进房/有人变动/阶段变化时下发（站位号在此重排）。`state` 为 `lobby / countdown / racing / results` |
| `player_joined` | `player` | 有人进房（含中途加入）：客户端据此新增一个远端果冻人 |
| `player_left` | `playerId` | 某人断开；**比赛继续**，只移除这个人 |
| `countdown` | `seconds`, `startsInMs` | 开跑倒计时（首次开跑与"再来一局"共用），**相对时长**下发（见 §6） |
| `game_started` | — | 倒计时结束，全场同一时刻起跑 |
| `game_state` | `state`, `elapsedMs` | **只发给中途加入的人**：这局已经跑了多久，客户端据此直接进比赛 |
| `player_state` | `playerId`, `payload` | 其他人的状态，20 Hz 中继，不回发给发送者 |
| `attack_played` | `playerId`, `kind`, `side` | 别人出招，播动画 |
| `take_hit` | `fromId`, `kind`, `x`, `z` | **你被打中了**：本地扣血（轻击 −34 / 重击 −70）、击退与答题中断 |
| `player_died` | `playerId`, `killerId` | 有人死了：受害者回起点满血；`killerId === 自己` 时击杀 +1 并播 `1杀.mp3` |
| `checkpoint_updated` | `playerId`, `index` | 裁判确认后的进度 |
| `player_finished` | `playerId`, `timeMs` | 服务器计算的完成时间 |
| `leaderboard` | `rows[]` | 名次（未完赛 `timeMs = null`，排最后）；每行带 `kills` |
| `race_over` | `rows[]`, `byPlayerId` | **第一个冲线**：全场一起进结算页（还在跑的人也弹结算） |
| `rematch_status` | `votes`, `total`, `voterIds[]` | 再来一局投票进度（`total` 不含`inLobby`的人），结算面板显示"已同意 2/3" |
| `back_to_lobby` | — | 你自己回到大厅（只发给你自己，别人收不到） |
| `error` | `code`, `message` | 见下表 |

`PlayerBrief`：`id / nickname / color('#rrggbb') / host / finished / slot(0..7) / lateJoin? / rematch? / inLobby`。`slot` 决定起跑线站位，客户端按 `(slot - (n-1)/2) * 2.4 m` 落位；`lateJoin` 标记"进来时这局已经在跑"；`inLobby` 标记"结算期已经点过返回房间、人不在结算页上"。

> `color` 口径（B2.0）：`create_room` / `join_room` 里的 `color` 由客户端**先规范成小写 `#rrggbb`**再发；服务端 `cleanColor` 只接受这 8 个色板值（`CROWD_HEX`，与前端 `CROWD_COLORS` 前 8 个一致），**收到非法值或缺失就从前 8 色里随机一个**并写进成员数据。这样"懒得选配色"的人也有确定颜色，且本人（`getOwnColor()`）与别人（`player_joined` / `room_state` 里读到的 `color`）拿到的是**同一个值**——不会出现"自己看青色、别人看你粉色"。

### 4.1 `GET /rooms`（HTTP，同一端口）

多人页下方的"已有房间"列表靠它，返回：

```json
{ "rooms": [ { "code": "9476", "players": 3, "capacity": 8, "phase": "racing", "host": "房主甲" } ] }
```

`cache-control: no-store` + `access-control-allow-origin: *`，页面每 3 s 轮询一次；点卡片等同发 `join_room`。

## 5. 错误码

| code | 场景 |
| --- | --- |
| `ROOM_NOT_FOUND` | 房间码不存在 |
| `ROOM_FULL` | 已达 8 人（中途加入时同样判这个码） |
| `GAME_IN_PROGRESS` | 旧版拒绝加入比赛中；**B1.8 起不再使用**（比赛中允许中途加入） |
| `NOT_HOST` | 非房主发 `start_game` |
| `NOT_ENOUGH_PLAYERS` | 人数 < 2 时开跑 |
| `BAD_MESSAGE` | 字段缺失/类型错误/未知 type |
| `BAD_PROTOCOL` | 协议版本不匹配 |

## 6. 时间与时钟

- **比赛计时用服务器单调时钟**（`performance.now()`），不用墙钟，避免调时。
- 倒计时不下发绝对时刻，而是下发 `startsInMs`（还剩多少毫秒）+ `seconds`。两台机器的墙钟本来就不同，相对时长让客户端各自倒计时即可，开跑的真正对齐靠服务器在 3 s 后广播 `game_started`。
- 客户端收到 `player_state` 时用**本地到达时刻**打戳，渲染时按 100 ms 延迟插值（`RemotePlayer`），因此不依赖两台机器的时钟同步。

## 7. 战斗同步（B1 + 血量）

- 出招：本地 `AttackSystem` 决定命中帧（轻击 0.16 s / 重击 1.0 s），到达命中帧时本地先算候选目标（`COMBAT_RULES.lightReach 2.1` / `heavyReach 2.9` / 半角 65° / 落差 2.2 m），命中则发 `attack_hit`。
- 服务器只校验 `targetId` 在房间内且房间处于比赛中，然后把 `take_hit` 发给被打的人 —— **扣血与结算都在被打端**：轻击 −34、重击 −70，同时保留旧规则（轻击累计 3 次 / 重击 1 次 → 倒地眩晕 1 s，答题中断）。满血 100 时"轻击 3 下"恰好把血打空，两条规则自然收敛。
- 轻击只推一小步（`applyFlinch`，1.6 m/s，不进硬直），重击是大击退（8 m/s + 0.9 s 硬直，倒地再叠到 1 s），所以连续轻击不会把人推出命中范围。
- 倒地状态通过 `player_state.s = 'knock'` 传出去，远端照样播"四脚朝天"的失控姿态。
- **死亡**：挨打端血量归零 → 本地回起点满血复活，并向服务器发 `died`（带 `killerId`）。服务器只做一件事：给击杀者 `kills += 1`，然后广播 `player_died` + 刷新 `leaderboard`。受害者的下一次 `player_state` 会直接把位置带到起点，远端 `RemotePlayer` 收到 `player_died` 后清空插值缓冲（`snapToSpawn`），不会出现 300 m 的滑行。
- 击杀者本地也维护一份 `kills`，收到 `player_died` 且 `killerId === selfId` 时 +1 并播 `public/audio/kill.mp3`；服务器榜单是权威口径，结算面板用它。
- **掉进虚空**（踩塌的方格 / 缺口漏下去）和被人打死走同一条链路：本地结算（`deaths+1`、满血、回起点）+ 发 `died { killerId: null }`；服务器只做击杀归属，不区分死因。

### 7.1 头顶血量条

- 自机的血条由 `Game.applyDamage / onDeath / onVoidFall` 直接刷（`NameTag.setHealth`）。
- 别人的血条读 `player_state.payload.h`：`RemotePlayer.push()` 见到 `typeof h === 'number'` 就更新，收到 `player_died` 时把对方血条重置回满血（他确实回起点满血复活了）。
- 渲染成本：只是同一张 Canvas 多画一行（血条 + 数字），没有新增 Sprite / draw call。

### 7.3 中途加入与"有人退出"

- 新人进来时若 `state` 是 `countdown / racing`：服务器给他的 `room_state.state` 就是当前阶段，再补一条 `game_state {state, elapsedMs}`；客户端把 `status` 设成 `playing` 直接进游戏界面，`Game` 用 `lateJoin` 从起点起跑（不给"补时"，也不计算他的前半程）。
- 老玩家收到 `player_joined` 后调 `Game.addPeer()` 补一个远端果冻人；收到 `player_left` 调 `removeRemote()`。
- **`leave_room` 只删人**：不广播 `back_to_lobby`、不改阶段、不清榜单；只剩 0 人才解散。倒数阶段有人走，剩下 ≥ 2 人照常开跑。

### 7.4 全场结算与"再来一局"

- 第一个 `finish` → 服务器把阶段设成 `results`、清空全员 `rematch` 标记，广播 `race_over { rows, byPlayerId }` + `room_state`。
- 客户端收到 `race_over` 调 `Game.endMatch()`：**不管本机在跑、在答题还是早已完赛**，统一 `race.force('Result')` 进结算页（用 `force` 而不是 `set`，因为这是服务器裁判做出的跳转）；没跑到终点的人显示"未完成"。
- `rematch`：只记 `member.rematch = true` 并广播 `rematch_status {votes,total,voterIds}`；`total` 只数**没回大厅（`!inLobby`）**的人，`everyoneWantsRematch` 为真时 `startGame()` —— `lobby` 与 `results` 都能开，开局前服务器把所有人 `inLobby = false`（回大厅的人也被一起带回赛道）。客户端收到 `countdown` 调 `Game.resetRound()` 复位并进倒数。
- `back_to_lobby`：**只影响自己**。服务器把该成员标 `inLobby = true`、清掉自己的 `rematch`，然后：①`back_to_lobby` 只发给本人（别人不回大厅、结算页不动）；②给全场广播 `room_state`（`PlayerBrief` 带 `inLobby`，大厅里会显示"结算中"标签）与新的 `rematch_status`。只有**所有人都 `inLobby`** 时才把 `room.state` 落回 `lobby` 并 `resetMemberStats`。`countdown` / `racing` 阶段发这个包会回 `BAD_MESSAGE`。
- 客户端判断"要不要待在首页大厅"看两个信号：自己的 `inLobby` 或 `room.state === 'lobby'`；所以结算页上别人点返回房间不会把自己踢回首页。

### 7.5 巨型拳套（本地障碍，不走网络）

拳套的滑动相位、出拳相位都是**各客户端本地按同一个常量表**（`GLOVES` 的 `zCenter / zRange / slideSpeed / slidePhase / punchPhase`）算的，协议不传；4 只的位置分别落在 `-11 / -139.9 / -183.5 / -243.6`（右→左→右→左），探拳最远 6.5 m，中线始终留 ≥0.5 m 逃生缝。被拳套打飞是本地判定：命中时先 `health.damage(100)` **把血扣光**（血条立刻归零、死亡数 +1，写入 `damageLog`），再播 1 s 飞行，落地后 `health.reset()` 回起点满血；同时发 `died { killerId: null }`，服务器只记一次掉落，不算任何人的击杀。

### 7.6 赛道方格是"本地随机"

- 整条赛道 684 块方格（`TILE_GRID` 6×114）的"消失 / 回弹 / 实心"身份是**各客户端本地 `Math.random()` 抽的**（开局 `TileField.reset()` 逐格抽签，消失 4% / 回弹 2.5%），协议不下发种子也不下发塌陷事件：两台机器上同一格的身份可能不同。
- 这样做的好处是零带宽、掉线也不影响；代价是联机时不能靠"看到对手踩塌某格"来预判路线。若以后要统一，最低成本方案是房主开局抽一次种子广播，其余人用同一种子本地重算（`TileField.reset(rng)` 已经接受外部随机源）。


## 8. 断线与重连

阶段 B 不做重连：连接断开即 `player_left`，房主自动转移给剩下的人，**其余玩家继续比赛、房间不关**（B1.8）。阶段 C 再评估 session 恢复（需升协议版本）。
