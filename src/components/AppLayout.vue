<script setup lang="ts">
import { computed, markRaw, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppTabBar, { type TabItem } from '@/components/AppTabBar.vue'
import RemoteView from '@/views/RemoteView.vue'
import { KeyRound, MonitorPlay, ChevronDown, ChevronUp } from '@lucide/vue'
import { api, type DeviceInfo } from '@/services/api'
import { requestWake } from '@/services/wake'
import { useAppStore } from '@/stores/app'
import { Bot, MessageSquare, Settings } from '@lucide/vue'
import ChatView from '@/views/ChatView.vue'
import AgentView from '@/views/AgentView.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'
import ChatInputBar from '@/components/ChatInputBar.vue'

const router = useRouter()
const app = useAppStore()

/* ─────────── 响应式布局 ─────────── */
/**
 * 用「视口最小宽度」判断大屏还是竖屏手机。
 * 宽度 >= WIDE_MIN_WIDTH 视为大屏/折叠屏展开态/平板 → 菜单放左侧竖排；
 * 否则视为竖屏手机 → 菜单放底部横排。
 */
const WIDE_MIN_WIDTH = 768
const isWide = ref(window.innerWidth >= WIDE_MIN_WIDTH)

function updateLayout() {
  // 小屏旋转全屏期间冻结断点：App 布局必须保持竖屏（顶栏/底部 TabBar 不重排）
  if (remoteFullscreen.value && !isWide.value) return
  isWide.value = window.innerWidth >= WIDE_MIN_WIDTH
}
onMounted(() => {
  updateLayout()
  window.addEventListener('resize', updateLayout)
  window.addEventListener('orientationchange', updateLayout)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', updateLayout)
  window.removeEventListener('orientationchange', updateLayout)
})

/* ─────────── Tab 菜单 ─────────── */
const tabs = ref<TabItem[]>([
  { key: 'chat', label: 'Chat', icon: markRaw(MessageSquare) },
  { key: 'agent', label: 'Agent', icon: markRaw(Bot) },
  { key: 'settings', label: '设置', icon: markRaw(Settings) },
])
const validTabs = new Set(['chat', 'agent', 'settings'])
const activeTab = ref<string>('chat')

/** 内容区避让固定菜单 */
const contentPaddingClass = computed(() => (isWide.value ? 'pl-tab' : 'pb-tab'))
/** 仅 Chat / Agent 页显示远程连接按钮，设置页不显示 */
const showRemoteBar = computed(() => activeTab.value === 'chat' || activeTab.value === 'agent')

watch(activeTab, (key) => {
  router.replace({ query: { ...router.currentRoute.value.query, tab: key } })
  // 设置页无侧边栏
  if (key === 'settings') sidebarDrawerOpen.value = false
})

function initFromRoute() {
  const tab = router.currentRoute.value.query.tab as string | undefined
  if (tab && validTabs.has(tab)) activeTab.value = tab
}
initFromRoute()

/* ─────────── 远程投屏（Chat / Agent 内嵌上半部分，共用同一连接） ─────────── */
const remoteCode = ref<string | null>(null)
const remoteLoading = ref(false)
const remoteError = ref('')
const remoteDrawerOpen = ref(true)
const showRemoteScreen = computed(
  () => showRemoteBar.value && !!remoteCode.value && remoteDrawerOpen.value,
)

async function connectRemote() {
  if (remoteLoading.value) return
  remoteLoading.value = true
  remoteError.value = ''
  try {
    const devices = await api.listDevices()
    const online = devices.find((d: DeviceInfo) => d.online)
    if (!online) {
      remoteError.value = '当前没有可连接的在线设备'
      return
    }
    const code = await requestWake(online.id, app.token)
    await app.pushHistory({ code, deviceName: online.name, connectedAt: Date.now() })
    remoteCode.value = code
    remoteDrawerOpen.value = true
  } catch (e) {
    remoteError.value = e instanceof Error ? e.message : '连接失败'
  } finally {
    remoteLoading.value = false
  }
}

function closeRemote() {
  remoteCode.value = null
  remoteDrawerOpen.value = false
  remoteError.value = ''
  remoteFullscreen.value = false
}

/* ─────────── 横屏全屏状态：RemoteView 通知父容器切换全屏遮罩 ─────────── */
const remoteFullscreen = ref(false)

function onRemoteFullscreenChange(active: boolean) {
  remoteFullscreen.value = active
}

// 投屏隐藏（切到设置页 / 收起抽屉 / 断开）时退出全屏，恢复方向解锁
watch(showRemoteScreen, (v) => {
  if (!v) remoteFullscreen.value = false
})

/* ─────────── 侧边栏宽度统一管理（Chat/Agent/远程抽屉/输入栏全部基于此偏移） ─────────── */
const SIDEBAR_MIN = 250
const SIDEBAR_MAX = 500
const sidebarWidth = ref(300)
const sidebarDragging = ref(false)
/** 大屏侧边栏展开/收起状态（Chat/Agent 共用） */
const sidebarDrawerOpen = ref(true)
/** 侧边栏收起时占 50px，展开时占 sidebarWidth；小屏时为 0（不偏移） */
const sidebarOffset = computed(() => {
  if (!isWide.value) return 0
  return sidebarDrawerOpen.value ? sidebarWidth.value : 50
})

watch(isWide, (wide) => {
  sidebarDrawerOpen.value = wide
})

function onSidebarDragStart(e: PointerEvent) {
  sidebarDragging.value = true
  e.preventDefault()
  const startX = e.clientX
  const startW = sidebarWidth.value
  function onMove(ev: PointerEvent) {
    ev.preventDefault()
    const dx = ev.clientX - startX
    sidebarWidth.value = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + dx))
  }
  function onUp() {
    sidebarDragging.value = false
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  window.addEventListener('pointermove', onMove, { passive: false })
  window.addEventListener('pointerup', onUp)
}

function toggleSidebar() {
  sidebarDrawerOpen.value = !sidebarDrawerOpen.value
}

/* ─────────── 底部聊天输入栏（Chat / Agent 共用） ─────────── */
const chatInput = ref('')
const currentSession = ref<{ sessionType: 'chat' | 'agent'; sessionId: string } | null>(null)
const isStreaming = computed(() => {
  if (!currentSession.value) return false
  const status = app.getSessionStatus(currentSession.value.sessionType, currentSession.value.sessionId)
  return status?.isStreaming ?? false
})

function onSessionSelect(info: { sessionType: 'chat' | 'agent'; sessionId: string }) {
  currentSession.value = info
}

function onSend(text: string) {
  if (!currentSession.value || isStreaming.value) return
  if (!app.signaling?.connected) return
  const req = {
    requestId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    sessionType: currentSession.value.sessionType,
    sessionId: currentSession.value.sessionId,
    message: text,
  }
  app.signaling.sendStreamRequest(req)
  console.log(`[app] 发送代发请求 sessionType=${req.sessionType} sessionId=${req.sessionId}`)
}
</script>

<template>
  <!-- 菜单已 fixed 钉在底部/左侧，此处仅渲染内容区，靠 padding 避让 -->
  <div class="flex h-full flex-col overflow-hidden bg-background text-foreground" :class="contentPaddingClass">
    <!-- 顶栏：与底部菜单同款风格的横条，显示标题 + 副标题，右侧远程连接图标按钮 -->
    <!-- 顶部安全区：优先用 Capacitor 注入的 --safe-area-inset-top，iOS 回落到 env()，再加 16px 呼吸空间 -->
    <header class="flex items-center justify-between border-b border-border bg-background/95 px-5 pb-3 pt-[calc(var(--safe-area-inset-top,env(safe-area-inset-top,0px))+16px)] backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">Diting Mobile</h1>
        <p class="mt-0.5 text-xs text-muted-foreground">
          {{ activeTab === 'chat' ? '智能对话' : activeTab === 'agent' ? '智能体' : '设置' }}
        </p>
      </div>

      <!-- 仅 Chat / Agent 页：右侧两个正方形图标按钮 -->
      <div v-if="showRemoteBar" class="flex items-center gap-2">
        <!-- 输入会话码连接 -->
        <button
          type="button"
          class="flex size-10 items-center justify-center rounded-lg border border-border bg-card text-foreground transition-colors active:bg-accent"
          title="输入会话码连接"
          @click="router.push('/connect')"
        >
          <KeyRound class="size-5" />
        </button>

        <!-- 一键投屏（自动连接当前设备） -->
        <button
          type="button"
          class="flex size-10 items-center justify-center rounded-lg border border-border bg-card text-foreground transition-colors active:bg-accent disabled:opacity-60"
          :disabled="remoteLoading"
          :title="remoteLoading ? '连接中…' : '远程连接'"
          @click="connectRemote"
        >
          <MonitorPlay class="size-5" />
        </button>
      </div>
    </header>

    <!-- 可切换内容区（远程抽屉为绝对定位浮层，不影响此区域高度） -->
    <main class="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <span v-if="remoteError" class="block px-5 pt-3 text-xs text-destructive">{{ remoteError }}</span>

      <!-- 大屏模式：远程收起条 + 投屏抽屉使用绝对定位浮层，不挤压下方 Chat/Agent 布局 -->
      <!-- 远程连接收起条：大屏时绝对定位偏移侧边栏宽度，小屏时占据垂直流 -->
      <button
        v-if="showRemoteBar && remoteCode"
        type="button"
        class="flex w-full items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5 text-left transition-[margin] active:bg-accent"
        :class="isWide ? 'absolute z-30' : 'shrink-0'"
        :style="isWide ? { marginLeft: sidebarOffset + 'px', width: `calc(100% - ${sidebarOffset}px)` } : {}"
        @click="remoteDrawerOpen = !remoteDrawerOpen"
      >
        <span class="flex items-center gap-2">
          <span class="size-2 shrink-0 rounded-full bg-green-500" />
          <span class="truncate text-sm font-medium">远程屏幕<span class="text-muted-foreground">（已连接）</span></span>
        </span>
        <component
          :is="remoteDrawerOpen ? ChevronUp : ChevronDown"
          class="size-4 shrink-0 text-muted-foreground"
        />
      </button>

      <!-- 远程投屏抽屉：大屏时绝对定位浮层（不挤压下方内容），小屏时占据垂直流 -->
      <!--
        全屏时（小屏旋转 / 大屏放大）：容器切换为 absolute inset-0 全屏遮罩，
        正好 = 「顶栏下方 ~ 底部 TabBar 上方」的中间区域。
        RemoteView 在这个容器内旋转 90°（小屏）或直接填满（大屏），
        顶栏与 TabBar 始终可见，App 布局保持竖屏不重排。
      -->
      <div
        v-if="remoteCode"
        v-show="showRemoteScreen"
        :class="remoteFullscreen
          ? ['absolute inset-0 z-40 bg-black', isWide && 'pb-safe']
          : isWide
            ? 'absolute z-30 border-b border-border bg-background shadow-lg'
            : 'shrink-0 w-full border-b border-border bg-background shadow-lg'"
        :style="!remoteFullscreen && isWide
          ? { marginLeft: sidebarOffset + 'px', width: `calc(100% - ${sidebarOffset}px)`, top: '41px' }
          : {}"
      >
        <RemoteView
          embedded
          :fullscreen="remoteFullscreen"
          :code="remoteCode"
          @collapse="remoteDrawerOpen = false"
          @exit="closeRemote"
          @fullscreen-change="onRemoteFullscreenChange"
        />
      </div>

      <!-- 三个视图同时挂载，用 v-show 切换以保留各自的滚动位置和组件状态 -->
      <div v-show="activeTab === 'chat'" class="min-h-0 flex-1 overflow-hidden">
        <ChatView :is-wide="isWide" :sidebar-width="sidebarWidth" :sidebar-open="sidebarDrawerOpen" @select="onSessionSelect" @toggle-sidebar="toggleSidebar" />
      </div>
      <div v-show="activeTab === 'agent'" class="min-h-0 flex-1 overflow-hidden">
        <AgentView :is-wide="isWide" :sidebar-width="sidebarWidth" :sidebar-open="sidebarDrawerOpen" @select="onSessionSelect" @toggle-sidebar="toggleSidebar" />
      </div>
      <div v-show="activeTab === 'settings'" class="min-h-0 flex-1 overflow-hidden">
        <SettingsPanel />
      </div>

      <!-- Chat / Agent 底部输入栏：大屏时偏移左侧侧边栏，仅占据右侧对话区宽度 -->
      <div
        v-if="showRemoteBar"
        class="shrink-0"
        :style="isWide ? { marginLeft: sidebarOffset + 'px', width: `calc(100% - ${sidebarOffset}px)` } : {}"
      >
        <ChatInputBar
          v-model="chatInput"
          :placeholder="activeTab === 'chat' ? '输入消息…' : '输入指令…'"
          :disabled="isStreaming || !currentSession"
          @submit="onSend"
        />
      </div>

      <!-- 大屏拖动条：在 main 层渲染，h-full 覆盖含输入栏的完整高度 -->
      <!-- touch-action: none 防止移动端滚动手势拦截 pointermove -->
      <div
        v-if="isWide && showRemoteBar && sidebarDrawerOpen && !remoteFullscreen"
        class="absolute top-0 z-40 h-full w-2 cursor-col-resize touch-none"
        :style="{ left: `${sidebarWidth - 4}px` }"
        @pointerdown="onSidebarDragStart"
      >
        <div class="h-full w-px bg-border transition-colors" :class="sidebarDragging ? 'bg-primary' : ''" />
      </div>
    </main>

    <!-- fixed 钉在全局底部/左侧的菜单 -->
    <AppTabBar
      v-model="activeTab"
      :tabs="tabs"
      :orientation="isWide ? 'left' : 'bottom'"
    />
  </div>
</template>
