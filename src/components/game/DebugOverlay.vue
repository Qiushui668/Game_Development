<script setup lang="ts">
import { computed } from 'vue'
import type { PerfSnapshot } from '@/game/core/Game'

const props = defineProps<{ stats: PerfSnapshot | null }>()

const lines = computed(() => {
  const s = props.stats
  if (!s || s.samples === 0) return ['等待首帧…']
  return [
    `FPS ${s.fps.toFixed(1)}`,
    `avg ${s.avgMs.toFixed(2)} ms`,
    `P99 ${s.p99Ms.toFixed(2)} ms`,
    `max ${s.maxMs.toFixed(2)} ms`,
    `draw ${s.drawCalls}`,
    `tri ${s.triangles}`,
    `spd ${s.speed.toFixed(2)} m/s`,
    s.grounded ? 'GND' : 'AIR',
    `n=${s.samples}`,
  ]
})
</script>

<template>
  <div class="overlay">
    <div v-for="line in lines" :key="line">{{ line }}</div>
  </div>
</template>

<style scoped>
.overlay {
  position: absolute;
  top: 12px;
  left: 12px;
  min-width: 132px;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(13, 18, 32, 0.72);
  font-family: ui-monospace, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  color: #d7e3f4;
  pointer-events: none;
  white-space: pre;
}
</style>
