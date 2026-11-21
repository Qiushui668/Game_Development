<script setup lang="ts">
import { computed } from 'vue'
import { leaveRoom, room, startGame } from '@/net/roomStore'

const isHost = computed(() => room.hostId === room.selfId && room.selfId !== '')
const count = computed(() => room.players.length)
const canStart = computed(() => isHost.value && count.value >= room.minPlayers)
const waiting = computed(() => room.status === 'connecting')
/** 空位：最多画到容量，最少画 4 位，2 人房不至于看起来太空 */
const emptySlots = computed(() => Math.max(0, Math.max(4, count.value + 2) - count.value))
const startHint = computed(() => {
  if (isHost.value) {
    if (count.value < room.minPlayers) return `还要再等 ${room.minPlayers - count.value} 人才能开跑`
    return `${count.value} 人就位，随时可以开跑`
  }
  return '等房主点开始…'
})
</script>

<template>
  <div class="lobby">
    <div class="head">
      <div class="label">房间号</div>
      <div class="code">{{ room.code || '----' }}</div>
      <div class="count">{{ count }} / {{ room.capacity }} 人</div>
    </div>

    <div v-if="waiting" class="connecting">正在连接房间服务…</div>

    <ul v-else class="players">
      <li v-for="p in room.players" :key="p.id" class="player">
        <span class="dot" :style="{ background: p.color }" />
        <span class="nick">{{ p.nickname }}</span>
        <span v-if="p.id === room.selfId" class="tag me">我</span>
        <span v-if="p.host" class="tag host">房主</span>
      </li>
      <li v-for="n in emptySlots" :key="`e${n}`" class="player empty">
        <span class="dot ghost" />
        <span class="nick">等待加入…</span>
      </li>
    </ul>

    <p class="tip">{{ startHint }}</p>

    <div class="actions">
      <button v-if="isHost" class="start" :disabled="!canStart" @click="startGame">开始游戏</button>
      <button class="leave" @click="leaveRoom">离开房间</button>
    </div>

    <p class="net">局域网联机：其他人访问 <b>http://本机IP:5173</b> 后输入上面的房间号</p>
  </div>
</template>

<style scoped>
.lobby {
  width: min(520px, 92vw);
  padding: 22px 24px 20px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 16px 36px rgba(10, 50, 74, 0.2), inset 0 2px 0 #fff;
  color: #10304a;
}

.head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding-bottom: 14px;
  border-bottom: 2px dashed rgba(16, 138, 134, 0.16);
}

.label {
  font-size: 12.5px;
  font-weight: 700;
  color: #4f7286;
}

.code {
  font-size: 34px;
  font-weight: 900;
  letter-spacing: 8px;
  color: #0e8a86;
  text-shadow: 0 3px 0 rgba(23, 201, 192, 0.28);
}

.count {
  margin-left: auto;
  padding: 5px 12px;
  border-radius: 999px;
  background: rgba(255, 110, 209, 0.16);
  font-size: 13px;
  font-weight: 800;
  color: #b0327f;
}

.connecting {
  padding: 24px 0;
  text-align: center;
  font-size: 13px;
  color: #4f7286;
}

.players {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 14px 0 0;
  padding: 0;
  list-style: none;
}

.player {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 14px;
  background: rgba(16, 138, 134, 0.08);
}

.player.empty {
  background: rgba(16, 138, 134, 0.03);
  color: #86a4b4;
}

.dot {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  border-radius: 50%;
  box-shadow: 0 2px 6px rgba(10, 50, 74, 0.2);
}

.dot.ghost {
  background: rgba(16, 138, 134, 0.16);
  box-shadow: none;
}

.nick {
  font-size: 14px;
  font-weight: 700;
}

.tag {
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 800;
}

.tag.me {
  background: rgba(23, 201, 192, 0.22);
  color: #0e6b70;
}

.tag.host {
  margin-left: auto;
  background: rgba(255, 216, 77, 0.35);
  color: #8a6200;
}

.tip {
  margin: 12px 0 0;
  font-size: 12.5px;
  font-weight: 600;
  color: #4f7286;
  text-align: center;
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}

.start {
  flex: 1;
  padding: 13px 22px;
  border: none;
  border-radius: 999px;
  background: linear-gradient(180deg, #46f0e6, #17c9c0);
  color: #04343a;
  font-size: 16px;
  font-weight: 800;
  font-family: inherit;
  cursor: pointer;
  box-shadow: 0 6px 0 #0d9a94, 0 12px 22px rgba(8, 40, 50, 0.2);
}

.start:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  box-shadow: none;
}

.start:active:not(:disabled) {
  transform: translateY(3px);
  box-shadow: 0 3px 0 #0d9a94;
}

.leave {
  padding: 13px 20px;
  border: none;
  border-radius: 999px;
  background: rgba(16, 138, 134, 0.1);
  color: #0e6b70;
  font-size: 14px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
}

.net {
  margin: 14px 0 0;
  font-size: 11.5px;
  line-height: 1.6;
  color: #5e8296;
  text-align: center;
}

.net b {
  color: #0e8a86;
}
</style>
