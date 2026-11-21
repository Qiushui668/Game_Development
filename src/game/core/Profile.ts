/**
 * 玩家身份（昵称 / 配色）的本地记忆。
 * 放在 game/core 是因为 Game 需要拿到昵称画头顶名牌，而 Game 不该 import 网络层。
 */

const NICKNAME_KEY = 'ppr:nickname'
const COLOR_KEY = 'ppr:color'

/** 首页昵称门记住的名字；每人一份，不区分单人/多人 */
export function saveNickname(nickname: string): void {
  try {
    window.localStorage.setItem(NICKNAME_KEY, nickname)
  } catch {
    /* 隐私模式下忽略 */
  }
}

export function recallNickname(): string {
  try {
    return window.localStorage.getItem(NICKNAME_KEY) ?? ''
  } catch {
    return ''
  }
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
  const parsed = Number.parseInt(hex.replace('#', ''), 16)
  return Number.isFinite(parsed) ? parsed : fallback
}
