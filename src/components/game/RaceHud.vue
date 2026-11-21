<script setup lang="ts">
import { computed } from 'vue'
import type { RaceSnapshot } from '@/game/core/Game'

const props = defineProps<{ race: RaceSnapshot | null }>()
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
</script>

<template>
  <div class="hud">
    <!-- 计时条：倒数结束后出现 -->
    <div v-if="timing" class="timer">
      <div class="time">{{ timeText }}</div>
      <div class="meta">剩余 {{ remaining }} m · 最佳 {{ bestText }}</div>
      <div class="bar"><div class="fill" :style="{ width: progressPct }" /></div>
    </div>

    <!-- 操作提示：只在对局中显示，结算面板会盖住 -->
    <div v-if="state === 'Racing'" class="controls">
      <span class="key">左键</span>轻击
      <span class="sep">·</span>
      <span class="key">右键</span>重击
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
        <div class="line">最佳成绩 {{ bestText }}</div>
        <button class="again" @click="emit('restart')">再跑一次</button>
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
