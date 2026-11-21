<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { CROWD_COLORS } from '@/game/core/GameConfig'
import RoomLobby from '@/components/home/RoomLobby.vue'
import {
  createRoom,
  joinRoom,
  recallIdentity,
  rememberIdentity,
  room,
} from '@/net/roomStore'

const emit = defineEmits<{ solo: [] }>()

type Panel = 'none' | 'multi'
const panel = ref<Panel>('none')
/** 多人面板里的两种入口：建房 / 输房号 */
const tab = ref<'create' | 'join'>('create')

const nickname = ref('')
const color = ref('#ff3f8b')
const code = ref('')
const busy = ref(false)
/** 昵称门：必须先确认昵称，才露出单人 / 多人入口 */
const named = ref(false)

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`
const swatches = CROWD_COLORS.slice(0, 8).map(hex)

onMounted(() => {
  const saved = recallIdentity()
  nickname.value = saved.nickname || `玩家${Math.floor(Math.random() * 900 + 100)}`
  if (saved.color && swatches.includes(saved.color)) color.value = saved.color
})

// 进过房就记住名字与颜色，下次不用再填
watch([nickname, color], () => {
  if (nickname.value.trim()) rememberIdentity(nickname.value.trim(), color.value)
})

const inRoom = computed(() => room.status === 'lobby' || room.status === 'connecting')
const canSubmit = computed(() => nickname.value.trim().length > 0 && !busy.value)

/** 确认昵称：写入本地记忆，然后才显示模式选择 */
function confirmNickname(): void {
  const name = nickname.value.trim().slice(0, 12)
  if (!name) return
  nickname.value = name
  rememberIdentity(name, color.value)
  named.value = true
}

function pickColor(c: string): void {
  color.value = c
}

async function onCreate(): Promise<void> {
  if (!canSubmit.value) return
  busy.value = true
  await createRoom(nickname.value.trim(), color.value)
  busy.value = false
}

async function onJoin(): Promise<void> {
  if (!canSubmit.value) return
  if (!/^\d{4}$/.test(code.value.trim())) {
    room.error = '房间号是 4 位数字'
    return
  }
  busy.value = true
  await joinRoom(code.value.trim(), nickname.value.trim(), color.value)
  busy.value = false
}

function openMulti(): void {
  panel.value = 'multi'
  room.error = ''
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

    <div class="content" :class="{ 'in-room': inRoom }">
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
              v-model="nickname"
              class="gate-input"
              maxlength="12"
              placeholder="输入昵称（最多 12 字）"
              autofocus
            />
            <button class="primary gate-go" type="submit" :disabled="!nickname.trim()">进入游戏</button>
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
          </div>
        </form>
      </template>

      <template v-else>
        <div class="whoami">
          <span class="whoami-dot" :style="{ background: color }" />
          <span>以「{{ nickname }}」的身份游戏</span>
        <button class="relink" @click="named = false">改昵称</button>
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
          <div class="tabs">
            <button class="tab" :class="{ on: tab === 'create' }" @click="tab = 'create'">创建房间</button>
            <button class="tab" :class="{ on: tab === 'join' }" @click="tab = 'join'">输入房间号加入</button>
            <button class="back" @click="panel = 'none'">返回</button>
          </div>

          <div class="form">
            <div class="identity">
              <span class="swatch on" :style="{ background: color }" />
              <span class="identity-name">{{ nickname }}</span>
              <span class="identity-hint">昵称与配色已在上面确认</span>
            </div>

            <label v-if="tab === 'join'" class="field">
              <span>房间号</span>
              <input v-model="code" class="code" maxlength="4" placeholder="4 位数字" inputmode="numeric" />
            </label>

            <button v-if="tab === 'create'" class="primary" :disabled="!canSubmit" @click="onCreate">
              {{ busy ? '创建中…' : '创建房间' }}
            </button>
            <button v-else class="primary" :disabled="!canSubmit" @click="onJoin">
              {{ busy ? '加入中…' : '加入房间' }}
            </button>

            <p class="hint">
              同一局域网用本机 IP 访问本页即可联机，房主点开始后全场同时起跑。<br />
              房间 2–8 人；答错冻结 3 秒，被人打倒会中断答题。
            </p>
          </div>
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
  width: min(560px, 92vw);
  padding: 18px 22px 22px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 16px 36px rgba(10, 50, 74, 0.2), inset 0 2px 0 #fff;
}

.tabs {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tab {
  padding: 9px 16px;
  border: none;
  border-radius: 999px;
  background: rgba(16, 138, 134, 0.1);
  color: #0e6b70;
  font-size: 13.5px;
  font-weight: 700;
  cursor: pointer;
}

.tab.on {
  background: linear-gradient(180deg, #46f0e6, #17c9c0);
  color: #03363c;
  box-shadow: 0 4px 0 #0d9a94;
}

.back {
  margin-left: auto;
  border: none;
  background: none;
  font-size: 13px;
  font-weight: 600;
  color: #6b8698;
  cursor: pointer;
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
