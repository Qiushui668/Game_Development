<script setup lang="ts">
import { computed } from 'vue'
import type { QuizSnapshot } from '@/game/core/Game'

const props = defineProps<{ quiz: QuizSnapshot | null }>()
const emit = defineEmits<{ answer: [index: number] }>()

const phase = computed(() => props.quiz?.phase ?? 'off')
const promptGate = computed(() => props.quiz?.promptGate ?? null)
const solved = computed(() => props.quiz?.solved ?? 0)
const gateTotal = computed(() => props.quiz?.gateTotal ?? 4)
const gateNo = computed(() => props.quiz?.gate ?? 0)
const freezeLeft = computed(() => Math.max(0, props.quiz?.freezeLeft ?? 0))
const freezeText = computed(() => Math.max(1, Math.ceil(freezeLeft.value)))
/** 冻结进度圈：剩余比例，用于 SVG 描边 */
const freezeRatio = computed(() => {
  const total = props.quiz?.freezeTotal || 3
  return Math.max(0, Math.min(1, freezeLeft.value / total))
})
const labels = ['A', 'B', 'C', 'D']
const picked = computed(() => props.quiz?.lastChoice ?? null)
</script>

<template>
  <div v-if="quiz" class="quiz">
    <!-- 已解开的墙数：常驻右上角计时条下方 -->
    <div v-if="phase === 'off' && promptGate === null" class="chip">答题 {{ solved }} / {{ gateTotal }}</div>

    <!-- 墙前提示：按 F 开答 -->
    <div v-if="phase === 'off' && promptGate !== null" class="prompt">
      <span class="key">F</span>
      <span class="prompt-text">按 F 开始答题 · 关卡 {{ promptGate }} / {{ gateTotal }}</span>
    </div>

    <!-- 题面 -->
    <div v-if="phase === 'asking'" class="panel">
      <div class="panel-head">
        <span class="gate-no">QUIZ {{ gateNo }} / {{ gateTotal }}</span>
        <span class="tag">{{ quiz.category }}</span>
      </div>
      <div class="question">{{ quiz.text }}</div>
      <div class="options">
        <button
          v-for="(opt, i) in quiz.options"
          :key="i"
          class="option"
          :class="{ picked: picked === i }"
          @click="emit('answer', i)"
        >
          <span class="label">{{ labels[i] }}</span>
          <span class="text">{{ opt }}</span>
        </button>
      </div>
      <div class="foot">答对即可穿过这面空气墙 · 答错冻结 {{ quiz.freezeTotal }} 秒并换题</div>
    </div>

    <!-- 答错冻结：屏幕中央倒计时 -->
    <div v-if="phase === 'wrong'" class="freeze">
      <svg class="ring" viewBox="0 0 120 120">
        <circle class="ring-bg" cx="60" cy="60" r="52" />
        <circle
          class="ring-fg"
          cx="60"
          cy="60"
          r="52"
          :style="{ strokeDashoffset: `${(1 - freezeRatio) * 326.7}` }"
        />
      </svg>
      <div class="count">{{ freezeText }}</div>
      <div class="freeze-tip">答错了 · 冻结中</div>
      <div class="freeze-sub">3 秒后换一道新题</div>
    </div>

    <!-- 答对 -->
    <div v-if="phase === 'correct'" class="correct">
      <div class="check">✓</div>
      <div class="correct-text">答对，通过！</div>
    </div>
  </div>
</template>

<style scoped>
.quiz {
  position: absolute;
  inset: 0;
  pointer-events: none;
  font-family: 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif;
  user-select: none;
}

.chip {
  position: absolute;
  top: 108px;
  right: 16px;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(12, 26, 42, 0.55);
  font-size: 12px;
  font-weight: 700;
  color: #eafcff;
  letter-spacing: 0.5px;
}

.prompt {
  position: absolute;
  left: 50%;
  bottom: 13%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 22px;
  border-radius: 999px;
  background: rgba(10, 30, 46, 0.78);
  box-shadow: 0 10px 26px rgba(6, 22, 36, 0.35);
  animation: float 1.6s ease-in-out infinite;
}

.key {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: linear-gradient(180deg, #ffffff, #cdeff8);
  box-shadow: 0 4px 0 #7fb6c8;
  font-size: 20px;
  font-weight: 900;
  color: #0a3a4a;
}

.prompt-text {
  font-size: 16px;
  font-weight: 700;
  color: #f4fdff;
  text-shadow: 0 2px 10px rgba(8, 36, 52, 0.5);
}

.panel {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(720px, 82vw);
  padding: 22px 26px 18px;
  border-radius: 22px;
  background: rgba(10, 27, 43, 0.9);
  box-shadow: 0 24px 60px rgba(4, 16, 28, 0.5), inset 0 0 0 1px rgba(120, 240, 255, 0.18);
  pointer-events: auto;
  color: #f2fbff;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.gate-no {
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 2px;
  color: #46f0e6;
}

.tag {
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(255, 127, 200, 0.18);
  font-size: 12px;
  font-weight: 700;
  color: #ffb8e2;
}

.question {
  font-size: 20px;
  line-height: 1.5;
  font-weight: 700;
  margin-bottom: 16px;
}

.options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border: none;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.1);
  box-shadow: inset 0 0 0 1px rgba(160, 235, 255, 0.16);
  color: #f4fdff;
  font-size: 14px;
  line-height: 1.45;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s ease, transform 0.12s ease;
}

.option:hover {
  background: rgba(70, 240, 230, 0.22);
}

.option:active {
  transform: translateY(2px);
}

.option.picked {
  box-shadow: inset 0 0 0 2px #ff7fc8;
}

.label {
  flex: 0 0 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 24px;
  border-radius: 7px;
  background: rgba(47, 230, 221, 0.22);
  font-size: 13px;
  font-weight: 900;
  color: #b9fff8;
}

.foot {
  margin-top: 14px;
  font-size: 12px;
  text-align: center;
  color: rgba(226, 246, 255, 0.62);
}

.freeze {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: rgba(8, 20, 34, 0.42);
  backdrop-filter: blur(2px);
}

.ring {
  position: absolute;
  width: 260px;
  height: 260px;
}

.ring-bg {
  fill: none;
  stroke: rgba(255, 255, 255, 0.14);
  stroke-width: 5;
}

.ring-fg {
  fill: none;
  stroke: #ff5fa8;
  stroke-width: 5;
  stroke-dasharray: 326.7;
  stroke-dashoffset: 0;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.16s linear;
}

.count {
  position: relative;
  font-size: 108px;
  font-weight: 900;
  line-height: 1;
  color: #fff;
  text-shadow: 0 6px 0 #ff6ed1, 0 14px 30px rgba(10, 30, 50, 0.45);
  animation: pop 0.3s ease-out;
}

.freeze-tip {
  margin-top: 10px;
  padding: 6px 16px;
  border-radius: 999px;
  background: rgba(255, 95, 168, 0.22);
  font-size: 16px;
  font-weight: 800;
  color: #ffd3e8;
}

.freeze-sub {
  font-size: 12px;
  color: rgba(232, 246, 255, 0.7);
}

.correct {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  pointer-events: none;
  animation: pop 0.28s ease-out;
}

.check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 132px;
  height: 132px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(47, 230, 221, 0.35) 0%, rgba(47, 230, 221, 0) 70%);
  font-size: 88px;
  font-weight: 900;
  color: #7bffef;
  text-shadow: 0 4px 0 #17c9c0, 0 12px 26px rgba(8, 40, 50, 0.4);
}

.correct-text {
  padding: 6px 18px;
  border-radius: 999px;
  background: rgba(12, 30, 46, 0.7);
  font-size: 18px;
  font-weight: 800;
  color: #eafffd;
}

@keyframes pop {
  from {
    transform: scale(1.25);
    opacity: 0.35;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

@keyframes float {
  0%,
  100% {
    transform: translate(-50%, 0);
  }
  50% {
    transform: translate(-50%, -6px);
  }
}
</style>
