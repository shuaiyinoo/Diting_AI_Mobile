<template>
  <!-- 空状态 -->
  <div v-if="messages.length === 0" class="flex h-full flex-col items-center justify-center gap-2 text-center">
    <div class="mb-1 flex size-12 items-center justify-center rounded-2xl bg-primary/10">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="size-7 text-primary opacity-60">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    </div>
    <h2 class="text-base font-semibold text-foreground">{{ emptyTitle }}</h2>
    <p class="text-xs text-muted-foreground">{{ emptySubtitle }}</p>
  </div>

  <!-- 消息列表 -->
  <template v-else>
    <div
      v-for="(msg, index) in messages"
      :key="msg.id ?? index"
      class="px-2 py-2.5"
    >
      <!-- 头像 + 元信息行 -->
      <div class="mb-1 flex items-center gap-1.5" :class="msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'">
        <!-- 头像 -->
        <div v-if="msg.role === 'user'" class="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-4">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
        <div v-else class="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-4 text-muted-foreground">
            <path d="M12 8V4H8" />
            <rect width="16" height="12" x="4" y="8" rx="2" />
            <path d="M2 14h2" />
            <path d="M20 14h2" />
            <path d="M15 13v2" />
            <path d="M9 13v2" />
          </svg>
        </div>
        <span class="text-[10px] font-medium text-muted-foreground">{{ msg.role === 'user' ? '我' : 'AI' }}</span>
        <span v-if="msg.time" class="text-[10px] text-muted-foreground">{{ msg.time }}</span>
      </div>

      <!-- 消息内容：占满全宽，不受头像挤压；加微小缩进增强层次感 -->
      <div
        class="min-w-0 w-full"
        :class="msg.role === 'user' ? 'flex justify-end pr-2.5' : 'pl-2.5'"
      >
        <!-- 用户消息 -->
        <template v-if="msg.role === 'user'">
          <div
            class="inline-block max-w-[90%] rounded-2xl rounded-tr-sm border border-primary bg-transparent px-3 py-1.5 text-[13px] leading-relaxed text-foreground"
            v-html="renderMentionChips(msg.content)"
          />
        </template>

        <!-- 助手消息 -->
        <template v-else>
          <!-- 加载中（等待首个 token） -->
          <div v-if="msg.pending && !msg.content && (!msg.blocks || msg.blocks.length === 0)" class="flex items-center gap-1.5 py-2 text-muted-foreground">
            <span class="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" :style="{ animationDelay: '0ms' }" />
            <span class="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" :style="{ animationDelay: '150ms' }" />
            <span class="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" :style="{ animationDelay: '300ms' }" />
            <span class="ml-1 text-xs">正在思考...</span>
          </div>

          <!-- 结构化块渲染 -->
          <template v-else>
            <!-- 执行过程折叠区（仅 Agent 模式） -->
            <ProcessBlockGroup
              v-if="showProcessBlocks && msg.blocks && getProcessBlocks(msg.blocks).length > 0"
              :blocks="getProcessBlocks(msg.blocks)"
              :is-streaming="msg.pending"
              :is-message-tail="index === messages.length - 1"
            />

            <!-- 最终文本回答 -->
            <div v-if="msg.content" class="relative">
              <MarkdownRender
                mode="chat"
                :content="msg.content"
                :final="!msg.pending"
                :fade="false"
                smooth-streaming="auto"
                :render-code-blocks-as-pre="false"
                :is-dark="isDark"
                code-block-dark-theme="vitesse-dark"
                code-block-light-theme="vitesse-light"
                :themes="['vitesse-dark', 'vitesse-light']"
                custom-id="chat"
                :mermaid-props="{ isStrict: true, showCopyButton: true, showFullscreenButton: true, showZoomControls: true, enableMermaidInteractions: true, onRenderError: handleMermaidError }"
              />
              <span v-if="msg.pending" class="ml-0.5 inline-block size-[6px] translate-y-[2px] animate-pulse rounded-full bg-primary" />
            </div>

            <!-- 引用证据卡片 -->
            <CitationRail
              v-if="!msg.pending && msg.citations && msg.citations.length > 0"
              :citations="msg.citations"
              @citation-click="(cite: unknown) => $emit('citation-click', cite)"
            />
          </template>
        </template>
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
import { isDark } from '@/theme'
import MarkdownRender from 'markstream-vue'
import ProcessBlockGroup from '@/components/ProcessBlockGroup.vue'
import CitationRail from '@/components/CitationRail.vue'

/** 消息项类型 */
interface MessageBlock {
  type: 'text' | 'thinking' | 'tool_use'
  /** type=text：正文内容 */
  text?: string
  thinking?: string
  name?: string
  input?: Record<string, unknown>
  result?: unknown
  done?: boolean
  isError?: boolean
}

interface Citation {
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

interface MessageItem {
  id: string | number
  role: 'user' | 'assistant'
  content: string
  pending?: boolean
  time?: string
  blocks?: MessageBlock[]
  citations?: Citation[]
}

const props = withDefaults(defineProps<{
  /** 消息列表 */
  messages: MessageItem[]
  /** 空状态标题 */
  emptyTitle?: string
  /** 空状态副标题 */
  emptySubtitle?: string
  /** 是否显示执行过程折叠区（Agent 模式为 true，Chat 模式为 false） */
  showProcessBlocks?: boolean
}>(), {
  emptyTitle: '消息',
  emptySubtitle: '选择会话后显示消息内容',
  showProcessBlocks: false,
})

defineEmits<{
  'citation-click': [cite: unknown]
}>()

/** 过程块（thinking / tool_use），ProcessBlockGroup 的入参类型 */
type ProcessBlock = Extract<MessageBlock, { type: 'thinking' | 'tool_use' }>

/** 从 blocks 中筛选过程块（text 块不属于过程块，被类型谓词自然排除） */
function getProcessBlocks(blocks: MessageBlock[]): ProcessBlock[] {
  if (!blocks || !Array.isArray(blocks)) return []
  return blocks.filter((b): b is ProcessBlock =>
    b.type === 'thinking'
    || (b.type === 'tool_use' && b.name !== 'TaskCreate' && b.name !== 'TaskUpdate'),
  )
}

/** Mermaid 渲染错误兜底 */
function handleMermaidError(_err: unknown, code: string, container: HTMLElement) {
  const pre = document.createElement('pre')
  pre.className = 'text-xs font-mono whitespace-pre-wrap p-3 rounded-lg border border-border bg-secondary/50 text-muted-foreground overflow-x-auto'
  pre.textContent = code
  container.replaceChildren(pre)
  return true
}

/** HTML 转义 */
function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function escapeAttr(s: string) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 将引用标记渲染为 chip 样式 HTML */
function renderMentionChips(text: string) {
  if (!text) return ''
  const re = /(@file:([^\s]+))|(\/skill:([^\s]+))|(#mcp:([^\s]+))|(&session:([^\s:]+)(?:::(.+))?)|(<!--DITING_SCHEDULED_RUN-->)/g
  let result = ''
  let lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) {
      result += escapeHtml(text.slice(lastIndex, m.index))
    }
    if (m[1]) {
      const path = m[2]
      const name = path.split('/').pop() || path
      result += `<span class="mention-chip" data-prefix="@" title="${escapeAttr(path)}">${escapeHtml(name)}</span>`
    } else if (m[3]) {
      result += `<span class="skill-mention-chip" data-prefix="/">${escapeHtml(m[4])}</span>`
    } else if (m[5]) {
      result += `<span class="mcp-mention-chip" data-prefix="#">${escapeHtml(m[6])}</span>`
    } else if (m[7]) {
      const title = m[9] ? decodeURIComponent(m[9]) : m[8]
      result += `<span class="session-mention-chip" data-prefix="&">${escapeHtml(title)}</span>`
    } else if (m[10]) {
      result += `<span class="scheduled-run-chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>定时任务</span>`
    }
    lastIndex = m.index + m[0].length
  }
  if (lastIndex < text.length) {
    result += escapeHtml(text.slice(lastIndex))
  }
  return result
}
</script>
