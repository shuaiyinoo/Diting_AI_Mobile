import { Client, type IMessage } from '@stomp/stompjs'

/**
 * 生成 v4 UUID。
 * 注意：移动端 WebView（非安全上下文 / 旧版系统 WebView）可能没有 crypto.randomUUID，
 * 这里优先用原生实现，缺失时退回 crypto.getRandomValues（兼容性更好）。
 */
function uuidV4(): string {
  const c = typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID()
  }
  // 兜底：用 getRandomValues 拼一个 RFC4122 v4 UUID
  const bytes = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes)
  } else {
    // 极端兜底（理论上不会走到）：Math.random
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  )
}

/**
 * 无人值守唤醒
 *
 * 通过一条独立的 STOMP 连接完成「请求唤醒 → 拿到 6 位会话码」，
 * 全程不经过房间（此时还没有码）。拿到码后由调用方跳转到 /remote/{code} 自动连接。
 *
 * 链路：
 *   本端 ──/app/remote/wake{deviceId,requestId}──▶ 服务端 ──▶ 桌面自动开镜像
 *   桌面 ──/app/remote/wake-result{code}──▶ 服务端 ──/topic/remote/wake/{requestId}──▶ 本端
 */
export function requestWake(
  deviceId: string,
  token: string | null,
  timeoutMs = 20_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const requestId = uuidV4()
    let settled = false
    let client: Client

    const timer = setTimeout(() => settle(false, new Error('唤醒超时，请确认设备在线')), timeoutMs)

    function settle(ok: boolean, val: string | Error) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        void client.deactivate()
      } catch {
        /* 已断开，忽略 */
      }
      if (ok) resolve(val as string)
      else reject(val as Error)
    }

    client = new Client({
      brokerURL: import.meta.env.VITE_STOMP_URL,
      connectHeaders: token
        ? { Authorization: `Bearer ${token}`, clientid: 'mobile' }
        : { clientid: 'mobile' },
      heartbeatIncoming: 10_000,
      heartbeatOutgoing: 10_000,
      reconnectDelay: 3_000,
      onConnect: () => {
        // 先订阅结果通道（用 requestId 隔离本次请求），再发唤醒
        client.subscribe(`/topic/remote/wake/${requestId}`, (msg: IMessage) => {
          try {
            const data = JSON.parse(msg.body) as { code?: string; error?: string }
            if (data.error) {
              settle(false, new Error(data.error === 'DEVICE_OFFLINE' ? '设备不在线' : '唤醒失败'))
            } else if (data.code) {
              settle(true, data.code)
            }
          } catch (e) {
            console.error('[wake] 解析结果失败:', e)
          }
        })
        client.publish({
          destination: '/app/remote/wake',
          body: JSON.stringify({ deviceId, requestId }),
        })
      },
      onStompError: (frame) => {
        settle(false, new Error(frame.headers['message'] ?? 'STOMP 连接错误'))
      },
    })

    client.activate()
  })
}
