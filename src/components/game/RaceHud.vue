<script setup lang="ts">
import { computed } from 'vue'
import type { RaceSnapshot, StatusSnapshot } from '@/game/core/Game'
import type { LeaderboardRow } from '@/types/network'

const props = defineProps<{
  race: RaceSnapshot | null
  /** 生命值 / 击杀快照（10 Hz） */
  status?: StatusSnapshot | null
  /** 多人局：结算面板改显示全场名次，按钮改成回房间 */
  online?: boolean
  board?: LeaderboardRow[]
}>()
const emit = defineEmits<{ restart: [] }>()

/** 3.87 s / 12.34 s / 1:05.42 三种长度自适应 */
function fmt(ms: number): string {
  const total = Math.max(0, ms) / 1000
  if (total < 60) return `${total.toFixed(2)} s`
  const m = Math.floor(total / 60)
  const s = total - m * 60
  return `${m}:${s.toFixed(2).padStart(5, '0')}`
}

const state = computed(() => props.race?.state ?? 'Menu')
const timing = computed(() => state.value === 'Racing' || state.value === 'Finished')
const showCountdown = computed(() => state.value === 'Countdown')
const showResult = computed(() => state.value === 'Result')
const countdownText = computed(() => Math.max(1, Math.ceil(props.race?.countdown ?? 0)))
const timeText = computed(() => fmt(props.race?.elapsedMs ?? 0))
const bestText = computed(() => (props.race?.bestMs ? fmt(props.race.bestMs) : '—'))
const progressPct = computed(() => `${Math.round((props.race?.progress ?? 0) * 100)}%`)
const remaining = computed(() => Math.round(props.race?.remaining ?? 0))
const rows = computed(() => props.board ?? [])
const showBoard = computed(() => Boolean(props.online) && rows.value.length > 1)
const againText = computed(() => (props.online ? '回房间' : '再跑一次'))

/** 血条：满血青绿，半血黄，残血红 */
const hp = computed(() => props.status?.hp ?? 100)
const hpMax = computed(() => props.status?.maxHp ?? 100)
const hpPct = computed(() => `${Math.max(0, Math.min(100, (hp.value / hpMax.value) * 100))}%`)
const hpTint = computed(() => {
  const r = hp.value / hpMax.value
  if (r > 0.6) return 'linear-gradient(90deg, #35e07a, #2fe6dd)'
  if (r > 0.3) return 'linear-gradient(90deg, #ffd23f, #ff8a3d)'
  return 'linear-gradient(90deg, #ff5f5f, #ff3f8b)'
})
const kills = computed(() => props.status?.kills ?? 0)
/** 受击抖动 / 死亡提示 */
const hurt = computed(() => (props.status?.hurtFlash ?? 0) > 0)
const dead = computed(() => (props.status?.deathFlash ?? 0) > 0)
const killFlash = computed(() => (props.status?.killFlash ?? 0) > 0)
</script>

<template>
  <div class="hud">
    <!-- 生命值 + 击杀：倒数结束到结算之间都显示 -->
    <div v-if="timing || showCountdown" class="vitals" :class="{ hurt }">
      <div class="hp-row">
        <span class="label">HP</span>
        <div class="hp-bar">
          <div class="hp-fill" :style="{ width: hpPct, background: hpTint }" />
        </div>
        <span class="hp-num">{{ Math.max(0, Math.round(hp)) }}<i>/{{ hpMax }}</i></span>
      </div>
      <div class="kill-row">
        <span class="kills">击杀 <b>{{ kills }}</b></span>
        <span v-if="killFlash" class="kill-pop">击杀！</span>
      </div>
    </div>

    <!-- 死亡提示 -->
    <div v-if="dead" class="death-tip">被击倒 · 回起点满血复活</div>

    <!-- 计时条：倒数结束后出现 -->
    <div v-if="timing" class="timer">
      <div class="time">{{ timeText }}</div>
      <div class="meta">剩余 {{ remaining }} m · 最佳 {{ bestText }}</div>
      <div class="bar"><div class="fill" :style="{ width: progressPct }" /></div>
    </div>

    <!-- 操作提示：只在对局中显示，结算面板会盖住 -->
    <div v-if="state === 'Racing'" class="controls">
      <span class="key">左键</span>轻击 -34
      <span class="sep">·</span>
      <span class="key">右键</span>重击 -70
    </div>

    <!-- 起跑倒数 -->
    <div v-if="showCountdown" class="countdown">
      <div class="digit">{{ countdownText }}</div>
      <div class="tip">冲过 320 m 糖果赛道</div>
    </div>

    <!-- 结算 -->
    <div v-if="showResult" class="result">
      <div class="card">
        <div class="title">FINISH</div>
        <div class="score">{{ fmt(race?.finishMs ?? 0) }}</div>
        <div class="line">最佳成绩 {{ bestText }} · 本局击杀 {{ kills }}</div>

        <ol v-if="showBoard" class="board">
          <li v-for="(row, i) in rows" :key="row.playerId" class="row">
            <span class="rank">{{ i + 1 }}</span>
            <span class="who" :style="{ color: row.color }">{{ row.nickname }}</span>
            <span class="row-kills">{{ row.kills ?? 0 }} 杀</span>
            <span class="row-time">{{ row.timeMs === null ? '未完成' : fmt(row.timeMs) }}</span>
          </li>
        </ol>

        <button class="again" @click="emit('restart')">{{ againText }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hud {
  position: absolute;
  inset: 0;
  pointer-events: none;
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  user-select: none;
}

.timer {
  position: absolute;
  top: 14px;
  right: 16px;
  min-width: 210px;
  padding: 10px 18px 12px;
  border-radius: 14px;
  background: rgba(12, 26, 42, 0.62);
  box-shadow: 0 8px 24px rgba(8, 24, 40, 0.25);
  text-align: center;
  color: #f2fbff;
}

.vitals {
  position: absolute;
  left: 16px;
  /* 左下角：避开左上角的调试条，同时贴近角色与操作提示 */
  bottom: 54px;
  min-width: 236px;
  padding: 10px 14px 9px;
  border-radius: 14px;
  background: rgba(12, 26, 42, 0.62);
  box-shadow: 0 8px 24px rgba(8, 24, 40, 0.25);
  color: #f2fbff;
  transition: transform 0.12s ease-out, box-shadow 0.12s ease-out;
}

.vitals.hurt {
  transform: translateX(-3px);
  box-shadow: 0 0 0 2px rgba(255, 95, 95, 0.65), 0 8px 24px rgba(8, 24, 40, 0.25);
}

.hp-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.label {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 1px;
  opacity: 0.85;
}

.hp-bar {
  flex: 1;
  height: 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  overflow: hidden;
}

.hp-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.15s linear, background 0.2s linear;
}

.hp-num {
  font-size: 15px;
  font-weight: 800;
  min-width: 54px;
  text-align: right;
}

.hp-num i {
  font-style: normal;
  font-size: 10px;
  opacity: 0.6;
}

.kill-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  font-size: 12px;
  opacity: 0.92;
}

.kills b {
  font-size: 16px;
  color: #fff07a;
}

.kill-pop {
  padding: 1px 8px;
  border-radius: 999px;
  background: rgba(255, 240, 122, 0.18);
  color: #fff07a;
  font-weight: 800;
  animation: pop 0.4s ease-out;
}

.death-tip {
  position: absolute;
  left: 50%;
  top: 34%;
  transform: translateX(-50%);
  padding: 10px 22px;
  border-radius: 999px;
  background: rgba(120, 20, 40, 0.72);
  color: #ffe6ec;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 1px;
  animation: pop 0.9s ease-out;
}

.row-kills {
  font-size: 12px;
  font-weight: 700;
  color: #fff07a;
  opacity: 0.9;
}

.time {
  font-size: 30px;
  font-weight: 800;
  letter-spacing: 0.5px;
  line-height: 1.05;
}

.meta {
  margin-top: 2px;
  font-size: 12px;
  opacity: 0.82;
}

.bar {
  margin-top: 8px;
  height: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  overflow: hidden;
}

.fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #2fe6dd, #ff7fc8);
  transition: width 0.2s linear;
}

.controls {
  position: absolute;
  left: 18px;
  bottom: 18px;
  padding: 7px 14px;
  border-radius: 999px;
  background: rgba(12, 26, 42, 0.55);
  font-size: 13px;
  font-weight: 600;
  color: #eaf7ff;
  opacity: 0.9;
}

.controls .key {
  display: inline-block;
  margin-right: 5px;
  padding: 2px 8px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.16);
  font-weight: 800;
}

.controls .sep {
  margin: 0 6px;
  opacity: 0.5;
}

.countdown {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.digit {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 168px;
  height: 168px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(16, 40, 58, 0.55) 0%, rgba(16, 40, 58, 0.18) 62%, rgba(16, 40, 58, 0) 72%);
  font-size: 96px;
  font-weight: 900;
  color: #fff;
  text-shadow: 0 5px 0 #ff6ed1, 0 10px 24px rgba(12, 40, 60, 0.45);
  animation: pop 0.9s ease-out;
}

.tip {
  padding: 6px 16px;
  border-radius: 999px;
  background: rgba(12, 28, 46, 0.62);
  font-size: 15px;
  font-weight: 600;
  color: #f4fbff;
  text-shadow: 0 2px 10px rgba(12, 40, 60, 0.45);
}

.result {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(10, 24, 40, 0.34);
  pointer-events: auto;
  backdrop-filter: blur(3px);
}

.card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  min-width: 300px;
  padding: 26px 40px 30px;
  border-radius: 22px;
  background: rgba(12, 28, 46, 0.82);
  box-shadow: 0 18px 40px rgba(6, 20, 34, 0.45);
}

.title {
  font-size: 40px;
  font-weight: 900;
  letter-spacing: 4px;
  color: #fff07a;
  text-shadow: 0 4px 0 #ff6ed1, 0 10px 24px rgba(12, 40, 60, 0.4);
}

.score {
  font-size: 52px;
  font-weight: 900;
  color: #fff;
}

.line {
  font-size: 14px;
  color: #eaf6ff;
  opacity: 0.9;
}

.board {
  width: 100%;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.08);
  font-size: 13px;
}

.rank {
  width: 20px;
  flex: 0 0 20px;
  font-weight: 900;
  color: #fff07a;
}

.who {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
}

.row-time {
  font-weight: 700;
  color: #eaf6ff;
  opacity: 0.92;
}

.again {
  margin-top: 8px;
  padding: 12px 30px;
  border: none;
  border-radius: 999px;
  background: linear-gradient(180deg, #46f0e6, #17c9c0);
  color: #04343a;
  font-size: 16px;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 6px 0 #0d9a94, 0 10px 20px rgba(8, 40, 50, 0.28);
}

.again:active {
  transform: translateY(3px);
  box-shadow: 0 3px 0 #0d9a94;
}

@keyframes pop {
  from {
    transform: scale(0.6);
    opacity: 0.2;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
