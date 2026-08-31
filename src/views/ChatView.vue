<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { MessageSquare, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Plus, RefreshCw } from '@lucide/vue'
import { useAppStore } from '@/stores/app'
import { formatDateTime } from '@/lib/utils'
import type { ChatSessionItem } from '@/types/sync'
import MessageRenderer from '@/components/MessageRenderer.vue'

// 大屏侧边栏宽度由父组件 AppLayout 统一管理（拖动条在 AppLayout 层渲染）
// 本组件仅通过 props.sidebarWidth 接收当前宽度并应用到侧边栏样式

/**
 * Chat 会话页
 *
 * 竖屏手机：顶部一个可点击的条，展开后显示会话列表抽屉（绝对定位浮层）。
 * 折叠屏/大屏：左侧侧边栏，默认展开 200px，可收起。
 *
 * 数据来源：通过 STOMP sync 协议从 Desktop 端实时拉取，不使用 mock 数据。
 */

const props = withDefaults(
  defineProps<{
    isWide?: boolean
    /** 侧边栏宽度（由父组件 AppLayout 统一管理） */
    sidebarWidth?: number
    /** 大屏侧边栏展开/收起（由父组件 AppLayout 统一管理） */
    sidebarOpen?: boolean
  }>(),
  { isWide: false, sidebarWidth: 300, sidebarOpen: true },
)

const emit = defineEmits<{
  /** 选中了某个会话 */
  select: [info: { sessionType: 'chat' | 'agent'; sessionId: string }]
  /** 大屏侧边栏展开/收起切换请求（模板中以 kebab-case 触发） */
  'toggle-sidebar': []
}>()

const appStore = useAppStore()

// 从 store 获取真实数据
const sessions = computed<ChatSessionItem[]>(() => appStore.chatSessions)
const loading = computed(() => appStore.syncLoading)

/** 判断会话是否正在流式中 */
function isSessionStreaming(sessionId: number): boolean {
  return appStore.getSessionStatus('chat', String(sessionId))?.isStreaming ?? false
}

// 格式化时间显示
function formatTime(lastMessageAt: string | null): string {
  if (!lastMessageAt) return '—'
  try {
    const d = new Date(lastMessageAt)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60_000) return '刚刚'
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`
    if (d.toDateString() === now.toDateString()) {
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }
    return formatDateTime(d)
  } catch {
    return '—'
  }
}

// 小屏抽屉展开/收起（大屏由父组件 sidebarOpen 控制）
const drawerOpen = ref(props.isWide)

// 大屏切换时自动收起小屏抽屉
watch(() => props.isWide, (wide) => {
  if (!wide) drawerOpen.value = false
})

const selectedSession = ref<ChatSessionItem | null>(null)

const currentTitle = computed(() => selectedSession.value?.title ?? '选择会话')

/** 当前会话的消息列表 */
const currentMessages = computed(() => {
  if (!selectedSession.value) return []
  return appStore.chatMessagesBySession[selectedSession.value.id] ?? []
})

/** 消息列表滚动容器 */
const messageListRef = ref<HTMLElement | null>(null)

function toggleDrawer() {
  // 仅小屏使用：大屏侧边栏由父组件管理
  if (props.isWide) return
  drawerOpen.value = !drawerOpen.value
}

function selectSession(s: ChatSessionItem) {
  selectedSession.value = s
  // 小屏选择后收起抽屉
  if (!props.isWide) drawerOpen.value = false
  // 加载该会话的历史消息
  void appStore.loadChatMessages(s.id)
  console.log('[chat] select:', s.id)
  // 通知父组件当前选中会话
  emit('select', { sessionType: 'chat' as const, sessionId: String(s.id) })
}

/** 滚动到消息列表最底部 */
function scrollToBottom() {
  nextTick(() => {
    const el = messageListRef.value
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  })
}

/** 消息列表变化时自动滚动到底部 */
watch(currentMessages, () => {
  scrollToBottom()
}, { deep: true })

/** 加载状态结束（消息到达）后滚动到底部 */
watch(() => appStore.messagesLoading, (loading) => {
  if (!loading && currentMessages.value.length > 0) {
    scrollToBottom()
  }
})

function newSession() {
  // TODO: 通过 sync 协议通知 Desktop 创建新会话
  if (!props.isWide) drawerOpen.value = false
  console.log('[chat] new session')
}

/** 刷新会话列表 */
async function refresh() {
  await appStore.refreshChatSessions()
}

// 组件挂载时如果数据为空且有 sync 连接，主动拉取
onMounted(() => {
  if (appStore.syncConnected && sessions.value.length === 0) {
    void refresh()
  }
})

/** 会话列表加载完成后自动选中第一个会话并显示内容 */
watch(sessions, (list) => {
  if (list.length > 0 && !selectedSession.value) {
    selectSession(list[0])
  }
}, { immediate: true })
</script>

<template>
  <!-- 大屏：flex-row 左右布局；小屏：flex-col 上下布局 -->
  <div class="relative flex h-full overflow-hidden" :class="isWide ? 'flex-row' : 'flex-col'">
    <!-- ────── 大屏：左侧侧边栏 ────── -->
    <template v-if="isWide">
      <!-- 侧边栏展开态：宽度由父组件管理 -->
      <div
        v-if="sidebarOpen"
        class="flex h-full shrink-0 flex-col border-r border-border bg-card"
        :style="{ width: props.sidebarWidth + 'px' }"
      >
        <!-- 侧边栏头部 -->
        <div class="flex items-center justify-between border-b border-border px-3 py-2.5">
          <span class="flex items-center gap-2">
            <MessageSquare class="size-4 text-primary" />
            <span class="text-sm font-medium">会话列表</span>
          </span>
          <div class="flex items-center gap-1">
            <button
              type="button"
              class="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors active:bg-accent"
              title="刷新"
              @click="refresh"
            >
              <RefreshCw class="size-3.5" :class="loading ? 'animate-spin' : ''" />
            </button>
            <button
              type="button"
              class="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors active:bg-accent"
              title="收起侧边栏"
              @click="$emit('toggle-sidebar')"
            >
              <ChevronLeft class="size-4" />
            </button>
          </div>
        </div>

        <!-- 新建会话 -->
        <button
          type="button"
          class="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-primary transition-colors active:bg-accent"
          @click="newSession"
        >
          <Plus class="size-4" />
          新建会话
        </button>

        <!-- 会话列表 -->
        <div class="min-h-0 flex-1 overflow-y-auto">
          <div v-if="sessions.length === 0" class="px-4 py-8 text-center text-sm text-muted-foreground">
            {{ loading ? '正在同步…' : '暂无会话' }}
          </div>
          <div v-else class="divide-y divide-border">
            <button
              v-for="s in sessions"
              :key="s.id"
              type="button"
              class="flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors active:bg-accent"
              :class="selectedSession?.id === s.id ? 'bg-primary/5' : ''"
              @click="selectSession(s)"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="truncate text-sm font-medium" :class="isSessionStreaming(s.id) ? 'text-primary' : ''">{{ s.title }}</span>
                <span class="flex shrink-0 items-center gap-1.5">
                  <span v-if="isSessionStreaming(s.id)" class="size-2 animate-pulse rounded-full bg-green-500" />
                  <span class="text-xs text-muted-foreground">{{ formatTime(s.lastMessageAt) }}</span>
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>

      <!-- 侧边栏收起态：竖排文字 + 右侧图标 -->
      <button
        v-else
        type="button"
        class="flex h-full w-[50px] shrink-0 flex-col items-center justify-center gap-2 border-r border-border bg-muted/30 transition-colors active:bg-accent"
        title="展开会话列表"
        @click="$emit('toggle-sidebar')"
      >
        <span
          class="text-xs font-medium text-muted-foreground"
          style="writing-mode: vertical-rl; letter-spacing: 2px"
        >展开会话</span>
        <ChevronRight class="size-4 text-muted-foreground" />
      </button>
    </template>

    <!-- ────── 小屏：顶部抽屉 ────── -->
    <template v-else>
      <!-- 顶部会话选择条（仅小屏显示） -->
      <button
        v-if="!isWide"
        type="button"
        class="flex w-full items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5 text-left transition-colors active:bg-accent"
        @click="toggleDrawer"
      >
        <span class="flex items-center gap-2">
          <MessageSquare class="size-4 text-primary" />
          <span class="truncate text-sm font-medium">{{ currentTitle }}</span>
        </span>
        <component
          :is="drawerOpen ? ChevronUp : ChevronDown"
          class="size-4 shrink-0 text-muted-foreground"
        />
      </button>

      <!-- 下拉抽屉：会话列表（绝对定位浮层，不挤压对话区域） -->
      <div v-if="drawerOpen" class="absolute inset-x-0 top-[41px] z-20 max-h-[50vh] overflow-y-auto border-b border-border bg-card shadow-lg">
        <!-- 新建会话 -->
        <button
          type="button"
          class="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-primary transition-colors active:bg-accent"
          @click="newSession"
        >
          <Plus class="size-4" />
          新建会话
        </button>

        <div v-if="sessions.length === 0" class="px-4 py-8 text-center text-sm text-muted-foreground">
          暂无会话
        </div>

        <!-- 会话列表 -->
        <div v-else class="divide-y divide-border">
          <button
            v-for="s in sessions"
            :key="s.id"
            type="button"
            class="flex w-full flex-col gap-0.5 px-4 py-2.5 text-left transition-colors active:bg-accent"
            :class="selectedSession?.id === s.id ? 'bg-primary/5' : ''"
            @click="selectSession(s)"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="truncate text-sm font-medium" :class="isSessionStreaming(s.id) ? 'text-primary' : ''">{{ s.title }}</span>
              <span class="flex shrink-0 items-center gap-1.5">
                <span v-if="isSessionStreaming(s.id)" class="size-2 animate-pulse rounded-full bg-green-500" />
                <span class="text-xs text-muted-foreground">{{ formatTime(s.lastMessageAt) }}</span>
              </span>
            </div>
            <p class="truncate text-xs text-muted-foreground">{{ s.preview }}</p>
          </button>
        </div>
      </div>
    </template>

    <!-- 对话区域：高度固定，独立滚动，不受抽屉展开影响 -->
    <div ref="messageListRef" class="min-h-0 flex-1 overflow-y-auto">
      <!-- 加载中 -->
      <div v-if="appStore.messagesLoading && !currentMessages.length" class="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <div class="flex items-center gap-1.5 text-muted-foreground">
          <span class="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" :style="{ animationDelay: '0ms' }" />
          <span class="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" :style="{ animationDelay: '150ms' }" />
          <span class="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" :style="{ animationDelay: '300ms' }" />
          <span class="ml-1 text-xs">加载中...</span>
        </div>
      </div>
      <!-- 消息渲染 -->
      <MessageRenderer
        v-else
        :messages="currentMessages"
        empty-title="Chat 对话"
        empty-subtitle="选择会话后显示消息内容"
      />
    </div>
  </div>
</template>
