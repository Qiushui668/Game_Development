<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { Game, type PerfSnapshot, type QuizSnapshot, type RaceSnapshot } from '@/game/core/Game'
import DebugOverlay from '@/components/game/DebugOverlay.vue'
import RaceHud from '@/components/game/RaceHud.vue'
import QuizPanel from '@/components/game/QuizPanel.vue'

const host = ref<HTMLElement | null>(null)
const stats = shallowRef<PerfSnapshot | null>(null)
const race = shallowRef<RaceSnapshot | null>(null)
const quiz = shallowRef<QuizSnapshot | null>(null)
const error = ref<string | null>(null)

let game: Game | null = null
let timer = 0
let raceTimer = 0

onMounted(async () => {
  if (!host.value) return
  try {
    const instance = new Game(host.value)
    game = instance
    await instance.init()
    instance.start()
    // 低频拉快照（4 Hz）：游戏循环不触碰 Vue 响应式
    timer = window.setInterval(() => {
      stats.value = instance.getPerf()
    }, 250)
    // 计时器 / 答题面板要看起来连续，单独 10 Hz 拉取
    raceTimer = window.setInterval(() => {
      race.value = instance.getRace()
      quiz.value = instance.getQuiz()
    }, 100)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
})

function restartRace(): void {
  game?.restart()
}

function answerQuiz(index: number): void {
  game?.answerQuiz(index)
}

onBeforeUnmount(() => {
  window.clearInterval(timer)
  window.clearInterval(raceTimer)
  game?.dispose()
  game = null
})
</script>

<template>
  <div class="canvas-host" ref="host">
    <div v-if="error" class="error">初始化失败：{{ error }}</div>
    <RaceHud :race="race" @restart="restartRace" />
    <QuizPanel :quiz="quiz" @answer="answerQuiz" />
    <DebugOverlay :stats="stats" />
  </div>
</template>

<style scoped>
.canvas-host {
  position: absolute;
  inset: 0;
  background: #8fd2ff;
}

.error {
  position: absolute;
  inset: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  border-radius: 8px;
  background: rgba(180, 30, 30, 0.85);
  font-size: 15px;
  line-height: 1.5;
  color: #fff;
}
</style>
