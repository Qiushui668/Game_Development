<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import {
  Game,
  type NetConfig,
  type PerfSnapshot,
  type QuizSnapshot,
  type RaceSnapshot,
  type StatusSnapshot,
} from '@/game/core/Game'
import DebugOverlay from '@/components/game/DebugOverlay.vue'
import RaceHud from '@/components/game/RaceHud.vue'
import QuizPanel from '@/components/game/QuizPanel.vue'
import { backToLobby, onGameEvent, room, roomClient, voteRematch } from '@/net/roomStore'
import { recallColor, recallNickname } from '@/game/core/Profile'

const props = defineProps<{ online: boolean }>()
const emit = defineEmits<{ exit: [] }>()

const host = ref<HTMLElement | null>(null)
const stats = shallowRef<PerfSnapshot | null>(null)
const race = shallowRef<RaceSnapshot | null>(null)
const quiz = shallowRef<QuizSnapshot | null>(null)
const status = shallowRef<StatusSnapshot | null>(null)
const error = ref<string | null>(null)

let game: Game | null = null
let timer = 0
let raceTimer = 0
let unsubGame: (() => void) | null = null

/** 把当前房间状态包成 Game 认识的最小网络接口 */
function buildNet(): NetConfig | null {
  if (!props.online) return null
  const me = room.players.find((p) => p.id === room.selfId)
  return {
    selfId: room.selfId,
    nickname: me?.nickname ?? recallNickname() ?? '玩家',
    color: me?.color ?? recallColor(),
    slot: me?.slot ?? 0,
    playerCount: Math.max(1, room.players.length),
    peers: room.players
      .filter((p) => p.id !== room.selfId)
      .map((p) => ({ id: p.id, nickname: p.nickname, color: p.color, slot: p.slot })),
    send: (ev) => roomClient.send(ev),
  }
}

onMounted(async () => {
  if (!host.value) return
  try {
    const instance = new Game(host.value, buildNet())
    game = instance
    await instance.init()
    instance.start()

    if (props.online) {
      unsubGame = onGameEvent((ev) => {
        switch (ev.type) {
          case 'player_state':
            instance.applyRemoteState(ev.playerId, ev.payload)
            break
          case 'attack_played':
            instance.playRemoteAttack(ev.playerId, ev.kind, ev.side)
            break
          case 'take_hit':
            instance.receiveNetHit(ev.kind, ev.x, ev.z, ev.fromId)
            break
          case 'player_died':
            instance.applyPeerDeath(ev.playerId, ev.killerId)
            break
          case 'game_started':
            instance.forceMatchStart()
            break
          case 'countdown':
            // 再来一局：本机已经在游戏里（结算页），直接复位进下一局倒数
            instance.resetRound()
            break
          case 'race_over':
            // 有人冲线：全场一起看结算，别再像以前那样把领先的人独自扔进结果页
            instance.endMatch(null)
            break
          case 'player_joined':
            // 中途加入：老玩家的画面里补一个远端果冻人
            instance.addPeer(ev.player)
            break
          case 'player_left':
            instance.removeRemote(ev.playerId)
            break
          default:
            break
        }
      })
    }

    // 低频拉快照（4 Hz）：游戏循环不触碰 Vue 响应式
    timer = window.setInterval(() => {
      stats.value = instance.getPerf()
    }, 250)
    // 计时器 / 答题面板要看起来连续，单独 10 Hz 拉取
    raceTimer = window.setInterval(() => {
      race.value = instance.getRace()
      quiz.value = instance.getQuiz()
      status.value = instance.getStatus()
    }, 100)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
})

function restartRace(): void {
  game?.restart()
}

/** 结算面板「返回房间」：多人局整房回大厅；单机没有房间，就回首页重新选模式 */
function backToRoom(): void {
  if (!props.online) {
    emit('exit')
    return
  }
  backToLobby()
}

/** 结算面板「再来一局」：投票，全员都点了服务器才自动开局 */
const votedRematch = computed(() => room.rematchVoterIds.includes(room.selfId))
function rematch(): void {
  if (votedRematch.value) return
  voteRematch()
}

function answerQuiz(index: number): void {
  game?.answerQuiz(index)
}

onBeforeUnmount(() => {
  window.clearInterval(timer)
  window.clearInterval(raceTimer)
  unsubGame?.()
  unsubGame = null
  game?.dispose()
  game = null
})
</script>

<template>
  <div class="canvas-host" ref="host">
    <div v-if="error" class="error">初始化失败：{{ error }}</div>

    <div v-if="online" class="room-badge">房间 {{ room.code }} · {{ room.players.length }} 人</div>
    <button class="exit" @click="emit('exit')">{{ online ? '退出房间' : '返回首页' }}</button>

    <RaceHud
      :race="race"
      :status="status"
      :online="online"
      :board="online ? room.board : []"
      :rematch-votes="online ? room.rematchVotes : 0"
      :rematch-total="online ? room.rematchTotal : 0"
      :voted="votedRematch"
      @restart="restartRace"
      @lobby="backToRoom"
      @rematch="rematch"
    />
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

.room-badge {
  position: absolute;
  left: 50%;
  top: 12px;
  transform: translateX(-50%);
  padding: 7px 16px;
  border-radius: 999px;
  background: rgba(12, 26, 42, 0.58);
  color: #eaf7ff;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.5px;
  pointer-events: none;
}

.exit {
  position: absolute;
  right: 16px;
  bottom: 14px;
  padding: 8px 16px;
  border: none;
  border-radius: 999px;
  background: rgba(12, 26, 42, 0.58);
  color: #eaf7ff;
  font-size: 13px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  pointer-events: auto;
}

.exit:hover {
  background: rgba(12, 26, 42, 0.75);
}
</style>
