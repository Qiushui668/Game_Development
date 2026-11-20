# 性能基线与实测记录

> 口径：**"不卡顿"看长尾，不看均值**。判定标准为 P99 帧时间 ≤ 50 ms（30 FPS 基线下），主目标 60 FPS。
> 全部数字为真机实测，非估算。生成方式见文末"复现方法"。

## 1. 实测环境

| 项 | 值 |
| --- | --- |
| CPU/GPU | NVIDIA GeForce GT 610 / 1 GB 显存 / 驱动 388.13 |
| 会话类型 | Console（本地物理会话，非远程桌面） |
| 屏分辨率 | 1920×1080 |
| 渲染后端 | `ANGLE (NVIDIA, NVIDIA GeForce GT 610 (0x0000104A) Direct3D11 vs_5_0 ps_5_0, D3D11)` |
| WebGL | WebGL 2.0 (OpenGL ES 3.0 Chromium) |
| 浏览器 | Chrome，硬件加速已开启（实测走硬件 D3D11，未回落软件渲染） |
| Node | v22.13.1 / npm 10.9.2 |
| 采集时间 | 2026-11-20 22:10 |

> 若"设置没变却突然变卡"，优先排查向日葵虚拟显示器 `OrayIddDriver Device` 是否抢了主屏。

## 2. M1 实测结果（框架 + 场景骨架）

采集时长 8 s，稳定后取 300 帧滑窗。

| 指标 | 实测 | 预算 | 结论 |
| --- | --- | --- | --- |
| FPS | 60.0 | ≥ 30（目标 60） | 达标 |
| avg 帧时间 | 16.67 ms | ≤ 33.3 ms | 达标 |
| P99 帧时间 | 16.80 ms | ≤ 50 ms | 达标 |
| max 帧时间 | 17.30 ms | — | 无尖刺 |
| draw calls | 8 | ≤ 60 | 达标 |
| 三角面 | 190 | ≤ 30 k | 达标 |

启动阶段（首帧后 10 帧内）观测到一次 50 ms 的尖刺，来源是着色器编译与 Rapier wasm 初始化，属一次性成本，稳定后消失。

## 3. 已生效的画质降级（针对 GT 610）

| 策略 | 取值 | 位置 |
| --- | --- | --- |
| 抗锯齿 | `antialias: false` | `SceneManager` |
| 像素比 | 固定 `1`，不随 DPR 放大 | `RENDER.pixelRatio` |
| 渲染分辨率 | 上限 1280×720，超出用 CSS 拉伸 | `RENDER.maxWidth/maxHeight` |
| 实时阴影 | 关闭（`shadowMap.enabled = false`） | `SceneManager` |
| 色调映射 | `NoToneMapping` | `SceneManager` |
| 雾效 | 90–220 m，裁掉远处细节 | `RENDER.fogNear/fogFar` |
| 材质 | 仅 `MeshLambertMaterial`（廉价光照模型） | `Materials` |
| 合批 | 护栏、拱门、远山各自 mergeGeometries | `World` / `Environment` |
| 光源 | 1 平行光 + 1 半球光，无点光无投影 | `Lighting` |

## 4. M1 之后的风险点（必须持续盯）

1. **角色 + 障碍物进入赛道后** draw call 会从 8 涨到约 20–30，三角面到 1–3 k，仍应在预算内，但需重测。
2. **Rapier 物理步**：固定 1/60、`maxSubSteps = 2`。物体数量增加时物理耗时上升，掉帧时宁可慢放也不追帧（`GameLoop` 已实现）。
3. **联机阶段的插值**：若做服务端回放插值，每帧额外插值开销约 0.1–0.3 ms/玩家，8 人时约 2 ms，可接受。
4. **Vite 开发态 vs 生产态**：开发态 bundle 未压缩（4.9 MB），首屏加载慢但 FPS 不影响；发版前用 `dist` 复测一次。

## 5. 复现方法

```powershell
# 1. 起开发服务器
npm run dev

# 2. 另一窗口跑探针（必须用项目 .venv）
.\.venv\Scripts\python.exe tools\perf_probe.py `
  --url http://localhost:5173/ `
  --duration 8 `
  --json tools\perf_m1.json `
  --png tools\perf_m1.png
```

探针会启动独立的临时 Chrome 实例（独立 `--user-data-dir`，不污染日常浏览器），通过 CDP 读取页面里的 `window.__PPR.getPerf()`，同时回传 WebGL 渲染器字符串并截图。

`window.__PPR` 仅在 `import.meta.env.DEV` 下挂载，生产构建不暴露。

## 6. 记录表（后续阶段在此追加）

| 阶段 | 日期 | FPS | P99 | draw | tri | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| M1 框架+赛道骨架 | 2026-11-20 | 60.0 | 16.80 ms | 8 | 190 | 基线 |
