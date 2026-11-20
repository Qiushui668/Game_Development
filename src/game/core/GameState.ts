/** 比赛状态机（M4 完整实现，此处先定义合法状态集合与转换表） */
export const RACE_STATES = [
  'Menu',
  'Loading',
  'Countdown',
  'Racing',
  'Paused',
  'Respawning',
  'Finished',
  'Result',
] as const

export type RaceState = (typeof RACE_STATES)[number]

const TRANSITIONS: Record<RaceState, readonly RaceState[]> = {
  Menu: ['Loading'],
  Loading: ['Countdown'],
  Countdown: ['Racing'],
  Racing: ['Paused', 'Respawning', 'Finished'],
  Paused: ['Racing'],
  Respawning: ['Racing'],
  Finished: ['Result'],
  Result: ['Loading', 'Menu'],
}

export function canTransition(from: RaceState, to: RaceState): boolean {
  return TRANSITIONS[from].includes(to)
}

/** 状态机持有者：非法转换直接抛错，避免多个布尔拼状态 */
export class RaceStateMachine {
  private current: RaceState = 'Menu'

  get state(): RaceState {
    return this.current
  }

  set(next: RaceState): void {
    if (!canTransition(this.current, next)) {
      throw new Error(`illegal race state transition: ${this.current} -> ${next}`)
    }
    this.current = next
  }

  reset(): void {
    this.current = 'Menu'
  }
}
