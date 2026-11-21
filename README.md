# PY Party Run · 彩虹冲刺

浏览器 3D 多人障碍跑酷。Vue 3 + TypeScript + Vite + Three.js + Rapier3D。

## 路线

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| A | 单机闭环（单人跑完全程 + 计时 + 结算） | 已完成（M1 → M3.3） |
| B | 局域网 2–5 人联机 | 未开始 |
| C | 上线服务器 2–8 人联机 | 未开始 |

每个阶段验收通过后才进入下一阶段。

## 玩法

- 起跑倒数 3 s → 计时开跑，冲过 320 m 糖果赛道，冲线急停后出结算。
- 赛道上均布 4 面**答题空气墙**（序号 1–4）：走到墙前按 `F` 开答，答对才能穿墙；答错屏幕冻结 3 s、中央倒计时，结束后换一道新题直到答对。
- 题库取自 `趣味选择题100题.xlsx`（100 题），抽题会打乱选项顺序，且同一局不重复出题。
- 背景音乐 `public/audio/danzai.mp3` 循环播放（浏览器要求用户手势，首次点击画面或按键后开始）。
- 鼠标 + `WASD` 移动、`Shift` 冲刺、`Space` 跳，撞到扫地杆 / 滚轴会被击退并短暂硬直。

## 快速开始

```powershell
npm install
npm run dev      # http://localhost:5173
```

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

## 文档

- `docs/DEVELOPMENT.md` — 环境、命令、目录结构、代码硬约束
- `docs/PERFORMANCE.md` — 性能基线与实测数字
- `docs/NETWORK_PROTOCOL.md` — 联机协议
- `PY_Party_Run_开发实施说明书_V1.1.md` — 完整实施说明书

## 机器基线

目标显卡 NVIDIA GT 610（1 GB）。画质策略：关抗锯齿、关实时阴影、像素比固定 1、渲染分辨率封顶 1280×720。判定标准为 P99 帧时间 ≤ 50 ms。
