<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import HomeView from '@/views/HomeView.vue'
import GameView from '@/views/GameView.vue'
import { leaveRoom, room } from '@/net/roomStore'
import { installExitGuard } from '@/app/exitGuard'

type View = 'home' | 'game'
const view = ref<View>('home')
/** 进驻的是单人局还是多人局 */
const online = ref(false)
/** 被守卫拦下"返回"时的提示（2 s 自动消失） */
const blockedTip = ref(false)
let blockedTimer = 0

let removeGuard: (() => void) | null = null
onMounted(() => {
  removeGuard = installExitGuard({
    // 单人局 / 多人房 / 比赛中都算"不能随手退"，首页不算
    isBusy: () => view.value === 'game' || room.status !== 'idle',
    onBlocked: () => {
      blockedTip.value = true
      window.clearTimeout(blockedTimer)
      blockedTimer = window.setTimeout(() => (blockedTip.value = false), 2000)
    },
  })
})
onBeforeUnmount(() => {
  window.clearTimeout(blockedTimer)
  removeGuard?.()
  removeGuard = null
})

// 服务器开跑 → 进游戏；回到大厅 → 回首页（首页那边会直接显示房间）
watch(
  () => room.status,
  (status) => {
    if (status === 'playing') {
      online.value = true
      view.value = 'game'
    } else if (status === 'lobby' && online.value && view.value === 'game') {
      view.value = 'home'
    } else if (status === 'idle' && online.value) {
      online.value = false
      view.value = 'home'
    }
  },
)

function playSolo(): void {
  online.value = false
  view.value = 'game'
}

function exitGame(): void {
  view.value = 'home'
  if (online.value) {
    leaveRoom()
    online.value = false
  }
}
</script>

<template>
  <HomeView v-if="view === 'home'" @solo="playSolo" />
  <GameView v-else :online="online" @exit="exitGame" />
  <div v-if="blockedTip" class="guard-tip">
    正在游戏 / 房间里，浏览器的返回、鼠标侧键和手势已经被挡住了 —— 要退出请点游戏里的「退出房间」
  </div>
</template>

<style scoped>
.guard-tip {
  position: fixed;
  left: 50%;
  bottom: 26px;
  z-index: 50;
  max-width: min(560px, 92vw);
  padding: 10px 18px;
  border-radius: 999px;
  background: rgba(12, 26, 42, 0.88);
  color: #eaf7ff;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
  text-align: center;
  transform: translateX(-50%);
  pointer-events: none;
}
</style>
