# PY Party Run · 彩虹冲刺

浏览器 3D 多人障碍跑酷。Vue 3 + TypeScript + Vite + Three.js + Rapier3D。

## 路线

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| A | 单机闭环（单人跑完全程 + 计时 + 结算） | 已完成（M1 → M4.1） |
| B | 局域网 2–8 人联机（首页 / 房间 / 同步 / 互殴） | 已完成（B1） |
| C | 上线服务器 2–8 人联机 | 未开始 |

每个阶段验收通过后才进入下一阶段。

## 玩法

- 打开网站先进**首页**：`单人游戏` 直接跑一局；`多人游戏` 可以**创建房间**（拿 4 位房间号）或**输入房间号加入**，2–8 人，房主点开始后全场同时起跑。
- 起跑倒数 3 s → 计时开跑，冲过 320 m 糖果赛道，冲线急停后出结算（多人局结算面板列出全场名次与服务器计时）。
- 赛道上均布 4 面**答题空气墙**（序号 1–4）：走到墙前按 `F` 开答，答对才能穿墙；答错屏幕冻结 3 s、中央倒计时，结束后换一道新题直到答对。
- 题库取自 `趣味选择题100题.xlsx`（100 题），抽题会打乱选项顺序，且同一局不重复出题。
- 背景音乐 `public/audio/danzai.mp3` 循环播放（浏览器要求用户手势，首次点击画面或按键后开始）。
- 鼠标 + `WASD` 移动、`Shift` 冲刺、`Space` 跳，撞到扫地杆 / 滚轴会被击退并短暂硬直。
- 攻击：鼠标**左键**单臂轻击（0.36 s，命中约 0.16 s）；**右键**双臂抬起后摇 1 s 再砸下（总 1.55 s）。判定按联机规则设计：轻击累计 3 次使对方倒地眩晕 1 s（连击窗口 1.6 s），重击一次即倒地。多人局里命中会真的打到对面，结算在被打的那一端。
- 护栏是圆角顶：跳上去会滑回赛道，站不住、也沿不了护栏跑（跳过扫地杆/栏架的漏洞已封）。
- 答题时被打倒（轻击 3 次或重击 1 次）会**中断答题**：题作废、墙不拆、眩晕 1 秒，之后回墙前重新按 `F` 换题再答。

## 快速开始

```powershell
npm install
npm run dev      # 单人自己玩：http://localhost:5173
```

局域网联机（Vite 与服务端一起起，会打印别人该访问的地址）：

```powershell
npm run lan
```

只起房间服务（Vite 另开一个终端 `npm run dev`）：

```powershell
npm run server   # ws://0.0.0.0:8000/ws
```

同一局域网内其他人打开 `http://<你的内网IP>:5173`，在首页选多人游戏、输入房间号即可。房间 2–8 人，人数不足 2 人时房主无法开跑。

构建与类型检查：

```powershell
npm run build
```

性能实测（需 `.venv`）：

```powershell
.\.venv\Scripts\python.exe tools\perf_probe.py --url http://localhost:5173/
```

手感验收（角色控制 / 跳跃 / 坡面 / 碰撞 / 复活，8 项）：

```powershell
.\.venv\Scripts\python.exe tools\verify_m2.py
```

障碍验收（扫地杆扫中 / 击退位移 / 硬直恢复 / 滚轴顶回 / 关卡长度，5 项）：

```powershell
.\.venv\Scripts\python.exe tools\verify_m3.py
```

音乐与答题验收（音乐循环 / 4 面墙挡人 / F 开答 / 答错冻结换题 / 答对穿墙 / 重开复位，12 项）：

```powershell
.\.venv\Scripts\python.exe tools\verify_m4.py
```

攻击验收（轻击单手抡 / 重击双臂举 1 s 后砸 / 3 轻击击倒 / 重击必倒 / 连击窗口 / 出招不锁移动 / 答题中禁止出招，9 项）：

```powershell
.\.venv\Scripts\python.exe tools\verify_m5.py
```

护栏圆角顶与答题中断验收（护栏顶站不住 / 重击打断答题 / 3 轻击才打断 / 未答题只眩晕 / 打断后可重新答，6 项）：

```powershell
.\.venv\Scripts\python.exe tools\verify_m6.py
```

联机验收（双浏览器走真实首页与房间 UI）：

```powershell
# 先起房间服务：npm run server
node tools\smoke_room.mjs                        # 服务端协议 23 项（建房/进房/权限/中继/攻击/榜单/满员/房主转移）
.\.venv\Scripts\python.exe tools\verify_m7.py    # 双客户端 18 项（首页/建房/输号加入/同步/互殴/打断答题/冲线榜单）
```

## 文档

- `docs/DEVELOPMENT.md` — 环境、命令、目录结构、代码硬约束
- `docs/PERFORMANCE.md` — 性能基线与实测数字
- `docs/NETWORK_PROTOCOL.md` — 联机协议
- `PY_Party_Run_开发实施说明书_V1.1.md` — 完整实施说明书

## 机器基线

目标显卡 NVIDIA GT 610（1 GB）。画质策略：关抗锯齿、关实时阴影、像素比固定 1、渲染分辨率封顶 1280×720。判定标准为 P99 帧时间 ≤ 50 ms。
