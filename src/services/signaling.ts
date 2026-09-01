import { Client, type IMessage, type StompSubscription } from '@stomp/stompjs'
import { inflate } from 'pako'
import type { PeerRole, SignalMessage, SignalPayload } from '@/types/remote'
import type { SyncAction, SyncMessage, SyncResultMessage, SyncMessageItem, StreamSyncMessage, StreamSyncRequest, FileSyncData, FileContentResult } from '@/types/sync'

/**
 * STOMP 信令客户端（全局单例）
 *
 * 一条 STOMP 连接承载两类通信：
 *   1. 远程控制信令（WebRTC SDP/ICE/生命周期）—— 按 sessionCode 隔离
 *   2. 数据同步（Chat/Agent 列表拉取）—— 按 userId 路由
 *
 * 连接生命周期：
 *   - 登录成功后立即建立常驻连接（不依赖远程会话）
 *   - 进入远程会话时，在已有连接上【追加订阅】信令 topic
 *   - 退出远程会话时，取消信令订阅，但【连接本身不断】
 *   - sync 订阅随连接一直保持
 *
 * 职责边界（重要）：
 *   ✅ 信令：SDP / ICE / 房间生命周期 / 显示器拓扑
 *   ✅ sync：Chat/Agent 数据拉取请求/响应
 *   ❌ 不传屏幕画面（走 MediaStream）
 *   ❌ 不传控制指令（走 DataChannel）
 */
export class SignalingClient {
  private client: Client | null = null
  /** 信令订阅（远程会话期间存在） */
  private signalSubscription: StompSubscription | null = null
  /** sync 响应订阅（随连接常驻） */
  private syncSubscription: StompSubscription | null = null
  /** stream-sync 推送订阅（随连接常驻） */
  private streamSubscription: StompSubscription | null = null
  private sessionCode = ''
  private userId: number | null = null
  /**
   * 本端角色，决定订阅哪个 topic。
   * 与后端约定：
   *   /topic/session/desktop/{code} ← 受控端订阅
   *   /topic/session/mobile/{code}  ← 控制端订阅
   */
  private readonly role: PeerRole

  /** sync 请求的 pending 回调映射 */
  private syncPending = new Map<string, { resolve: (data: string) => void; reject: (err: Error) => void; timer: number }>()

  /** 外部注入的消息处理器 */
  onMessage: ((msg: SignalMessage) => void) | null = null
  onConnected: (() => void) | null = null
  onDisconnected: (() => void) | null = null
  /** sync 连接状态回调 */
  onSyncConnected: (() => void) | null = null
  onSyncDisconnected: (() => void) | null = null
  /** stream-sync 消息回调（Desktop 推来的流式数据） */
  onStreamMessage: ((msg: StreamSyncMessage) => void) | null = null

  /** @param role 本端角色，决定订阅哪个 topic；控制端为 mobile */
  constructor(role: PeerRole = 'mobile') {
    this.role = role
  }

  get connected(): boolean {
    return this.client?.connected ?? false
  }

  /* ══════════════════ 连接管理 ══════════════════ */

  /**
   * 建立 STOMP 连接（登录后调用，常驻不断开）。
   *
   * 连接成功后自动订阅 sync 响应 topic。
   * 远程会话的信令订阅通过 `subscribeSignal` 单独控制。
   *
   * @param token  JWT
   * @param userId 当前用户 ID，用于拼 sync topic
   */
  connect(token: string, userId: number): Promise<void> {
    this.userId = userId

    return new Promise((resolve, reject) => {
      // 已连接则不重复建
      if (this.client?.connected) {
        resolve()
        return
      }

      this.client = new Client({
        brokerURL: import.meta.env.VITE_STOMP_URL,
        connectHeaders: {
          Authorization: `Bearer ${token}`,
          clientid: 'mobile',
        },
        heartbeatIncoming: 10_000,
        heartbeatOutgoing: 10_000,
        reconnectDelay: 3_000,

        onConnect: () => {
          // 订阅 sync 响应 topic（常驻）
          this.subscribeSync()
          // 订阅 stream-sync 推送 topic（常驻）
          this.subscribeStreamSync()
          this.onConnected?.()
          this.onSyncConnected?.()
          resolve()
        },

        onStompError: (frame) => {
          console.error('[signaling] STOMP error:', frame.headers['message'])
          reject(new Error(frame.headers['message'] ?? 'STOMP error'))
        },

        onWebSocketClose: () => {
          this.onDisconnected?.()
          this.onSyncDisconnected?.()
          console.warn('[signaling] websocket closed')
        },
      })

      this.client.activate()
    })
  }

  /* ══════════════════ 信令订阅（远程会话期间） ══════════════════ */

  /**
   * 在已有连接上追加订阅信令 topic。
   *
   * ⚠️ 必须在 `connect` 成功后调用。
   * 如果已有信令订阅先取消，再重新订阅新的 sessionCode。
   */
  subscribeSignal(sessionCode: string): void {
    this.sessionCode = sessionCode
    // 先取消旧订阅
    this.signalSubscription?.unsubscribe()
    this.signalSubscription = null

    if (!this.client?.connected || !sessionCode) return

    this.signalSubscription = this.client.subscribe(
      `/topic/session/${this.role}/${sessionCode}`,
      (msg: IMessage) => this.handleSignalMessage(msg),
    )
  }

  /** 取消信令订阅（退出远程会话时调用，不断开连接） */
  unsubscribeSignal(): void {
    this.signalSubscription?.unsubscribe()
    this.signalSubscription = null
    this.sessionCode = ''
  }

  private handleSignalMessage(msg: IMessage) {
    try {
      const data = JSON.parse(msg.body) as SignalMessage
      this.onMessage?.(data)
    } catch (e) {
      console.error('[signaling] 解析信令消息失败:', e)
    }
  }

  /** 发送信令（远程控制用） */
  publish(payload: SignalPayload) {
    if (!this.client?.connected) {
      console.warn('[signaling] 未连接，丢弃信令:', payload)
      return
    }
    this.client.publish({
      destination: '/app/signal',
      body: JSON.stringify({ ...payload, sessionCode: this.sessionCode }),
    })
  }

  /* ══════════════════ sync 数据同步 ══════════════════ */

  /** 订阅 sync 响应 topic（随连接常驻，重连后自动重新订阅） */
  private subscribeSync(): void {
    if (!this.client?.connected || !this.userId) return
    this.syncSubscription?.unsubscribe()
    const topic = `/topic/sync/mobile/${this.userId}`
    this.syncSubscription = this.client.subscribe(
      topic,
      (msg: IMessage) => this.handleSyncResult(msg),
    )
    console.log(`[signaling] 已订阅 sync 响应: ${topic}`)
  }

  /**
   * 发送 sync 请求并等待 Desktop 回传结果。
   *
   * @param action  同步动作
   * @param timeout 超时毫秒，默认 15s
   * @param sessionId 会话 ID（syncChatMessages / syncAgentMessages 使用）
   * @returns Desktop 回传的业务数据 JSON 字符串
   */
  syncRequest(action: SyncAction, timeout = 15_000, sessionId?: string): Promise<string> {
    if (!this.client?.connected) {
      return Promise.reject(new Error('STOMP 未连接'))
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const msg: SyncMessage = { requestId, action }
    if (sessionId) msg.sessionId = sessionId

    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.syncPending.delete(requestId)
        reject(new Error(`sync 请求超时 (${timeout}ms): ${action}`))
      }, timeout)

      this.syncPending.set(requestId, { resolve, reject, timer })

      this.client!.publish({
        destination: '/app/sync',
        body: JSON.stringify(msg),
      })

      console.log(`[sync] 发送请求 requestId=${requestId} action=${action} sessionId=${sessionId ?? '-'}`)
    })
  }

  /** 便捷方法：拉取 Chat 会话列表 */
  async fetchChatSessions() {
    const raw = await this.syncRequest('syncChatSessions')
    return JSON.parse(raw) as { id: number; title: string; lastMessageAt: string | null }[]
  }

  /** 便捷方法：拉取 Agent 项目+会话列表 */
  async fetchAgentData() {
    const raw = await this.syncRequest('syncAgentData')
    return JSON.parse(raw) as {
      workspaces: { id: string; name: string; slug: string }[]
      sessions: { id: string; title: string; workspaceId: string; updatedAt: number }[]
    }
  }

  /** 便捷方法：拉取 Chat 会话消息历史 */
  async fetchChatMessages(sessionId: number) {
    const raw = await this.syncRequest('syncChatMessages', 15_000, sessionId.toString())
    const result = JSON.parse(raw) as { sessionId: number; messages: SyncMessageItem[] }
    return result.messages
  }

  /** 便捷方法：拉取 Agent 会话消息历史 */
  async fetchAgentMessages(sessionId: string) {
    const raw = await this.syncRequest('syncAgentMessages', 15_000, sessionId)
    const result = JSON.parse(raw) as SyncMessageItem[]
    return result
  }

  /** 便捷方法：拉取文件数据（文件夹列表 + 每个文件夹的树形结构） */
  async fetchFileData() {
    const raw = await this.syncRequest('syncFileData', 15_000)
    return JSON.parse(raw) as FileSyncData
  }

  /** 便捷方法：拉取文件内容（文本文件预览）
   *
   * sessionId 参数为 fileItemId 的字符串形式
   */
  async fetchFileContent(fileItemId: number) {
    const raw = await this.syncRequest('syncFileContent', 15_000, fileItemId.toString())
    return JSON.parse(raw) as FileContentResult
  }

  /** 处理 Desktop 回传的 sync 结果 */
  private handleSyncResult(msg: IMessage) {
    try {
      const result = JSON.parse(msg.body) as SyncResultMessage
      const entry = this.syncPending.get(result.requestId)
      if (!entry) {
        console.warn(`[sync] 收到未匹配的结果 requestId=${result.requestId}`)
        return
      }

      clearTimeout(entry.timer)
      this.syncPending.delete(result.requestId)

      if (result.error) {
        entry.reject(new Error(result.error))
      } else if (result.compressed) {
        // Desktop 端对大数据做了 zlib deflate + Base64 压缩
        // 解压流程：Base64 解码 → pako.inflate → UTF-8 解码
        try {
          const b64 = result.data
          // atob → Uint8Array
          const binary = atob(b64)
          const bytes = new Uint8Array(binary.length)
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i)
          }
          // inflate 解压
          const decompressed = inflate(bytes)
          // UTF-8 解码
          const jsonStr = new TextDecoder('utf-8').decode(decompressed)
          entry.resolve(jsonStr)
        } catch (decompressErr) {
          console.error('[sync] 解压失败:', decompressErr)
          entry.reject(new Error('数据解压失败'))
        }
      } else {
        // 未压缩，直接返回明文 JSON
        entry.resolve(result.data)
      }
    } catch (e) {
      console.error('[sync] 解析结果失败:', e)
    }
  }

  /* ══════════════════ stream-sync 流式同步 ══════════════════ */

  /** 订阅 stream-sync 推送 topic（随连接常驻，重连后自动重新订阅） */
  private subscribeStreamSync(): void {
    if (!this.client?.connected || !this.userId) return
    this.streamSubscription?.unsubscribe()
    const topic = `/topic/stream/mobile/${this.userId}`
    this.streamSubscription = this.client.subscribe(
      topic,
      (msg: IMessage) => this.handleStreamMessage(msg),
    )
    console.log(`[signaling] 已订阅 stream-sync 推送: ${topic}`)
  }

  /** 处理 Desktop 推来的流式同步消息 */
  private handleStreamMessage(msg: IMessage) {
    try {
      const data = JSON.parse(msg.body) as StreamSyncMessage
      this.onStreamMessage?.(data)
    } catch (e) {
      console.error('[signaling] 解析流式同步消息失败:', e)
    }
  }

  /**
   * 请求 Desktop 代发消息（Mobile 不直接调用 LLM，通过 Desktop 走 SSE）。
   *
   * Desktop 执行后通过 stream-sync 推送流式结果回来。
   * 本方法不等待响应——stream_token 推送会自动到来。
   */
  sendStreamRequest(req: Omit<StreamSyncRequest, 'userId'>): void {
    if (!this.client?.connected) {
      console.warn('[signaling] 未连接，丢弃代发请求')
      return
    }
    this.client.publish({
      destination: '/app/stream-sync-request',
      body: JSON.stringify(req),
    })
    console.log(`[stream-sync] 发送代发请求 requestId=${req.requestId} sessionType=${req.sessionType} sessionId=${req.sessionId}`)
  }

  /* ══════════════════ 断开 ══════════════════ */

  /**
   * 断开 STOMP 连接（退出登录时调用）。
   *
   * 远程会话退出时不要调这个 —— 只调 `unsubscribeSignal` 即可。
   */
  async disconnect() {
    this.signalSubscription?.unsubscribe()
    this.signalSubscription = null
    this.syncSubscription?.unsubscribe()
    this.syncSubscription = null
    this.streamSubscription?.unsubscribe()
    this.streamSubscription = null
    // 清理所有 sync pending
    for (const [, entry] of this.syncPending) {
      clearTimeout(entry.timer)
      entry.reject(new Error('STOMP 已断开'))
    }
    this.syncPending.clear()
    this.sessionCode = ''

    if (this.client) {
      await this.client.deactivate()
      this.client = null
    }
  }
}
