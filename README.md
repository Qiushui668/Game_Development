# PY Party Run · 彩虹冲刺

浏览器 3D 多人障碍跑酷。Vue 3 + TypeScript + Vite + Three.js + Rapier3D。

## 路线

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| A | 单机闭环（单人跑完全程 + 计时 + 结算） | 进行中（M1 → M1.6 → M2 已完成） |
| B | 局域网 2–5 人联机 | 未开始 |
| C | 上线服务器 2–8 人联机 | 未开始 |

每个阶段验收通过后才进入下一阶段。

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

## 文档

- `docs/DEVELOPMENT.md` — 环境、命令、目录结构、代码硬约束
- `docs/PERFORMANCE.md` — 性能基线与实测数字
- `docs/NETWORK_PROTOCOL.md` — 联机协议
- `PY_Party_Run_开发实施说明书_V1.1.md` — 完整实施说明书

## 机器基线

目标显卡 NVIDIA GT 610（1 GB）。画质策略：关抗锯齿、关实时阴影、像素比固定 1、渲染分辨率封顶 1280×720。判定标准为 P99 帧时间 ≤ 50 ms。
