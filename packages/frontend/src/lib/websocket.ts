import { useAuthStore } from './store'

export type WikiEvent = { type: 'tree:changed' } | { type: 'file:changed'; path: string }

// A socket that drops after opening is usually a backend restart, so retry quickly.
// One that never opens was rejected during the handshake (bad, expired, or foreign
// token), so back off hard instead of hammering the server on every attempt.
const maxOpenRetryDelayMs = 8000
const maxHandshakeRetryDelayMs = 30000

export function connectWebSocket(onMessage: (event: WikiEvent) => void) {
  let socket: WebSocket | undefined
  let closed = false
  let attempts = 0

  const connect = () => {
    const token = useAuthStore.getState().token
    if (!token || closed) return
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const current = new WebSocket(`${protocol}://${location.host}/ws?token=${encodeURIComponent(token)}`)
    socket = current
    let opened = false
    current.onopen = () => {
      opened = true
      attempts = 0
    }
    current.onmessage = (message) => onMessage(JSON.parse(message.data) as WikiEvent)
    current.onclose = () => {
      if (closed || socket !== current) return
      attempts += 1
      const delay = Math.min(500 * 2 ** attempts, opened ? maxOpenRetryDelayMs : maxHandshakeRetryDelayMs)
      window.setTimeout(connect, delay)
    }
  }

  // Reconnect when the session token changes (fresh login) instead of waiting for
  // an exponential backoff that may have grown long.
  const unsubscribe = useAuthStore.subscribe((state, previous) => {
    if (state.token === previous.token) return
    attempts = 0
    const previousSocket = socket
    socket = undefined
    previousSocket?.close()
    connect()
  })

  connect()
  return () => {
    closed = true
    unsubscribe()
    socket?.close()
  }
}
