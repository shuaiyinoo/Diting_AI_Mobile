<script setup lang="ts">
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Keyboard,
  Loader2,
  Maximize2,
  Minimize2,
  Monitor,
  MousePointer2,
  PhoneOff,
  RefreshCw,
  WifiOff,
  Minimize,
} from '@lucide/vue'
import { ScreenOrientation } from '@capacitor/screen-orientation'
import { computed, nextTick, onBeforeUnmount, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { hapticLight, hapticMedium, useImmersiveMode } from '@/composables/useCapacitor'
import { useGestures } from '@/composables/useGestures'
import { useRemoteSession } from '@/composables/useRemoteSession'
import type { SessionState } from '@/types/remote'
import { useAppStore } from '@/stores/app'

const props = withDefaults(
  defineProps<{
    /** 会话码：内嵌模式由父组件传入；全屏路由模式可不传（从 route.params 取） */
    code?: string
    /** 是否内嵌（作为 Chat / Agent 内容区的一部分，而非独立全屏页） */
    embedded?: boolean
  }>(),
  { code: undefined, embedded: false },
)

const emit = defineEmits<{ collapse: []; exit: [] }>()

const route = useRoute()
const router = useRouter()
const app = useAppStore()

const sessionCode = props.code ?? (route.params.code as string)

const {
  state,
  videoRef,
  displays,
  activeDisplayId,
  errorMessage,
  start,
  destroy,
  reconnect,
  switchDisplay,
  quality,
  setQuality,
  resolution,
  setResolution,
  mouseMove,
  mouseDown,
  mouseUp,
  wheel,
  keyDown,
  keyUp,
  typeText,
} = useRemoteSession(sessionCode)

/** 画质三档选项（低 / 中 / 高），连接上后显示在顶部工具条 */
const QUALITY_OPTIONS = [
  { value: 'low' as const, label: '低' },
  { value: 'medium' as const, label: '中' },
  { value: 'high' as const, label: '高' },
]

/** 分辨率四档选项（标清 / 高清 / 蓝光 / 原画），连接上后显示在顶部工具条 */
const RESOLUTION_OPTIONS = [
  { value: '480p' as const, label: '标清' },
  { value: '720p' as const, label: '高清' },
  { value: '1080p' as const, label: '蓝光' },
  { value: 'native' as const, label: '原画' },
]

const stageRef = ref<HTMLElement | null>(null)
const scale = ref(1)
const keyboardOpen = ref(false)
/** 隐藏/显示所有界面图标（顶栏 + 底栏）；隐藏后手势仍可操作桌面 */
const uiHidden = ref(false)
function toggleUI() {
  uiHidden.value = !uiHidden.value
  hapticLight()
}

// 全屏模式才隐藏状态栏 + 屏幕常亮；内嵌模式不干扰父页面
if (!props.embedded) useImmersiveMode()

/* ────────────────────────────────────────────────────────────
   手势 → 指令
   ──────────────────────────────────────────────────────────── */
let dragLastSend = 0
const DRAG_MIN_INTERVAL = 8 // ms，≈ 上限 125Hz
function emitDragMove(u: number, v: number) {
  const now = performance.now()
  if (now - dragLastSend < DRAG_MIN_INTERVAL) return
  dragLastSend = now
  mouseMove(u, v)
}

const SCROLL_PX_PER_NOTCH = 28
let wheelAccum = { dx: 0, dy: 0 }
let wheelLastSend = 0
const WHEEL_MIN_INTERVAL = 16 // ms
function emitWheel(dxPx: number, dyPx: number) {
  wheelAccum.dx += dxPx / SCROLL_PX_PER_NOTCH
  wheelAccum.dy += dyPx / SCROLL_PX_PER_NOTCH
  const now = performance.now()
  if (now - wheelLastSend < WHEEL_MIN_INTERVAL) return
  wheelLastSend = now
  const { dx, dy } = wheelAccum
  wheelAccum = { dx: 0, dy: 0 }
  if (dx || dy) wheel(dy, dx) // wheel(dy, dx?)：纵向优先，dx 为横向
}

useGestures(stageRef, videoRef, {
  onTap: (u, v) => {
    mouseMove(u, v)
    mouseDown(0)
    mouseUp(0)
    hapticLight()
  },
  onLongPress: (u, v) => {
    mouseMove(u, v)
    mouseDown(2)
    mouseUp(2)
    hapticMedium()
  },
  onDragStart: (u, v) => {
    mouseMove(u, v)
    mouseDown(0)
    hapticLight()
  },
  onDragMove: (u, v) => emitDragMove(u, v),
  onDragEnd: (u, v) => {
    mouseMove(u, v)
    mouseUp(0)
  },
  onWheel: (dx, dy) => emitWheel(dx, dy),
  onTwoFingerTap: (u, v) => {
    mouseMove(u, v)
    mouseDown(2)
    mouseUp(2)
    hapticMedium()
  },
  onPinch: (s) => {
    scale.value = s
  },
})

/* ────────────────────────────────────────────────────────────
   状态展示
   ──────────────────────────────────────────────────────────── */
const STATUS_TEXT: Record<SessionState, string> = {
  idle: '未连接',
  signaling: '正在连接信令服务器…',
  connecting: '正在建立 P2P 连接…',
  live: '已连接',
  recovering: '网络波动，正在快速重连…',
  rebuilding: '正在重新连接…',
  dead: '连接失败',
}

const isConnected = computed(() => state.value === 'live')
const isBusy = computed(
  () =>
    state.value === 'signaling' ||
    state.value === 'connecting' ||
    state.value === 'recovering' ||
    state.value === 'rebuilding',
)

/* ────────────────────────────────────────────────────────────
   操作
   ──────────────────────────────────────────────────────────── */
async function lockLandscape() {
  try {
    await ScreenOrientation.lock({ orientation: 'landscape' })
  } catch {
    /* 浏览器 / dev 环境无原生插件，忽略；放大本身仍生效 */
  }
}
async function unlockOrientation() {
  try {
    await ScreenOrientation.unlock()
  } catch {
    /* 同上，忽略 */
  }
}

const ZOOM_STEP = 1.6
const isZoomed = computed(() => scale.value > 1.01)
async function toggleZoom() {
  const next = isZoomed.value ? 1 : ZOOM_STEP
  scale.value = next
  hapticLight()
  // 内嵌模式不锁横屏，避免影响父页面布局
  if (props.embedded) return
  if (next > 1) await lockLandscape()
  else await unlockOrientation()
}

const displayIndex = computed(() => displays.value.findIndex((d) => d.id === activeDisplayId.value))

function cycleDisplay() {
  if (displays.value.length < 2) return
  hapticLight()
  const idx = displayIndex.value
  const next = displays.value[(idx + 1) % displays.value.length]
  if (next) switchDisplay(next.id)
}

/* ────────────────────────────────────────────────────────────
   原生键盘
   ──────────────────────────────────────────────────────────── */
const kbInputRef = ref<HTMLInputElement | null>(null)
let composing = false

async function openKeyboard() {
  keyboardOpen.value = true
  hapticLight()
  await nextTick()
  kbInputRef.value?.focus()
}
function closeKeyboard() {
  kbInputRef.value?.blur()
  keyboardOpen.value = false
}
function toggleKeyboard() {
  if (keyboardOpen.value) closeKeyboard()
  else void openKeyboard()
}
function sendKey(name: string) {
  keyDown(name)
  keyUp(name)
}
function resetKb() {
  if (kbInputRef.value) kbInputRef.value.value = ''
}

function onKbBeforeInput(e: InputEvent) {
  if (e.inputType === 'deleteContentBackward') {
    e.preventDefault()
    sendKey('Backspace')
  } else if (e.inputType === 'deleteContentForward') {
    e.preventDefault()
    sendKey('Delete')
  } else if (e.inputType === 'insertLineBreak') {
    e.preventDefault()
    sendKey('Enter')
  }
}
function onKbInput(e: Event) {
  if (composing) return
  const ie = e as InputEvent
  if (ie.inputType && ie.inputType.startsWith('delete')) return
  const data = ie.data
  if (data) typeText(data)
  resetKb()
}
function onKbCompositionStart() {
  composing = true
}
function onKbCompositionEnd(e: CompositionEvent) {
  composing = false
  if (e.data) typeText(e.data)
  resetKb()
}

function sendRightClick() {
  hapticMedium()
  mouseDown(2)
  mouseUp(2)
}

/** 左上按钮：内嵌模式 = 收起；全屏模式 = 返回/断开 */
function onTopLeft() {
  if (props.embedded) {
    emit('collapse')
    return
  }
  disconnect()
}

/** 断开：内嵌模式通知父组件移除；全屏模式回首页 */
function disconnect() {
  void unlockOrientation()
  destroy()
  if (props.embedded) emit('exit')
  else void router.replace('/')
}

onMounted(async () => {
  // 全屏路由模式：进入即连接
  if (props.embedded) return
  await app.load()
  try {
    await start(app.token)
  } catch (e) {
    console.error('[remote] 启动失败:', e)
  }
})

// 内嵌模式：父组件传入 code 后自动连接
watch(
  () => props.code,
  async (c) => {
    if (!props.embedded || !c) return
    await app.load()
    try {
      await start(app.token)
    } catch (e) {
      console.error('[remote] 启动失败:', e)
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  wheelAccum = { dx: 0, dy: 0 }
})

onUnmounted(() => {
  void unlockOrientation()
})
</script>

<template>
  <div :class="embedded ? 'relative w-full overflow-hidden rounded-lg bg-black' : 'flex h-full flex-col bg-black'">
    <!-- ══════════ 画面区 ══════════ -->
    <div :class="embedded ? 'relative w-full' : 'relative flex-1 overflow-hidden pt-safe'">
      <div
        ref="stageRef"
        class="touch-none flex w-full items-center justify-center overflow-hidden bg-black"
        :class="embedded ? 'rounded-lg' : 'h-full'"
      >
        <video
          ref="videoRef"
          class="object-contain"
          :class="embedded ? 'block h-auto w-full' : ''"
          :style="{ width: `${scale * 100}%`, height: embedded ? 'auto' : `${scale * 100}%` }"
          playsinline
          autoplay
          muted
        ></video>
      </div>

      <!-- 连接状态覆盖层 -->
      <div
        v-if="!isConnected"
        class="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80 px-8"
      >
        <Loader2 v-if="isBusy" class="size-8 animate-spin text-white/70" />
        <WifiOff v-else-if="state === 'dead'" class="size-8 text-destructive" />

        <p class="text-center text-sm text-white/80">{{ STATUS_TEXT[state] }}</p>
        <p v-if="errorMessage" class="text-center text-xs text-white/50">{{ errorMessage }}</p>

        <Button v-if="state === 'dead'" variant="outline" class="mt-2" @click="reconnect()">
          <RefreshCw class="size-4" />
          重新连接
        </Button>
      </div>

      <!-- 顶部工具条：左上=收起/返回+多屏切换；右上=画质/分辨率/缩放 -->
      <div
        v-show="!uiHidden"
        class="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3"
      >
        <div class="flex flex-col items-start gap-2">
          <Button
            variant="secondary"
            size="icon-sm"
            class="pointer-events-auto bg-black/50 backdrop-blur"
            :title="embedded ? '收起' : '返回'"
            @click="onTopLeft"
          >
            <component :is="embedded ? Minimize : ArrowLeft" class="size-4" />
          </Button>

          <Button
            v-if="displays.length > 1"
            variant="secondary"
            size="icon-sm"
            class="pointer-events-auto gap-0.5 bg-black/50 backdrop-blur"
            @click="cycleDisplay"
          >
            <Monitor class="size-3.5" />
            <span class="text-[10px] font-medium tabular-nums">
              {{ (displayIndex >= 0 ? displayIndex : 0) + 1 }}/{{ displays.length }}
            </span>
          </Button>
        </div>

        <div class="flex flex-col items-end gap-2">
          <div class="flex items-center gap-2">
            <div
              v-if="isConnected"
              class="pointer-events-auto flex items-center gap-0.5 rounded-md bg-black/50 p-0.5 backdrop-blur"
            >
              <button
                v-for="opt in QUALITY_OPTIONS"
                :key="opt.value"
                type="button"
                class="rounded px-2 py-1 text-[11px] font-medium transition-colors"
                :class="quality === opt.value ? 'bg-white text-black' : 'text-white/70'"
                @click="setQuality(opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>

            <div
              v-if="isConnected"
              class="pointer-events-auto flex items-center gap-0.5 rounded-md bg-black/50 p-0.5 backdrop-blur"
            >
              <button
                v-for="opt in RESOLUTION_OPTIONS"
                :key="opt.value"
                type="button"
                class="rounded px-1.5 py-1 text-[11px] font-medium tabular-nums transition-colors"
                :class="resolution === opt.value ? 'bg-white text-black' : 'text-white/70'"
                @click="setResolution(opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <Button
            variant="secondary"
            size="icon-sm"
            class="pointer-events-auto bg-black/50 backdrop-blur"
            @click="toggleZoom"
          >
            <component :is="isZoomed ? Minimize2 : Maximize2" class="size-4" />
          </Button>
        </div>
      </div>

      <!-- 右侧居中：显示 / 隐藏所有界面图标 -->
      <Button
        variant="secondary"
        size="icon-sm"
        class="pointer-events-auto absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 backdrop-blur"
        @click="toggleUI"
      >
        <component :is="uiHidden ? Eye : EyeOff" class="size-4" />
      </Button>
    </div>

    <!-- ══════════ 底部工具条 ══════════ -->
    <div
      v-show="!uiHidden"
      class="flex items-center border-t border-white/10 bg-black"
      :class="embedded ? 'rounded-b-lg' : 'px-4 pb-safe pt-3'"
    >
      <div class="flex min-h-[52px] flex-1 items-center justify-around gap-3">
        <Button variant="ghost" size="sm" class="text-white/70" @click="sendRightClick">
          <MousePointer2 class="size-4" />
          右键
        </Button>

        <Button variant="ghost" size="sm" class="text-white/70" @click="toggleKeyboard">
          <Keyboard class="size-4" />
          键盘
        </Button>

        <Button variant="destructive" size="sm" @click="disconnect">
          <PhoneOff class="size-4" />
          断开
        </Button>
      </div>
    </div>

    <!-- ══════════ 原生键盘 ══════════ -->
    <div
      v-show="keyboardOpen"
      class="pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 border-t border-white/10 bg-neutral-900/95 px-3 py-2"
    >
      <input
        ref="kbInputRef"
        type="text"
        inputmode="text"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        class="min-w-0 flex-1 rounded-md bg-neutral-800 px-3 py-2 text-base text-white outline-none"
        placeholder="在此输入，字符实时传到电脑"
        @beforeinput="onKbBeforeInput"
        @input="onKbInput"
        @compositionstart="onKbCompositionStart"
        @compositionend="onKbCompositionEnd"
      />
      <Button variant="secondary" size="sm" @click="closeKeyboard">完成</Button>
    </div>
  </div>
</template>
