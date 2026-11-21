/**
 * 房间连接封装：一个 WebSocket，把 JSON 消息转成类型化事件。
 * 只做传输，不管房间状态（状态在 roomStore 里）。
 */
import type { ClientEvent, ServerEvent } from '@/types/network'

type Handler = (ev: ServerEvent) => void

export class RoomClient {
  private ws: WebSocket | null = null
  private readonly handlers = new Set<Handler>()
  /** 服务器分配的玩家 id（hello 里下发） */
  selfId = ''

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  onServer(cb: Handler): () => void {
    this.handlers.add(cb)
    return () => this.handlers.delete(cb)
  }

  /** 连接房间服务；失败时抛出可直接展示的中文原因 */
  connect(url: string, timeoutMs = 5000): Promise<void> {
    if (this.connected) return Promise.resolve()
    return new Promise((resolve, reject) => {
      let settled = false
      let socket: WebSocket
      try {
        socket = new WebSocket(url)
      } catch (err) {
        reject(new Error(`房间服务地址无效（${url}）`))
        return
      }
      this.ws = socket
      const timer = window.setTimeout(() => {
        if (settled) return
        settled = true
        try {
          socket.close()
        } catch {
          /* 忽略 */
        }
        reject(new Error('连接房间服务超时，请确认已经在跑 npm run server'))
      }, timeoutMs)

      socket.onopen = () => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        resolve()
      }
      socket.onmessage = (ev) => {
        let msg: ServerEvent
        try {
          msg = JSON.parse(String(ev.data)) as ServerEvent
        } catch {
          return
        }
        if (msg.type === 'hello') this.selfId = msg.id
        for (const h of this.handlers) h(msg)
      }
      socket.onclose = () => {
        this.ws = null
        if (!settled) {
          settled = true
          window.clearTimeout(timer)
          reject(new Error('房间服务拒绝连接，请确认服务端已启动且在同一个局域网'))
        }
      }
      socket.onerror = () => {
        /* onclose 会紧跟着来，统一在 onclose 里处理 */
      }
    })
  }

  send(ev: ClientEvent): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify(ev))
  }

  close(): void {
    if (!this.ws) return
    try {
      this.ws.close()
    } catch {
      /* 忽略 */
    }
    this.ws = null
    this.selfId = ''
  }
}
