<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CROWD_COLORS } from '@/game/core/GameConfig'
import {
  normalizeColor,
  nicknameFresh,
  nicknameLeftMs,
  randomCrowdColor,
  saveColor,
} from '@/game/core/Profile'
import RoomLobby from '@/components/home/RoomLobby.vue'
import {
  createRoom,
  joinRoom,
  recallIdentity,
  refreshRooms,
  rememberIdentity,
  room,
  roomList,
} from '@/net/roomStore'

const emit = defineEmits<{ solo: [] }>()

type Panel = 'none' | 'multi'
const panel = ref<Panel>('none')

/** 昵称门里正在输入的内容：永远是空白的，不预填旧昵称 */
const draft = ref('')
/** 已经确认过的昵称（1 小时有效），有值就表示可以跳过昵称门 */
const nickname = ref('')
/** 选中的配色；空串 = 还没选（确认昵称 / 开跑时会随机补一个，保证自己看和别人看一致） */
const color = ref('')
const code = ref('')
const busy = ref(false)
/** 昵称门：必须先确认昵称，才露出单人 / 多人入口 */
const named = ref(false)
/** 昵称剩余有效期（分钟），进大厅后给一句"还有多久要重填"的提示 */
const leftMinutes = ref(0)

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`
const swatches = CROWD_COLORS.slice(0, 8).map(hex)

let roomTimer = 0

onMounted(() => {
  draft.value = ''
  const saved = recallIdentity()
  const savedColor = normalizeColor(saved.color)
  if (savedColor && swatches.includes(savedColor)) color.value = savedColor
  // 昵称 1 小时时效：还在有效期内就直接跳过昵称门，不用每次加载页面都重填
  if (nicknameFresh()) {
    nickname.value = saved.nickname
    named.value = true
    leftMinutes.value = Math.ceil(nicknameLeftMs() / 60000)
    // 名字还在有效期但从来没用过配色（老存档）：直接随机一个并记住，
    // 这样自己看到的颜色和进了房间别人看到的颜色是同一次抽取的结果
    if (!color.value) {
      color.value = randomCrowdColor()
      saveColor(color.value)
    }
  } else {
    nickname.value = ''
    named.value = false
  }
})

onBeforeUnmount(() => {
  window.clearInterval(roomTimer)
})

// 进过房就记住名字与颜色（昵称带时间戳，1 小时后要重新输入）
watch([nickname, color], () => {
  if (!nickname.value.trim() || !color.value) return
  rememberIdentity(nickname.value.trim(), color.value)
})

const inRoom = computed(() => room.status === 'lobby' || room.status === 'connecting')
const canSubmit = computed(() => nickname.value.trim().length > 0 && !busy.value)

/** 没选配色就随机一个（一次抽定、写进记忆，之后自己/别人看到都是这个色） */
function ensureColor(): string {
  if (!color.value) {
    color.value = randomCrowdColor()
    saveColor(color.value)
  }
  return color.value
}

/** 「随机」按钮：当场换一个随机配色 */
function pickRandomColor(): void {
  color.value = randomCrowdColor()
  saveColor(color.value)
}

/** 确认昵称：写入本地记忆（带时间戳），然后才显示模式选择 */
function confirmNickname(): void {
  const name = draft.value.trim().slice(0, 12)
  if (!name) return
  draft.value = ''
  nickname.value = name
  // 没点色板就随机一个：这是"自己看到的 = 别人看到的"的同一份颜色
  rememberIdentity(name, ensureColor())
  named.value = true
  leftMinutes.value = Math.ceil(nicknameLeftMs() / 60000)
}

/** 主动改昵称：回到空白输入框 */
function changeNickname(): void {
  draft.value = ''
  nickname.value = ''
  named.value = false
}

function pickColor(c: string): void {
  color.value = c
}

async function onCreate(): Promise<void> {
  if (!canSubmit.value) return
  busy.value = true
  await createRoom(nickname.value.trim(), ensureColor())
  busy.value = false
}

async function onJoin(target?: string): Promise<void> {
  const roomCode = (target ?? code.value).trim()
  if (!/^\d{4}$/.test(roomCode)) {
    room.error = '房间号是 4 位数字'
    return
  }
  busy.value = true
  await joinRoom(roomCode, nickname.value.trim(), ensureColor())
  busy.value = false
}

function openMulti(): void {
  panel.value = 'multi'
  room.error = ''
  void refreshRooms()
  window.clearInterval(roomTimer)
  // 面板开着就每 3 s 刷一次"已有房间"，点了直接进
  roomTimer = window.setInterval(() => void refreshRooms(), 3000)
}

function closeMulti(): void {
  panel.value = 'none'
  window.clearInterval(roomTimer)
  roomTimer = 0
}

/** 房间列表里的阶段文案：大厅 = 可进，比赛中 = 也能进（当心被甩在后面） */
function phaseLabel(phase: string): string {
  if (phase === 'lobby') return '等人中'
  if (phase === 'countdown') return '倒计时'
  if (phase === 'racing') return '比赛中'
  return '结算中'
}
</script>

<template>
  <div class="home">
    <!-- 背景：渐变天空 + 漂浮糖果块（纯 CSS，不加贴图） -->
    <div class="sky" />
    <div class="blobs">
      <span class="blob b1" />
      <span class="blob b2" />
      <span class="blob b3" />
      <span class="blob b4" />
    </div>

    <div class="content" :class="{ 'in-room': inRoom, compact: panel === 'multi' }">
      <header class="brand">
        <div class="logo">
          <span class="jelly" aria-hidden="true">
            <i class="eye" />
            <i class="eye r" />
          </span>
        </div>
        <h1>PY PARTY RUN</h1>
        <p class="sub">糖果跑酷 · 320 m · 答题闯关 · 挥手互殴</p>
      </header>

      <!-- 已经在房间里：直接进大厅 -->
      <RoomLobby v-if="inRoom" />

      <template v-else-if="!named">
        <!-- 昵称门：先输入昵称，确认后才显示单人 / 多人 -->
        <form class="gate" @submit.prevent="confirmNickname">
          <h2>先给自己起个名字</h2>
          <p class="gate-sub">昵称会显示在人物头顶，也会出现在联机榜单里</p>
          <div class="gate-form">
            <input
              v-model="draft"
              class="gate-input"
              maxlength="12"
              placeholder="输入昵称（最多 12 字）"
              autocomplete="off"
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
              required
              autofocus
            />
            <button class="primary gate-go" type="submit" :disabled="!draft.trim()">进入游戏</button>
          </div>
          <div class="gate-colors">
            <span class="gate-label">配色</span>
            <button
              v-for="c in swatches"
              :key="c"
              class="swatch"
              :class="{ on: c === color }"
              type="button"
              :style="{ background: c }"
              :aria-label="c"
              @click="pickColor(c)"
            />
            <button class="swatch random" type="button" title="随机换一个配色" @click="pickRandomColor">
              随机
            </button>
          </div>
          <p class="gate-tip">{{ color ? '' : '不选配色也行：进游戏时会随机分一个，自己看到的和联机里别人看到的是同一个' }}</p>
        </form>
      </template>

      <template v-else>
        <div class="whoami">
          <span class="whoami-dot" :style="{ background: color }" />
          <span>以「{{ nickname }}」的身份游戏</span>
          <span v-if="leftMinutes > 0" class="whoami-ttl">昵称还有 {{ leftMinutes }} 分钟有效</span>
          <button class="relink" @click="changeNickname">改昵称</button>
        </div>

        <div v-if="panel === 'none'" class="modes">
          <button class="mode solo" @click="emit('solo')">
            <span class="icon">🏁</span>
            <span class="name">单人游戏</span>
            <span class="desc">自己跑一遍，熟悉赛道与答题</span>
          </button>
          <button class="mode online" @click="openMulti">
            <span class="icon">👥</span>
            <span class="name">多人游戏</span>
            <span class="desc">局域网 2–8 人，建房或输入房间号</span>
          </button>
        </div>

        <div v-else class="multi">
          <div class="multi-head">
            <h3>多人游戏 · 局域网 2–8 人</h3>
            <button class="back" @click="closeMulti">返回</button>
          </div>

          <!-- 上半：左「创建房间」 / 右「输入房间号加入」，各占一半 -->
          <div class="multi-cols">
            <section class="col create">
              <span class="col-title">创建房间</span>
              <div class="identity">
                <span class="swatch on" :style="{ background: color }" />
                <span class="identity-name">{{ nickname }}</span>
              </div>
              <p class="col-desc">开一个空房，把房间号发给朋友；房主点开始后全场同时起跑。</p>
              <button class="primary" :disabled="!canSubmit" @click="onCreate">
                {{ busy ? '创建中…' : '创建房间' }}
              </button>
            </section>

            <section class="col join">
              <span class="col-title">输入房间号加入</span>
              <label class="field">
                <input
                  v-model="code"
                  class="code"
                  maxlength="4"
                  placeholder="4 位数字"
                  inputmode="numeric"
                  @keyup.enter="onJoin()"
                />
              </label>
              <p class="col-desc">房间正在比赛中也能加入（上限 8 人）；人满了会提示稍后再来。</p>
              <button class="primary" :disabled="!canSubmit" @click="onJoin()">
                {{ busy ? '加入中…' : '加入房间' }}
              </button>
            </section>
          </div>

          <!-- 下半：目前已有的房间，点一张卡就直接进 -->
          <section class="rooms">
            <div class="rooms-head">
              <span class="col-title">目前在线的房间</span>
              <button class="mini" @click="refreshRooms()">{{ roomList.loading ? '刷新中…' : '刷新' }}</button>
            </div>
            <p v-if="roomList.error" class="rooms-error">房间列表取不到：{{ roomList.error }}</p>
            <ul v-else-if="roomList.items.length" class="room-list">
              <li
                v-for="item in roomList.items"
                :key="item.code"
                class="room-item"
                :class="{ full: item.players >= item.capacity }"
                @click="item.players < item.capacity && onJoin(item.code)"
              >
                <span class="room-code">{{ item.code }}</span>
                <span class="room-people">{{ item.players }}/{{ item.capacity }} 人</span>
                <span class="room-phase" :class="item.phase">{{ phaseLabel(item.phase) }}</span>
                <span class="room-join">{{ item.players >= item.capacity ? '已满' : '加入 →' }}</span>
              </li>
            </ul>
            <p v-else class="rooms-empty">
              {{ roomList.loaded ? '现在还没有房间，先创建一间吧' : '正在读取房间列表…' }}
            </p>
          </section>

          <p class="hint">
            同一局域网用本机 IP 访问本页即可联机。房间 2–8 人；答错冻结 3 秒，被人打倒会中断答题；跑道上还有巨型拳套，被打飞要从起点重跑。
          </p>
        </div>
      </template>

      <div v-if="room.error" class="error">{{ room.error }}</div>
    </div>
  </div>
</template>

<style scoped>
.home {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  color: #10304a;
}

.sky {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(120% 90% at 50% 0%, #c8f6ff 0%, #7ad4ff 45%, #ffd9f1 100%);
}

.blobs {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.blob {
  position: absolute;
  border-radius: 42% 58% 55% 45% / 48% 42% 58% 52%;
  opacity: 0.5;
  filter: blur(2px);
}

.b1 {
  width: 220px;
  height: 190px;
  left: -60px;
  top: 8%;
  background: #ff8ecb;
  animation: float 9s ease-in-out infinite;
}

.b2 {
  width: 150px;
  height: 140px;
  right: 6%;
  top: 12%;
  background: #5ff0dd;
  animation: float 11s ease-in-out infinite reverse;
}

.b3 {
  width: 260px;
  height: 220px;
  right: -80px;
  bottom: -40px;
  background: #b39bff;
  animation: float 13s ease-in-out infinite;
}

.b4 {
  width: 120px;
  height: 110px;
  left: 12%;
  bottom: 10%;
  background: #ffd84d;
  animation: float 8s ease-in-out infinite reverse;
}

@keyframes float {
  0%,
  100% {
    transform: translateY(0) rotate(0deg);
  }
  50% {
    transform: translateY(-18px) rotate(6deg);
  }
}

.content {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: safe center;
  height: 100%;
  gap: 22px;
  padding: 24px;
  /* 8 人房 + 品牌标题会超过一屏：允许滚动，别把大厅卡切掉 */
  overflow-y: auto;
}

.content.in-room {
  gap: 14px;
  padding-top: 18px;
}

/* 多人面板要一屏放下"两栏 + 房间列表"：把品牌区收起来 */
.content.compact {
  gap: 14px;
  padding-top: 16px;
}

.content.compact .logo,
.content.compact .sub {
  display: none;
}

.content.compact h1 {
  margin: 0;
  font-size: 30px;
}

/* 进房后把品牌区压缩，把空间让给房间列表与开始按钮 */
.content.in-room .logo,
.content.in-room .sub {
  display: none;
}

.content.in-room h1 {
  margin: 0;
  font-size: 26px;
  letter-spacing: 2px;
}

.content > * {
  flex: 0 0 auto;
}

.brand {
  text-align: center;
}

.logo {
  display: flex;
  justify-content: center;
}

.jelly {
  position: relative;
  display: block;
  width: 74px;
  height: 66px;
  border-radius: 50% 50% 46% 46%;
  background: linear-gradient(180deg, #46f0e6, #17c9c0);
  box-shadow: 0 10px 0 rgba(13, 154, 148, 0.35), 0 16px 28px rgba(10, 60, 80, 0.25);
  animation: hop 2.4s ease-in-out infinite;
}

.jelly::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -14px;
  width: 52px;
  height: 12px;
  transform: translateX(-50%);
  border-radius: 50%;
  background: rgba(12, 40, 60, 0.18);
  filter: blur(3px);
}

.jelly .eye {
  position: absolute;
  top: 24px;
  left: 18px;
  width: 10px;
  height: 12px;
  border-radius: 50%;
  background: #10242c;
}

.jelly .eye.r {
  left: auto;
  right: 18px;
}

@keyframes hop {
  0%,
  100% {
    transform: translateY(0) scale(1, 1);
  }
  38% {
    transform: translateY(-14px) scale(0.94, 1.06);
  }
  70% {
    transform: translateY(0) scale(1.08, 0.92);
  }
}

h1 {
  margin: 14px 0 2px;
  font-size: clamp(30px, 4.4vw, 52px);
  font-weight: 900;
  letter-spacing: 3px;
  color: #fff;
  text-shadow: 0 4px 0 #ff6ed1, 0 9px 0 #d34fae, 0 18px 30px rgba(12, 60, 90, 0.28);
}

.sub {
  margin: 10px 0 0;
  font-size: 14px;
  font-weight: 600;
  color: #0e3550;
  opacity: 0.7;
}

.modes {
  display: flex;
  gap: 18px;
}

/* 昵称门 */
.gate {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  width: min(480px, 92vw);
  padding: 26px 28px 24px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 18px 40px rgba(10, 50, 74, 0.22), inset 0 2px 0 #fff;
}

.gate h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 900;
  letter-spacing: 1px;
  color: #0e3550;
}

.gate-sub {
  margin: -6px 0 4px;
  font-size: 12.5px;
  color: #4f7286;
  text-align: center;
}

.gate-form {
  display: flex;
  gap: 10px;
  width: 100%;
}

.gate-input {
  flex: 1;
  min-width: 0;
  padding: 12px 16px;
  border: 2px solid rgba(16, 138, 134, 0.2);
  border-radius: 14px;
  background: #fff;
  color: #0e3550;
  font-size: 15px;
  font-family: inherit;
  outline: none;
}

.gate-input:focus {
  border-color: #17c9c0;
}

.gate-go {
  flex: 0 0 auto;
  margin-top: 0;
}

.gate-colors {
  display: flex;
  align-items: center;
  gap: 8px;
}

.gate-label {
  margin-right: 4px;
  font-size: 12.5px;
  font-weight: 700;
  color: #33586d;
}

/* 已确认昵称后的身份条 */
.whoami {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  font-size: 13px;
  font-weight: 700;
  color: #24485c;
}

.whoami-dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
}

.whoami-ttl {
  padding: 1px 8px;
  border-radius: 999px;
  background: rgba(23, 201, 192, 0.16);
  color: #0e7d78;
  font-size: 11.5px;
  font-weight: 700;
}

.relink {
  margin-left: 4px;
  border: none;
  background: none;
  color: #1a8f8b;
  font-size: 12.5px;
  font-weight: 700;
  text-decoration: underline;
  cursor: pointer;
}

.identity {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 12px;
  background: rgba(16, 138, 134, 0.08);
}

.identity-name {
  font-size: 14px;
  font-weight: 800;
  color: #0e3550;
}

.identity-hint {
  font-size: 11.5px;
  color: #6b8698;
}

.mode {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  width: 258px;
  padding: 20px 22px 22px;
  border: none;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 12px 30px rgba(10, 50, 74, 0.18), inset 0 2px 0 #fff;
  cursor: pointer;
  text-align: left;
  transition: transform 0.16s ease, box-shadow 0.16s ease;
}

.mode:hover {
  transform: translateY(-4px);
  box-shadow: 0 20px 38px rgba(10, 50, 74, 0.24);
}

.mode:active {
  transform: translateY(0) scale(0.98);
}

.mode .icon {
  font-size: 30px;
  line-height: 1;
}

.mode .name {
  font-size: 19px;
  font-weight: 800;
  color: #0e3550;
}

.mode .desc {
  font-size: 12.5px;
  line-height: 1.5;
  color: #3f6479;
}

.mode.solo .name {
  color: #0e8a86;
}

.mode.online .name {
  color: #b0327f;
}

.multi {
  width: min(880px, 94vw);
  padding: 18px 22px 22px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 16px 36px rgba(10, 50, 74, 0.2), inset 0 2px 0 #fff;
}

.multi-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.multi-head h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 900;
  letter-spacing: 0.5px;
  color: #0e3550;
}

/* 左建房 / 右输号：两栏等宽 */
.multi-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-top: 14px;
}

.col {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 16px 18px;
  border-radius: 18px;
  background: rgba(16, 138, 134, 0.07);
}

.col.create {
  border: 2px solid rgba(23, 201, 192, 0.28);
}

.col.join {
  border: 2px solid rgba(255, 110, 209, 0.3);
  background: rgba(255, 110, 209, 0.07);
}

.col-title {
  font-size: 13.5px;
  font-weight: 900;
  letter-spacing: 0.5px;
  color: #0e3550;
}

.col-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: #4f7286;
}

.col .field {
  margin: 0;
}

.col .field input.code {
  flex: 1;
}

.col .primary {
  margin-top: auto;
}

/* 房间列表：一条一行，点一下直接进 */
.rooms {
  margin-top: 14px;
  padding: 14px 16px 12px;
  border-radius: 18px;
  background: rgba(16, 138, 134, 0.05);
}

.rooms-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.mini {
  padding: 5px 12px;
  border: none;
  border-radius: 999px;
  background: rgba(16, 138, 134, 0.12);
  color: #0e6b70;
  font-size: 12px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
}

.room-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 208px;
  margin: 10px 0 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.room-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 14px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 3px 10px rgba(10, 50, 74, 0.08);
  font-size: 13px;
  cursor: pointer;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.room-item:hover {
  transform: translateX(2px);
  box-shadow: 0 6px 16px rgba(10, 50, 74, 0.14);
}

.room-item.full {
  cursor: not-allowed;
  opacity: 0.55;
}

.room-code {
  font-size: 18px;
  font-weight: 900;
  letter-spacing: 3px;
  color: #0e3550;
}

.room-people {
  font-weight: 700;
  color: #33586d;
}

.room-phase {
  padding: 2px 9px;
  border-radius: 999px;
  background: rgba(16, 138, 134, 0.12);
  color: #0e6b70;
  font-size: 11.5px;
  font-weight: 700;
}

.room-phase.racing,
.room-phase.countdown {
  background: rgba(255, 138, 61, 0.16);
  color: #b2541b;
}

.room-phase.results {
  background: rgba(179, 155, 255, 0.22);
  color: #5a45b0;
}

.room-join {
  margin-left: auto;
  font-weight: 800;
  color: #17a39d;
}

.rooms-empty,
.rooms-error {
  margin: 10px 0 2px;
  font-size: 12.5px;
  color: #4f7286;
}

.rooms-error {
  color: #b0324b;
}

.back {
  margin-left: auto;
  border: none;
  background: none;
  font-size: 13px;
  font-weight: 600;
  color: #6b8698;
  font-family: inherit;
  cursor: pointer;
}

@media (max-width: 720px) {
  .multi-cols {
    grid-template-columns: 1fr;
  }
}

.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 16px;
}

.field {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  font-weight: 700;
  color: #33586d;
}

.field > span {
  width: 48px;
  flex: 0 0 48px;
}

input {
  flex: 1;
  padding: 11px 14px;
  border: 2px solid rgba(16, 138, 134, 0.18);
  border-radius: 12px;
  background: #fff;
  color: #0e3550;
  font-size: 14px;
  font-family: inherit;
  outline: none;
}

input:focus {
  border-color: #17c9c0;
}

input.code {
  flex: 0 0 168px;
  font-size: 22px;
  font-weight: 800;
  letter-spacing: 6px;
  text-align: center;
}

.swatches {
  display: flex;
  gap: 8px;
}

.swatch {
  width: 26px;
  height: 26px;
  border: 3px solid transparent;
  border-radius: 50%;
  box-shadow: 0 3px 8px rgba(10, 50, 74, 0.18);
  cursor: pointer;
}

.swatch.on {
  border-color: #10304a;
  transform: scale(1.12);
}

/* 「随机」按钮：和色板同尺寸，写两个字，一眼知道是抽一个色 */
.swatch.random {
  width: auto;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.8);
  border: 2px solid rgba(16, 48, 74, 0.25);
  color: #24485c;
  font-size: 11.5px;
  font-weight: 800;
  font-family: inherit;
  line-height: 22px;
}

.swatch.random:hover {
  border-color: #10304a;
}

.gate-tip {
  max-width: 420px;
  margin: 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: #5b7d90;
  text-align: center;
}

.primary {
  margin-top: 4px;
  padding: 14px 26px;
  border: none;
  border-radius: 999px;
  background: linear-gradient(180deg, #46f0e6, #17c9c0);
  color: #04343a;
  font-size: 16px;
  font-weight: 800;
  font-family: inherit;
  cursor: pointer;
  box-shadow: 0 6px 0 #0d9a94, 0 12px 22px rgba(8, 40, 50, 0.24);
}

.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
}

.primary:active:not(:disabled) {
  transform: translateY(3px);
  box-shadow: 0 3px 0 #0d9a94;
}

.hint {
  margin: 2px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: #4f7286;
}

.error {
  padding: 10px 18px;
  border-radius: 12px;
  background: rgba(200, 40, 70, 0.9);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
}
</style>
