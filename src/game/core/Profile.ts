/**
 * 玩家身份（昵称 / 配色）的本地记忆。
 * 放在 game/core 是因为 Game 需要拿到昵称画头顶名牌，而 Game 不该 import 网络层。
 *
 * 昵称带 **1 小时时效**：填一次之后 1 小时内不用重复输入（刷新页面直接沿用），
 * 过期后强制回到昵称门重新输入。
 */

import { CROWD_COLORS } from '@/game/core/GameConfig'

const NICKNAME_KEY = 'ppr:nickname'
const NICKNAME_AT_KEY = 'ppr:nicknameAt'
const COLOR_KEY = 'ppr:color'

/** 昵称有效期：1 小时（用户指定） */
export const NICKNAME_TTL_MS = 60 * 60 * 1000

/** 首页昵称门记住的名字；每人一份，不区分单人/多人 */
export function saveNickname(nickname: string): void {
  try {
    window.localStorage.setItem(NICKNAME_KEY, nickname)
    window.localStorage.setItem(NICKNAME_AT_KEY, String(Date.now()))
  } catch {
    /* 隐私模式下忽略 */
  }
}

/** 最近一次输入昵称的时刻（没有记录返回 0） */
export function recallNicknameAt(): number {
  try {
    const raw = window.localStorage.getItem(NICKNAME_AT_KEY)
    const at = raw === null ? 0 : Number(raw)
    return Number.isFinite(at) ? at : 0
  } catch {
    return 0
  }
}

/** 昵称是否还在 1 小时有效期内（决定要不要再跳昵称门） */
export function nicknameFresh(now = Date.now()): boolean {
  const name = recallNicknameRaw()
  if (!name) return false
  const at = recallNicknameAt()
  return at > 0 && now - at < NICKNAME_TTL_MS
}

/** 剩余有效期（毫秒），过期/没有返回 0；给首页提示"还有多久到期" */
export function nicknameLeftMs(now = Date.now()): number {
  if (!nicknameFresh(now)) return 0
  return Math.max(0, NICKNAME_TTL_MS - (now - recallNicknameAt()))
}

/** 不做时效判断的原始读取（内部用） */
function recallNicknameRaw(): string {
  try {
    return window.localStorage.getItem(NICKNAME_KEY) ?? ''
  } catch {
    return ''
  }
}

/**
 * 读昵称：**过了 1 小时就当没有**（返回空串，让首页回到昵称门）。
 * 注意这里不做任何默认值 —— 没有就是空，必须玩家自己输入。
 */
export function recallNickname(now = Date.now()): string {
  return nicknameFresh(now) ? recallNicknameRaw() : ''
}

export function saveColor(color: string): void {
  try {
    window.localStorage.setItem(COLOR_KEY, color)
  } catch {
    /* 隐私模式下忽略 */
  }
}

export function recallColor(): string {
  try {
    return window.localStorage.getItem(COLOR_KEY) ?? ''
  } catch {
    return ''
  }
}

/** '#ff3f8b' → 0xff3f8b；解析不了就用兜底色 */
export function parseColor(hex: string, fallback: number): number {
  const parsed = Number.parseInt((hex ?? '').replace('#', ''), 16)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** 规范成小写 '#rrggbb'；空串 / 非法值返回 ''（调用方自己决定兜底） */
export function normalizeColor(hex: string | null | undefined): string {
  if (typeof hex !== 'string') return ''
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  return m ? `#${m[1].toLowerCase()}` : ''
}

/** 从 8 色可选色板里随机一个：输入昵称时没选配色就用它 */
export function randomCrowdColor(rng: () => number = Math.random): string {
  const list = CROWD_COLORS.slice(0, 8)
  const i = Math.min(list.length - 1, Math.floor(rng() * list.length))
  return `#${list[i].toString(16).padStart(6, '0')}`
}

/**
 * 当前该用的配色：本地记住的；一个都没有就**随机一个并写回记忆**。
 * 这样"没选配色"的人也有确定的颜色，自己看到的和联机里别人看到的永远是同一个。
 */
export function recallOrPickColor(rng: () => number = Math.random): string {
  const saved = normalizeColor(recallColor())
  if (saved) return saved
  const picked = randomCrowdColor(rng)
  saveColor(picked)
  return picked
}
