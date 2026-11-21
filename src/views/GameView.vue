<script setup lang="ts">
import { defineProps, defineEmits } from 'vue'
import GameCanvas from '@/components/game/GameCanvas.vue'

defineProps<{ online: boolean }>()
const emit = defineEmits<{ exit: [] }>()
</script>

<template>
  <div class="view">
    <GameCanvas :online="online" @exit="emit('exit')" />
  </div>
</template>

<style scoped>
.view {
  position: relative;
  width: 100%;
  height: 100%;
}
</style>
