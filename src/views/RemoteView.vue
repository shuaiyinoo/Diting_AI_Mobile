<script setup lang="ts">
import {
  ArrowLeft,
  ChevronDown,
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
} from '@lucide/vue'
import { ScreenOrientation } from '@capacitor/screen-orientation'
import { computed, nextTick, onBeforeUnmount, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { hapticLight, hapticMedium, useImmersiveMode, isNative } from '@/composables/useCapacitor'
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
    /** 全屏状态（内嵌模式由父组件控制，配合 fullscreen-change 事件形成受控组件） */
    fullscreen?: boolean
  }>(),
  { code: undefined, embedded: false, fullscreen: false },
)

const emit = defineEmits<{ collapse: []; exit: []; 'fullscreen-change': [active: boolean] }>()

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
  connectionType,
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

/** ICE 连接类型 → 中文标签 + 颜色 */
const connTypeLabel = computed(() => {
  switch (connectionType.value) {
    case 'relay': return '中继'
    case 'srflx': return 'P2P'
    case 'host': return '局域'
    default: return ''
  }
})
const connTypeColor = computed(() => {
  switch (connectionType.value) {
    case 'relay': return 'text-amber-950'    // 中继=橙色背景，深色文字
    case 'srflx': return 'text-green-950'    // P2P=绿色背景，深色文字
    case 'host': return 'text-sky-950'       // 局域=蓝色背景，深色文字
    default: return 'text-white/50'
  }
})

const stageRef = ref<HTMLElement | null>(null)
const scale = ref(1)
const keyboardOpen = ref(false)
/** 隐藏/显示所有界面图标（顶栏 + 底栏）；隐藏后手势仍可操作桌面 */
const uiHidden = ref(false)
function toggleUI() {
  uiHidden.value = !uiHidden.value
  hapticLight()
}

/* ────────────────────────────────────────────────────────────
   响应式布局检测
   ──────────────────────────────────────────────────────────── */
/** 视口最小宽度阈值，与 AppLayout 一致 */
const WIDE_MIN_WIDTH = 768
/** 是否为大屏/折叠屏展开态/平板 */
const isWide = ref(window.innerWidth >= WIDE_MIN_WIDTH)
function updateLayout() {
  // 小屏旋转全屏期间冻结断点：App 布局必须保持竖屏（顶栏/TabBar 不重排），
  // 原生已锁 portrait，这里兜底 H5 旋转不触发重排
  if (isFullscreen.value && !isWide.value) return
  isWide.value = window.innerWidth >= WIDE_MIN_WIDTH
}

/* ────────────────────────────────────────────────────────────
   全屏逻辑
   ──────────────────────────────────────────────────────────── */
/** 路由模式（独立全屏页）没有父组件监听 fullscreen-change，状态自己管理 */
const internalFullscreen = ref(false)
/** 全屏：小屏（竖屏手机）CSS 旋转 90°，大屏直接放大填充 */
const isFullscreen = computed(() => (props.embedded ? !!props.fullscreen : internalFullscreen.value))
/** 仅内嵌 + 小屏需要旋转；大屏/路由模式不需要 */
const needsRotate = computed(() => props.embedded && !isWide.value)
/** 是否处于旋转全屏状态 */
const isRotated = computed(() => isFullscreen.value && needsRotate.value)

function toggleFullscreen() {
  hapticLight()
  if (props.embedded) {
    // 内嵌模式：受控组件，交给父组件决定（父组件把全屏遮罩容器切换为 absolute inset-0）
    emit('fullscreen-change', !isFullscreen.value)
    return
  }
  // 路由模式：自己管理状态（方向锁定见下方 watch）
  internalFullscreen.value = !isFullscreen.value
}

/**
 * 全屏进入/退出的方向锁定副作用：
 * - 内嵌小屏：锁【竖屏】。这是关键 —— App 整体布局（顶栏/底部 TabBar）保持竖屏不重排，
 *   用户把手机横过来，看到的正是「状态栏 | 标题栏 | 旋转后正立的投屏 | Menu | 手势条」
 *   （状态栏在左、手势条在右），只有中间投屏区域是正立的。
 * - 路由模式：全屏时锁横屏做沉浸式远程桌面（原有行为）。
 * - 内嵌大屏：无需锁定方向，直接放大填充。
 */
watch(isFullscreen, async (fs) => {
  scale.value = 1
  if (!isNative) return
  try {
    if (!fs) {
      await ScreenOrientation.unlock()
    } else if (!props.embedded) {
      await ScreenOrientation.lock({ orientation: 'landscape' })
    } else if (needsRotate.value) {
      await ScreenOrientation.lock({ orientation: 'portrait' })
    }
  } catch {
    /* iOS / H5 环境忽略 */
  }
})

/* 旋转全屏的尺寸测量：根元素旋转 90° 后宽高互换，
   实际大小取父容器（AppLayout 的全屏遮罩区域）尺寸的互换值。
   用 ResizeObserver 跟随容器变化（窗口尺寸/旋转/折叠变化时自动重算）。 */
const rootRef = ref<HTMLElement | null>(null)
const wrapSize = ref({ w: 0, h: 0 })
let wrapRO: ResizeObserver | null = null

function stopWrapMeasure() {
  wrapRO?.disconnect()
  wrapRO = null
}

function startWrapMeasure() {
  const el = rootRef.value?.parentElement
  if (!el) return
  stopWrapMeasure()
  const read = () => {
    const r = el.getBoundingClientRect()
    wrapSize.value = { w: r.width, h: r.height }
  }
  read()
  if (typeof ResizeObserver !== 'undefined') {
    wrapRO = new ResizeObserver(read)
    wrapRO.observe(el)
  }
}

// flush:'post' —— 等父容器切到全屏遮罩样式（DOM 补丁完成）后再测量
watch(
  isRotated,
  (rot) => {
    if (rot) startWrapMeasure()
    else stopWrapMeasure()
  },
  { flush: 'post' },
)

/** 旋转全屏时根元素的定位样式：居中 + 旋转 90°，宽高取父容器互换后的尺寸 */
const rotatedStyle = computed(() =>
  isRotated.value
    ? {
        width: `${wrapSize.value.h}px`,
        height: `${wrapSize.value.w}px`,
        transform: 'translate(-50%, -50%) rotate(90deg)',
      }
    : undefined,
)

/**
 * 浮动控件统一底色：白色实底 + 边框 + 阴影。
 * 不再使用毛玻璃（backdrop-blur）—— 视频画面上白底实色辨识度最高，
 * 也顺带规避了 Android WebView 旋转上下文中 backdrop-filter 的渲染缺陷。
 */
const floatChipClass = 'border border-border bg-white text-foreground shadow-md'
/** 选中态：主题色实底 */
const chipActiveClass = 'border-primary bg-primary text-primary-foreground shadow-md'

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
  // 旋转全屏：视觉水平位移 ↔ 内容垂直滚动（方向相反），视觉垂直位移 ↔ 内容水平滚动
  const [dx, dy] = isRotated.value ? [dyPx, -dxPx] : [dxPx, dyPx]
  wheelAccum.dx += dx / SCROLL_PX_PER_NOTCH
  wheelAccum.dy += dy / SCROLL_PX_PER_NOTCH
  const now = performance.now()
  if (now - wheelLastSend < WHEEL_MIN_INTERVAL) return
  wheelLastSend = now
  const { dx: outDx, dy: outDy } = wheelAccum
  wheelAccum = { dx: 0, dy: 0 }
  if (outDx || outDy) wheel(outDy, outDx) // wheel(dy, dx?)：纵向优先，dx 为横向
}

/**
 * 旋转全屏时的坐标换算：CSS rotate(90deg)（顺时针）后，
 * 视觉归一化坐标 (a, b) 对应内容坐标 (u, v) = (b, 1 - a)。
 * useGestures 基于 video.getBoundingClientRect()（旋转后的视觉包围盒）归一化，
 * 旋转状态下直接当内容坐标用会导致落点转置/镜像，必须先换算。
 */
function contentUV(a: number, b: number): [number, number] {
  return isRotated.value ? [b, 1 - a] : [a, b]
}

useGestures(
  stageRef,
  videoRef,
  {
    onTap: (a, b) => {
      const [u, v] = contentUV(a, b)
      mouseMove(u, v)
      mouseDown(0)
      mouseUp(0)
      hapticLight()
    },
    onLongPress: (a, b) => {
      const [u, v] = contentUV(a, b)
      mouseMove(u, v)
      mouseDown(2)
      mouseUp(2)
      hapticMedium()
    },
    onDragStart: (a, b) => {
      const [u, v] = contentUV(a, b)
      mouseMove(u, v)
      mouseDown(0)
      hapticLight()
    },
    onDragMove: (a, b) => {
      const [u, v] = contentUV(a, b)
      emitDragMove(u, v)
    },
    onDragEnd: (a, b) => {
      const [u, v] = contentUV(a, b)
      mouseMove(u, v)
      mouseUp(0)
    },
    onWheel: (dx, dy) => emitWheel(dx, dy),
    onTwoFingerTap: (a, b) => {
      const [u, v] = contentUV(a, b)
      mouseMove(u, v)
      mouseDown(2)
      mouseUp(2)
      hapticMedium()
    },
    onPinch: (s) => {
      scale.value = s
    },
  },
  { isRotated: () => isRotated.value },
)

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
async function unlockOrientation() {
  try {
    await ScreenOrientation.unlock()
  } catch {
    /* 同上，忽略 */
  }
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
  // 响应式布局监听
  updateLayout()
  window.addEventListener('resize', updateLayout)
  window.addEventListener('orientationchange', updateLayout)
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
  stopWrapMeasure()
})

onUnmounted(() => {
  window.removeEventListener('resize', updateLayout)
  window.removeEventListener('orientationchange', updateLayout)
  void unlockOrientation()
})
</script>

<template>
  <!--
    全屏定位规则（配合 AppLayout 的全屏遮罩容器）：
    - 小屏旋转全屏：根元素 absolute 居中 + rotate(90deg)，宽高取父容器互换尺寸，
      只占「顶栏下方 ~ TabBar 上方」的中间区域，不遮住顶栏和底部菜单
    - 大屏/路由全屏：根元素直接 flex 填满父容器
  -->
  <div
    ref="rootRef"
    :class="[
      isFullscreen
        ? 'flex h-full w-full flex-col overflow-hidden rounded-none bg-black'
        : embedded
          ? 'relative w-full overflow-hidden rounded-lg bg-black'
          : 'flex h-full flex-col bg-black',
      isRotated && 'absolute top-1/2 left-1/2',
    ]"
    :style="rotatedStyle"
  >
    <!-- ══════════ 画面区 ══════════ -->
    <div
      :class="[
        isFullscreen
          ? 'relative min-h-0 w-full flex-1 overflow-hidden'
          : embedded
            ? 'relative w-full'
            : 'relative flex-1 overflow-hidden pt-safe',
      ]"
    >
      <div
        ref="stageRef"
        class="touch-none flex w-full items-center justify-center overflow-hidden bg-black"
        :class="!isFullscreen && embedded ? 'rounded-lg' : 'h-full'"
      >
        <video
          ref="videoRef"
          class="object-contain"
          :class="!isFullscreen && embedded ? 'block h-auto w-full' : ''"
          :style="
            isFullscreen
              ? { width: '100%', height: '100%' }
              : { width: `${scale * 100}%`, height: embedded ? 'auto' : `${scale * 100}%` }
          "
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

      <!-- 顶部工具条：左上=收起/返回+多屏切换；右上=画质/分辨率 -->
      <div
        v-show="!uiHidden"
        class="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-3"
      >
        <div class="flex flex-col items-start gap-2">
          <Button
            variant="secondary"
            size="icon-sm"
            class="pointer-events-auto z-10"
            :class="floatChipClass"
            :title="embedded ? '收起' : '返回'"
            @click="onTopLeft"
          >
            <component :is="embedded ? ChevronDown : ArrowLeft" class="size-4" />
          </Button>

          <Button
            v-if="displays.length > 1"
            variant="secondary"
            size="icon-sm"
            class="pointer-events-auto z-10 gap-0.5"
            :class="floatChipClass"
            @click="cycleDisplay"
          >
            <Monitor class="size-3.5" />
            <span class="text-[10px] font-medium tabular-nums">
              {{ (displayIndex >= 0 ? displayIndex : 0) + 1 }}/{{ displays.length }}
            </span>
          </Button>

          <!-- ICE 连接类型指示器：中继(橙) / P2P(绿) / 局域(蓝) -->
          <Button
            v-if="isConnected && connTypeLabel"
            variant="secondary"
            size="icon-sm"
            class="pointer-events-auto z-10"
            :class="floatChipClass"
            :style="{
              backgroundColor: connectionType === 'relay' ? 'rgb(251 191 36)' : connectionType === 'srflx' ? 'rgb(74 222 128)' : connectionType === 'host' ? 'rgb(56 189 248)' : '',
            }"
          >
            <span class="text-[10px] font-medium" :class="connTypeColor">{{ connTypeLabel }}</span>
          </Button>
        </div>

        <div class="flex flex-col items-end gap-2">
          <div class="flex items-center gap-2">
            <div
              v-if="isConnected"
              class="pointer-events-auto z-10 flex items-center gap-0.5 rounded-md p-0.5"
              :class="floatChipClass"
            >
              <button
                v-for="opt in QUALITY_OPTIONS"
                :key="opt.value"
                type="button"
                class="rounded px-2 py-1 text-[11px] font-medium transition-colors"
                :class="quality === opt.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'"
                @click="setQuality(opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>

            <div
              v-if="isConnected"
              class="pointer-events-auto z-10 flex items-center gap-0.5 rounded-md p-0.5"
              :class="floatChipClass"
            >
              <button
                v-for="opt in RESOLUTION_OPTIONS"
                :key="opt.value"
                type="button"
                class="rounded px-1.5 py-1 text-[11px] font-medium tabular-nums transition-colors"
                :class="resolution === opt.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'"
                @click="setResolution(opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧居中：显示 / 隐藏所有界面图标（始终可见，确保隐藏后可切回）；隐藏激活时为主题色 -->
      <Button
        variant="secondary"
        size="icon-sm"
        class="pointer-events-auto z-10 absolute right-2 top-1/2 -translate-y-1/2"
        :class="uiHidden ? chipActiveClass : floatChipClass"
        @click="toggleUI"
      >
        <component :is="uiHidden ? Eye : EyeOff" class="size-4" />
      </Button>
    </div>

    <!-- ══════════ 底部工具条 ══════════ -->
    <div
      v-show="!uiHidden"
      class="flex items-center border-t border-white/10 bg-black"
      :class="!embedded ? 'px-4 pb-safe pt-3' : isFullscreen ? 'px-2' : 'rounded-b-lg'"
    >
      <div class="flex min-h-[52px] flex-1 items-center justify-around gap-3">
        <Button variant="ghost" size="sm" class="text-white/70" @click="toggleFullscreen">
          <component :is="isFullscreen ? Minimize2 : Maximize2" class="size-4" />
          全屏
        </Button>

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
