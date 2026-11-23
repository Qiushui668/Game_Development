/**
 * 退出守卫：把"浏览器返回 / 侧键 / 触控板左右滑"这些会把玩家从游戏里带走的入口全部堵掉。
 *
 * 为什么要它：跑酷时要一直按鼠标（左键轻击、右键重击），笔记本触控板或带侧键的鼠标
 * 很容易误触浏览器后退 —— 后退一次就等于退出页面，联机时那个人直接掉线，
 * 别人还在跑，房间就废了。这里从三个入口一起守：
 *   1) 鼠标侧键（3/4 号键）与触控板左右滑产生的 auxclick / mouseup；
 *   2) 键盘 Alt+← / Alt+→、以及非输入控件里的 Backspace；
 *   3) 历史栈：装一个"哨兵"历史项，popstate 一律吞掉再补回来。
 *
 * 注意：这些守卫只在本地生效，不碰任何游戏逻辑；游戏自己"回到房间 / 退出房间"
 * 走的是页面内按钮，不经过浏览器历史，所以不受影响。
 */

interface ExitGuardOptions {
  /** 当前是否处在"不能退出"的场景（单机局 / 多人房 / 比赛中） */
  isBusy: () => boolean
  /** 被拦下一次返回时给用户一句提示 */
  onBlocked?: () => void
}

const GUARD_KEY = '__pprExitGuard'

export function installExitGuard(opts: ExitGuardOptions): () => void {
  // 已经装过就别重复装（HMR / 多次挂载都会走到这里）
  const w = window as unknown as Record<string, unknown>
  if (w[GUARD_KEY]) return w[GUARD_KEY] as () => void

  const isTyping = (target: EventTarget | null): boolean => {
    const el = target as HTMLElement | null
    if (!el) return false
    const tag = el.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
  }

  const block = (e: Event): void => {
    e.preventDefault()
    e.stopPropagation()
    opts.onBlocked?.()
  }

  /** 侧键 / 触控板滑动：Chromium 会用 3、4 号键触发历史前进后退 */
  const onAuxClick = (e: MouseEvent): void => {
    if (e.button === 3 || e.button === 4) block(e)
  }
  const onMouseUp = (e: MouseEvent): void => {
    if (e.button === 3 || e.button === 4) block(e)
  }
  const onPointerUp = (e: PointerEvent): void => {
    if (e.button === 3 || e.button === 4) block(e)
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (isTyping(e.target)) return
    // Alt + ← / → ：浏览器"后退 / 前进"的默认快捷键
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      block(e)
      return
    }
    // Backspace 在没有焦点输入框时是"后退"的旧快捷键
    if (e.key === 'Backspace') block(e)
    // 部分键盘把"后退"绑在 Ctrl+[ / Cmd+[
    if ((e.ctrlKey || e.metaKey) && (e.key === '[' || e.key === 'BrowserBack')) block(e)
  }

  // 历史哨兵：先把当前页变成栈里的一项，再往前压一项，
  // 任何 popstate 都说明有人想走 —— 直接补回去并吞掉。
  history.pushState({ [GUARD_KEY]: 1 }, '', location.href)
  const onPopState = (): void => {
    history.pushState({ [GUARD_KEY]: 1 }, '', location.href)
    opts.onBlocked?.()
  }

  // 真的关标签 / 刷新 / 输地址走人时给一次原生提示（刷新也会提示，属于有意为之）
  const onBeforeUnload = (e: BeforeUnloadEvent): void => {
    if (!opts.isBusy()) return
    e.preventDefault()
    e.returnValue = '正在比赛中，离开会让这一局把你落下'
  }

  window.addEventListener('auxclick', onAuxClick, true)
  window.addEventListener('mouseup', onMouseUp, true)
  window.addEventListener('pointerup', onPointerUp, true)
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('popstate', onPopState, true)
  window.addEventListener('beforeunload', onBeforeUnload)

  const uninstall = (): void => {
    window.removeEventListener('auxclick', onAuxClick, true)
    window.removeEventListener('mouseup', onMouseUp, true)
    window.removeEventListener('pointerup', onPointerUp, true)
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('popstate', onPopState, true)
    window.removeEventListener('beforeunload', onBeforeUnload)
    delete w[GUARD_KEY]
  }
  w[GUARD_KEY] = uninstall
  return uninstall
}
