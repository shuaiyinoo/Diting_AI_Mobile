/**
 * 数据同步协议类型定义
 *
 * Mobile 通过 STOMP 向 Desktop 请求本地数据（Chat 会话列表、Agent 项目+会话列表、消息历史）。
 * 协议路径：
 *   Mobile ──/app/sync──▶ 服务端 ──/topic/sync/desktop/{userId}──▶ Desktop
 *   Desktop ──/app/sync-result──▶ 服务端 ──/topic/sync/mobile/{userId}──▶ Mobile
 */

/** sync 请求动作 */
export type SyncAction = 'syncChatSessions' | 'syncAgentData' | 'syncChatMessages' | 'syncAgentMessages'

/** sync 请求消息 */
export interface SyncMessage {
  requestId: string
  action: SyncAction
  userId?: number
  /** syncChatMessages / syncAgentMessages 使用的会话 ID 参数 */
  sessionId?: string
}

/** sync 结果消息
 *
 * 当 compressed 为 true 时，data 字段为 Base64 编码的 zlib deflate 压缩数据；
 * Mobile 端收到后需先 Base64 解码再 inflate 解压，最后 JSON.parse。
 * 当 compressed 为 false 或缺省时，data 为普通 JSON 字符串（向后兼容）。
 */
export interface SyncResultMessage {
  requestId: string
  action: SyncAction
  data: string
  compressed?: boolean
  error: string | null
}

/* ══════════════════ 业务数据类型 ══════════════════ */

/** Chat 会话列表项（与 Desktop 端 assistantService.listSessions 对齐） */
export interface ChatSessionItem {
  id: number
  title: string
  lastMessageAt: string | null
  /** 最近一条消息预览（列表副标题） */
  preview?: string
}

/** Agent 项目列表项（与 Desktop 端 WorkspaceMeta 对齐） */
export interface AgentWorkspaceItem {
  id: string
  name: string
  slug: string
}

/** Agent 会话列表项（与 Desktop 端 AgentSessionMeta 对齐） */
export interface AgentSessionItem {
  id: string
  title: string
  workspaceId: string
  updatedAt: number
  /** 最近一条消息预览（列表副标题） */
  preview?: string
}

/** Agent 完整同步数据 */
export interface AgentSyncData {
  workspaces: AgentWorkspaceItem[]
  sessions: AgentSessionItem[]
}

/* ══════════════════ 消息历史类型 ══════════════════ */

/** 消息引用证据 */
export interface Citation {
  documentId?: number
  fileItemId?: number
  chunkId?: string
  fileName?: string
  snippet?: string
  score?: number
  chunkIndex?: number
  source?: string
  [key: string]: unknown
}

/** 消息块（text / thinking / tool_use） */
export interface MessageBlock {
  type: 'text' | 'thinking' | 'tool_use'
  /** type=text：正文内容 */
  text?: string
  /** type=thinking：思考过程 */
  thinking?: string
  name?: string
  input?: Record<string, unknown>
  result?: unknown
  done?: boolean
  isError?: boolean
}

/** 消息项（Chat 和 Agent 共用） */
export interface SyncMessageItem {
  id: string | number
  role: 'user' | 'assistant'
  content: string
  pending?: boolean
  time?: string
  blocks?: MessageBlock[]
  citations?: Citation[]
}

/** Chat 消息历史响应 */
export interface ChatMessagesResult {
  sessionId: number
  messages: SyncMessageItem[]
}

/* ══════════════════ 流式同步协议类型 ══════════════════ */

/**
 * 流式同步协议
 *
 * Desktop 在消息发送/流式输出的各阶段，通过 /app/stream-sync 推送给服务端，
 * 服务端检测 Mobile 是否在线后转发到 /topic/stream/mobile/{userId}。
 *
 * 协议路径：
 *   Desktop ──/app/stream-sync──▶ 服务端 ──/topic/stream/mobile/{userId}──▶ Mobile
 *   Mobile  ──/app/stream-sync-request──▶ 服务端 ──/topic/stream/desktop/{userId}──▶ Desktop
 */

/** 流式同步消息类型 */
export type StreamSyncType =
  | 'session_status'
  | 'user_message'
  | 'stream_start'
  | 'stream_token'
  | 'stream_chunk'
  | 'stream_end'
  | 'stream_error'
  | 'session_list_changed'

/** 会话类型 */
export type SessionType = 'chat' | 'agent'

/** 流式同步消息（与服务端 StreamSyncMessage.java 对齐） */
export interface StreamSyncMessage {
  type: StreamSyncType
  sessionType: SessionType
  sessionId: string
  userId?: number
  timestamp: number
  payload: StreamSyncPayload
}

/** 流式同步消息负载（按 type 不同携带不同字段） */
export interface StreamSyncPayload {
  // session_status
  isStreaming?: boolean
  canSend?: boolean

  // user_message
  message?: SyncMessageItem

  // stream_start / stream_token / stream_end / stream_error
  assistantMessageId?: string | number

  // stream_token
  delta?: string

  // stream_chunk（Agent 模式所有 SSE 事件：thinking / tool_start / tool_result 等）
  event?: string
  eventData?: unknown

  // stream_end
  finalContent?: string

  // stream_error
  error?: string

  // session_list_changed
  change?: 'created' | 'deleted' | 'renamed'
  session?: Record<string, unknown>

  [key: string]: unknown
}

/** Mobile 请求 Desktop 代发消息（与服务端 StreamSyncRequest.java 对齐） */
export interface StreamSyncRequest {
  requestId: string
  sessionType: SessionType
  sessionId: string
  message: string
  toolMode?: string
  folderId?: number
  kbScope?: string
  model?: string
  workspaceSlug?: string
  permissionMode?: string
  thinkingLevel?: string
  userId?: number
}

/** 会话状态（Mobile 端维护，按 sessionId 索引） */
export interface SessionStatus {
  /** 是否正在流式输出 */
  isStreaming: boolean
  /** 是否可以发送新消息 */
  canSend: boolean
}
