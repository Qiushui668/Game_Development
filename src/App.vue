<script setup lang="ts">
import { ref, watch } from 'vue'
import HomeView from '@/views/HomeView.vue'
import GameView from '@/views/GameView.vue'
import { leaveRoom, room } from '@/net/roomStore'

type View = 'home' | 'game'
const view = ref<View>('home')
/** 进驻的是单人局还是多人局 */
const online = ref(false)

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
</template>
