import { Preferences } from '@capacitor/preferences'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '@/services/api'
import { http } from '@/services/api'
import { SignalingClient } from '@/services/signaling'
import type { ChatSessionItem, AgentSyncData, SyncMessageItem, StreamSyncMessage, SessionStatus, SessionType, FileSyncData, FileContentResult } from '@/types/sync'

const KEY_TOKEN = 'diting.token'
const KEY_USER = 'diting.user'
const KEY_HISTORY = 'diting.history'

export interface HistoryEntry {
  code: string
  deviceName: string
  connectedAt: number
}

/** 登录用户信息 */
export interface UserInfo {
  userId: number
  username: string
  nickname: string
  email: string
  teamId: number | null
  teamName: string | null
}

/**
 * 全局应用状态
 *
 * 持久化用 Capacitor Preferences（App 内是原生存储，H5 下自动降级到 localStorage）。
 * 登录令牌仅保存在本地，用于后续所有接口与 WebSocket 连接的鉴权。
 */
export const useAppStore = defineStore('app', () => {
  const token = ref<string | null>(null)
  const user = ref<UserInfo | null>(null)
  const history = ref<HistoryEntry[]>([])
  const loaded = ref(false)

  /** 全局 STOMP 连接实例（登录后创建，常驻不断开）
   *
   * 这条连接同时承载：
   *   - sync 数据同步（Chat/Agent 列表拉取）
   *   - 远程控制信令（WebRTC SDP/ICE，进入远程会话时追加订阅）
   */
  const signaling = ref<SignalingClient | null>(null)
  /** STOMP 连接状态 */
  const syncConnected = ref(false)
  /** Chat 会话列表（从 Desktop 同步） */
  const chatSessions = ref<ChatSessionItem[]>([])
  /** Agent 项目+会话列表（从 Desktop 同步） */
  const agentData = ref<AgentSyncData>({ workspaces: [], sessions: [] })
  /** 文件数据（从 Desktop 同步） */
  const fileData = ref<FileSyncData>({ folders: [], trees: {} })
  /** 数据加载状态 */
  const syncLoading = ref(false)

  /** Chat 消息历史缓存（按 sessionId 分组） */
  const chatMessagesBySession = ref<Record<number, SyncMessageItem[]>>({})
  /** Agent 消息历史缓存（按 sessionId 分组） */
  const agentMessagesBySession = ref<Record<string, SyncMessageItem[]>>({})
  /** 消息加载状态 */
  const messagesLoading = ref(false)

  /** 会话状态（按 sessionType:sessionId 索引），来自 Desktop 的 stream-sync 推送 */
  const sessionStatus = ref<Record<string, SessionStatus>>({})
  /** 流式助手消息 ID 映射（按 sessionType:sessionId 索引），用于接收 token 时定位消息 */
  const streamingAssistantIds = ref<Record<string, string | number>>({})

  const isLoggedIn = computed(() => !!token.value)
  const displayName = computed(() => user.value?.nickname || user.value?.username || user.value?.email || '')

  /** 建立 STOMP 连接（登录后调用，常驻） */
  async function connectSync() {
    if (!token.value || !user.value) return
    if (signaling.value?.connected) return

    const client = new SignalingClient()
    client.onConnected = () => {
      syncConnected.value = true
      console.log('[app] STOMP 已连接')
      void refreshAll()
    }
    client.onDisconnected = () => {
      syncConnected.value = false
    }
    // 注册 stream-sync 消息回调
    client.onStreamMessage = (msg) => handleStreamSync(msg)

    signaling.value = client

    try {
      await client.connect(token.value, user.value.userId)
    } catch (e) {
      console.error('[app] STOMP 连接失败:', e)
    }
  }

  /** 断开 STOMP 连接（退出登录时调用） */
  async function disconnectSync() {
    if (signaling.value) {
      await signaling.value.disconnect()
      signaling.value = null
    }
    syncConnected.value = false
    chatSessions.value = []
    agentData.value = { workspaces: [], sessions: [] }
    fileData.value = { folders: [], trees: {} }
    chatMessagesBySession.value = {}
    agentMessagesBySession.value = {}
  }

  /** 拉取 Chat 会话列表 */
  async function refreshChatSessions() {
    if (!signaling.value?.connected) return
    try {
      chatSessions.value = await signaling.value.fetchChatSessions()
      console.log(`[app] 已同步 Chat 会话: ${chatSessions.value.length} 条`)
    } catch (e) {
      console.error('[app] 同步 Chat 会话失败:', e)
    }
  }

  /** 拉取 Agent 项目+会话列表 */
  async function refreshAgentData() {
    if (!signaling.value?.connected) return
    try {
      agentData.value = await signaling.value.fetchAgentData()
      console.log(`[app] 已同步 Agent 数据: ${agentData.value.workspaces.length} 项目, ${agentData.value.sessions.length} 会话`)
    } catch (e) {
      console.error('[app] 同步 Agent 数据失败:', e)
    }
  }

  /** 拉取文件数据（文件夹列表 + 树形结构） */
  async function refreshFileData() {
    if (!signaling.value?.connected) return
    try {
      fileData.value = await signaling.value.fetchFileData()
      console.log(`[app] 已同步文件数据: ${fileData.value.folders.length} 个文件夹`)
    } catch (e) {
      console.error('[app] 同步文件数据失败:', e)
    }
  }

  /** 拉取文件内容（文本文件预览） */
  async function loadFileContent(fileItemId: number): Promise<FileContentResult | null> {
    if (!signaling.value?.connected) return null
    try {
      return await signaling.value.fetchFileContent(fileItemId)
    } catch (e) {
      console.error('[app] 同步文件内容失败:', e)
      return null
    }
  }

  /** 拉取全部数据 */
  async function refreshAll() {
    syncLoading.value = true
    try {
      await Promise.all([refreshChatSessions(), refreshAgentData(), refreshFileData()])
    } finally {
      syncLoading.value = false
    }
  }

  /** 拉取 Chat 会话消息历史 */
  async function loadChatMessages(sessionId: number) {
    if (!signaling.value?.connected) return
    // 如果该会话正在流式中，不覆盖已有消息
    const key = sessionKey('chat', String(sessionId))
    if (streamingSessions.has(key)) return
    messagesLoading.value = true
    try {
      const messages = await signaling.value.fetchChatMessages(sessionId)
      // 流式可能在请求期间开始了，再次检查
      if (!streamingSessions.has(key)) {
        chatMessagesBySession.value[sessionId] = messages
      }
      console.log(`[app] 已同步 Chat 消息: sessionId=${sessionId}, ${messages.length} 条`)
    } catch (e) {
      console.error('[app] 同步 Chat 消息失败:', e)
    } finally {
      messagesLoading.value = false
    }
  }

  /** 拉取 Agent 会话消息历史 */
  async function loadAgentMessages(sessionId: string) {
    if (!signaling.value?.connected) return
    // 如果该会话正在流式中，不覆盖已有消息
    const key = sessionKey('agent', sessionId)
    if (streamingSessions.has(key)) return
    messagesLoading.value = true
    try {
      const messages = await signaling.value.fetchAgentMessages(sessionId)
      if (!streamingSessions.has(key)) {
        agentMessagesBySession.value[sessionId] = messages
      }
      console.log(`[app] 已同步 Agent 消息: sessionId=${sessionId}, ${messages.length} 条`)
    } catch (e) {
      console.error('[app] 同步 Agent 消息失败:', e)
    } finally {
      messagesLoading.value = false
    }
  }

  /* ══════════════════ 流式同步处理 ══════════════════ */

  /** sessionType:sessionId 复合键 */
  function sessionKey(sessionType: SessionType, sessionId: string): string {
    return `${sessionType}:${sessionId}`
  }

  /** 获取指定会话的流式状态 */
  function getSessionStatus(sessionType: SessionType, sessionId: string): SessionStatus | null {
    return sessionStatus.value[sessionKey(sessionType, sessionId)] ?? null
  }

  /** 正在流式中的会话 key 集合，防止 loadChatMessages/loadAgentMessages 覆盖正在追加的消息 */
  const streamingSessions = new Set<string>()

  /** 获取或创建指定会话的消息列表（响应式安全） */
  function getOrCreateMessages(sessionType: SessionType, sessionId: string): SyncMessageItem[] {
    if (sessionType === 'chat') {
      const sid = Number(sessionId)
      if (!chatMessagesBySession.value[sid]) {
        chatMessagesBySession.value[sid] = []
      }
      return chatMessagesBySession.value[sid]
    } else {
      if (!agentMessagesBySession.value[sessionId]) {
        agentMessagesBySession.value[sessionId] = []
      }
      return agentMessagesBySession.value[sessionId]
    }
  }

  /** 处理 Desktop 推来的流式同步消息 */
  function handleStreamSync(msg: StreamSyncMessage) {
    const key = sessionKey(msg.sessionType, msg.sessionId)

    switch (msg.type) {
      case 'session_status': {
        sessionStatus.value[key] = {
          isStreaming: !!msg.payload.isStreaming,
          canSend: !!msg.payload.canSend,
        }
        if (msg.payload.isStreaming) {
          streamingSessions.add(key)
        } else {
          streamingSessions.delete(key)
        }
        break
      }

      case 'user_message': {
        if (msg.payload.message) {
          const list = getOrCreateMessages(msg.sessionType, msg.sessionId)
          list.push(msg.payload.message)
        }
        break
      }

      case 'stream_start': {
        const assistantId = msg.payload.assistantMessageId
        if (assistantId !== undefined) {
          streamingAssistantIds.value[key] = assistantId
        }
        const list = getOrCreateMessages(msg.sessionType, msg.sessionId)
        const assistantMsg: SyncMessageItem = {
          id: assistantId ?? `msg-${Date.now()}-ai`,
          role: 'assistant',
          content: '',
          pending: true,
          time: new Date(msg.timestamp).toISOString(),
          blocks: [],
          citations: [],
        }
        list.push(assistantMsg)
        break
      }

      case 'stream_token': {
        const assistantId = streamingAssistantIds.value[key]
        if (!assistantId || !msg.payload.delta) break
        const list = getOrCreateMessages(msg.sessionType, msg.sessionId)
        const assistant = list.find((m) => m.id === assistantId)
        if (assistant) {
          assistant.content += msg.payload.delta
        }
        break
      }

      case 'stream_chunk': {
        const assistantId = streamingAssistantIds.value[key]
        if (!assistantId) break
        const list = getOrCreateMessages(msg.sessionType, msg.sessionId)
        const assistant = list.find((m) => m.id === assistantId)
        if (!assistant || !assistant.blocks) break

        const event = msg.payload.event as string
        const data = msg.payload.eventData as Record<string, unknown>
        if (!event || !data) break

        applySseEventToMessage(assistant, event, data)
        break
      }

      case 'stream_end': {
        const assistantId = streamingAssistantIds.value[key]
        if (assistantId) {
          const list = getOrCreateMessages(msg.sessionType, msg.sessionId)
          const assistant = list.find((m) => m.id === assistantId)
          if (assistant) {
            assistant.pending = false
            if (msg.payload.finalContent) {
              assistant.content = msg.payload.finalContent
            }
          }
        }
        delete streamingAssistantIds.value[key]
        streamingSessions.delete(key)
        break
      }

      case 'stream_error': {
        const assistantId = streamingAssistantIds.value[key]
        if (assistantId) {
          const list = getOrCreateMessages(msg.sessionType, msg.sessionId)
          const assistant = list.find((m) => m.id === assistantId)
          if (assistant) {
            assistant.pending = false
            assistant.content = msg.payload.error || '错误'
          }
        }
        delete streamingAssistantIds.value[key]
        streamingSessions.delete(key)
        sessionStatus.value[key] = { isStreaming: false, canSend: true }
        break
      }

      case 'session_list_changed': {
        if (msg.sessionType === 'chat') {
          void refreshChatSessions()
        } else {
          void refreshAgentData()
        }
        break
      }
    }
  }

  /** 将 SSE 事件应用到消息（与 Desktop agent.js dispatchSseEvent 同构） */
  function applySseEventToMessage(msg: SyncMessageItem, event: string, data: Record<string, unknown>) {
    if (!msg.blocks) msg.blocks = []
    const blocks = msg.blocks

    switch (event) {
      case 'text':
        if (data.delta && typeof data.delta === 'string') {
          msg.content += data.delta
        }
        break

      case 'thinking':
        if (data.delta && typeof data.delta === 'string') {
          const last = blocks[blocks.length - 1]
          if (last?.type === 'thinking') {
            last.thinking = (last.thinking || '') + data.delta
          } else {
            blocks.push({ type: 'thinking', thinking: data.delta })
          }
        }
        break

      case 'thinking_start': {
        const last = blocks[blocks.length - 1]
        if (!last || last.type !== 'thinking') {
          blocks.push({ type: 'thinking', thinking: '' })
        }
        break
      }

      case 'text_start': {
        const last = blocks[blocks.length - 1]
        if (!last || last.type !== 'text') {
          blocks.push({ type: 'text', text: '' })
        }
        break
      }

      case 'tool_start':
        blocks.push({
          type: 'tool_use',
          name: (data.toolName as string) || (data.name as string) || '',
          input: data.input as Record<string, unknown>,
          done: false,
          isError: false,
          result: '',
        })
        break

      case 'tool_result': {
        const targetId = data.toolCallId as string | undefined
        let foundIdx = -1
        if (targetId) {
          for (let i = blocks.length - 1; i >= 0; i--) {
            const b = blocks[i] as any
            if (b.type === 'tool_use' && b.toolCallId === targetId) {
              foundIdx = i
              break
            }
          }
        }
        if (foundIdx === -1) {
          for (let i = blocks.length - 1; i >= 0; i--) {
            if (blocks[i].type === 'tool_use' && !blocks[i].done) {
              foundIdx = i
              break
            }
          }
        }
        if (foundIdx >= 0) {
          blocks[foundIdx].done = true
          blocks[foundIdx].result = data.result
          blocks[foundIdx].isError = !!data.isError
        }
        break
      }

      case 'rag_citations':
        if (data.citations && Array.isArray(data.citations) && data.citations.length > 0) {
          const existing = msg.citations || []
          msg.citations = [...existing, ...(data.citations as any[])]
        }
        break

      case 'complete':
        msg.pending = false
        break

      case 'error':
        msg.pending = false
        msg.content += `\n\n[错误] ${(data.message as string) || '未知错误'}`
        break

      // 其他事件（permission_request / ask_user / usage / delegation_*）
      // Mobile 端可按需处理，这里不阻塞
      default:
        break
    }
  }

  /** 启动时恢复登录态；token 同步注入 http 客户端 */
  async function load() {
    if (loaded.value) return
    const [t, u, h] = await Promise.all([
      Preferences.get({ key: KEY_TOKEN }),
      Preferences.get({ key: KEY_USER }),
      Preferences.get({ key: KEY_HISTORY }),
    ])

    token.value = t.value
    if (token.value) {
      http.setToken(token.value)
    }
    if (u.value) {
      try {
        user.value = JSON.parse(u.value) as UserInfo
      } catch {
        user.value = null
      }
    }
    if (h.value) {
      try {
        history.value = JSON.parse(h.value) as HistoryEntry[]
      } catch {
        history.value = []
      }
    }
    loaded.value = true
    // 如果已登录，自动建立 sync 连接
    if (token.value && user.value) {
      void connectSync()
    }
  }

  /**
   * 邮箱 + 密码登录
   * @returns 成功返回 { success: true }，失败返回 { success: false, message }
   */
  async function login(email: string, password: string) {
    try {
      const res = await api.login(email, password)
      if (!res?.access_token) {
        return { success: false, message: '登录失败：服务端未返回令牌' }
      }

      token.value = res.access_token
      user.value = {
        userId: res.user_id,
        username: res.username,
        nickname: res.nickname,
        email: res.email,
        teamId: res.team_id,
        teamName: res.team_name,
      }

      // 注入 http 客户端，后续请求自动带上 Authorization
      http.setToken(res.access_token)

      await Preferences.set({ key: KEY_TOKEN, value: res.access_token })
      await Preferences.set({ key: KEY_USER, value: JSON.stringify(user.value) })

      // 登录成功后建立 sync 连接
      void connectSync()

      return { success: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { success: false, message: msg }
    }
  }

  /** 退出登录：清理内存态与本地存储 */
  async function logout() {
    await disconnectSync()
    token.value = null
    user.value = null
    http.setToken(null)
    await Preferences.remove({ key: KEY_TOKEN })
    await Preferences.remove({ key: KEY_USER })
  }

  async function pushHistory(entry: HistoryEntry) {
    // 去重 + 只保留最近 10 条
    history.value = [entry, ...history.value.filter((e) => e.code !== entry.code)].slice(0, 10)
    await Preferences.set({ key: KEY_HISTORY, value: JSON.stringify(history.value) })
  }

  async function clearHistory() {
    history.value = []
    await Preferences.remove({ key: KEY_HISTORY })
  }

  return {
    token,
    user,
    history,
    loaded,
    isLoggedIn,
    displayName,
    // sync 相关
    signaling,
    syncConnected,
    chatSessions,
    agentData,
    fileData,
    syncLoading,
    chatMessagesBySession,
    agentMessagesBySession,
    messagesLoading,
    sessionStatus,
    streamingAssistantIds,
    getSessionStatus,
    connectSync,
    disconnectSync,
    refreshChatSessions,
    refreshAgentData,
    refreshFileData,
    loadFileContent,
    refreshAll,
    loadChatMessages,
    loadAgentMessages,
    // 生命周期
    load,
    login,
    logout,
    pushHistory,
    clearHistory,
  }
})
