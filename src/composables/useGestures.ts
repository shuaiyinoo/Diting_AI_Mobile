import { onBeforeUnmount, watch, type Ref } from 'vue'

export interface GestureCallbacks {
  /** 单击（左键） */
  onTap?: (u: number, v: number) => void
  /** 长按（右键） */
  onLongPress?: (u: number, v: number) => void
  /** 拖动：开始 / 移动 / 结束 */
  onDragStart?: (u: number, v: number) => void
  onDragMove?: (u: number, v: number) => void
  onDragEnd?: (u: number, v: number) => void
  /** 双指平移 → 滚轮，dx/dy 为手指位移像素（受控端换算成比例滚动） */
  onWheel?: (dx: number, dy: number) => void
  /** 双指轻点（快速落下又抬起、几乎不移动）→ 右键 */
  onTwoFingerTap?: (u: number, v: number) => void
  /** 双指捏合 → 仅本地画面缩放，不改变桌面分辨率 */
  onPinch?: (scale: number) => void
}

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

const LONG_PRESS_MS = 500
/** 超过这个位移就判定为拖动而非点击 */
const TAP_SLOP_PX = 10
/** 双指轻点（两根手指快速落下又抬起、几乎不移动）→ 右键 */
const TWO_FINGER_TAP_MS = 250

/**
 * 触控手势 → 归一化坐标
 *
 * 核心：永远不直接传像素给受控端。
 * 手机上看到的画面被 letterbox（黑边）和本地缩放影响过，
 * 必须先换算成相对【视频有效显示区】的比例 (0~1)，
 * 受控端再按 display.x + u × width 还原成桌面坐标。
 */
export function useGestures(
  elRef: Ref<HTMLElement | null>,
  videoRef: Ref<HTMLVideoElement | null>,
  cb: GestureCallbacks,
  opts?: {
    /**
     * 旋转全屏模式（CSS rotate(90deg)）下为 true。
     * 此时视频元素的本地盒与视觉包围盒宽高互换，
     * 有效显示区计算需要先在本地坐标系做 object-contain，
     * 再旋转映射回视觉坐标。
     */
    isRotated?: () => boolean
  },
) {
  let startX = 0
  let startY = 0
  let startU = 0
  let startV = 0
  let startTime = 0
  let longPressTimer: number | undefined
  let isDragging = false
  let isLongPressed = false
  let pointers = 0
  // 双指手势状态
  let pinchStartDist = 0
  let pinchBaseScale = 1
  // 双指中心点（当前帧），用于计算滚动 delta 与轻点定位
  let twoFingerLastX = 0
  let twoFingerLastY = 0
  // 双指轻点（=右键）判定：是否发生明显移动 / 捏合
  let twoFingerMoved = false
  let twoFingerTapStart = 0
  let twoFingerTapMid = { u: 0, v: 0 }
  // 本地画面缩放（仅影响呈现，不改变桌面分辨率）
  let scale = 1

  /**
   * 计算视频【有效显示区】（去掉 letterbox 黑边）
   *
   * 直接基于 video 元素自身的 getBoundingClientRect，
   * 这样无论外部怎么布局、怎么放大，坐标都自动正确。
   */
  function getVideoRect(): Rect {
    const video = videoRef.value
    if (!video) return { left: 0, top: 0, width: 0, height: 0 }

    const vb = video.getBoundingClientRect()
    const vw = video.videoWidth
    const vh = video.videoHeight
    // 流还没来时拿不到真实分辨率，退化为整个元素盒子
    if (!vw || !vh) return { left: vb.left, top: vb.top, width: vb.width, height: vb.height }

    const videoAspect = vw / vh

    // 旋转 90° 模式：本地盒宽高 = 视觉包围盒宽高互换（vb.width 是本地高度，vb.height 是本地宽度）
    if (opts?.isRotated?.()) {
      const lw = vb.height // 本地宽
      const lh = vb.width // 本地高
      const boxAspect = lw / lh
      let cw: number
      let ch: number
      if (videoAspect > boxAspect) {
        // 画面更宽 → 本地上下黑边
        cw = lw
        ch = lw / videoAspect
      } else {
        // 画面更高 → 本地左右黑边
        ch = lh
        cw = lh * videoAspect
      }
      const cl = (lw - cw) / 2
      const ct = (lh - ch) / 2
      // 本地 (x, y) → 视觉 (lh - y, x)：内容矩形旋转后的视觉位置
      return {
        left: vb.left + (lh - ct - ch),
        top: vb.top + cl,
        width: ch,
        height: cw,
      }
    }

    let width: number
    let height: number
    if (videoAspect > vb.width / vb.height) {
      // 画面更宽 → 上下黑边
      width = vb.width
      height = vb.width / videoAspect
    } else {
      // 画面更高 → 左右黑边
      height = vb.height
      width = vb.height * videoAspect
    }

    return {
      left: vb.left + (vb.width - width) / 2,
      top: vb.top + (vb.height - height) / 2,
      width,
      height,
    }
  }

  /** 屏幕坐标 → 归一化坐标 [0,1] */
  function toNormalized(clientX: number, clientY: number): { u: number; v: number } {
    const rect = getVideoRect()
    const u = (clientX - rect.left) / (rect.width || 1)
    const v = (clientY - rect.top) / (rect.height || 1)
    return { u: clamp01(u), v: clamp01(v) }
  }

  function clamp01(n: number) {
    return Math.min(1, Math.max(0, n))
  }

  function dist(t1: Touch, t2: Touch) {
    return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY)
  }

  /* ────────────────── 事件处理 ────────────────── */
  function onTouchStart(e: TouchEvent) {
    pointers = e.touches.length
    const t = e.touches[0]
    if (!t) return

    if (pointers === 1) {
      startX = t.clientX
      startY = t.clientY
      startTime = Date.now()
      isDragging = false
      isLongPressed = false

      const p = toNormalized(t.clientX, t.clientY)
      startU = p.u
      startV = p.v

      longPressTimer = window.setTimeout(() => {
        if (!isDragging) {
          isLongPressed = true
          cb.onLongPress?.(startU, startV)
        }
      }, LONG_PRESS_MS)
    } else if (pointers === 2) {
      // 进入双指模式，取消单击/长按判定
      clearTimeout(longPressTimer)
      isDragging = false
      const [t1, t2] = [e.touches[0]!, e.touches[1]!]
      pinchStartDist = dist(t1, t2)
      pinchBaseScale = scale
      twoFingerLastX = (t1.clientX + t2.clientX) / 2
      twoFingerLastY = (t1.clientY + t2.clientY) / 2
      twoFingerMoved = false
      twoFingerTapStart = Date.now()
      twoFingerTapMid = toNormalized(twoFingerLastX, twoFingerLastY)
    }
  }

  function onTouchMove(e: TouchEvent) {
    if (e.touches.length === 1) {
      const t = e.touches[0]!

      if (!isDragging) {
        const moved = Math.hypot(t.clientX - startX, t.clientY - startY)
        if (moved > TAP_SLOP_PX) {
          clearTimeout(longPressTimer)
          isDragging = true
          cb.onDragStart?.(startU, startV)
        }
      }

      if (isDragging) {
        const p = toNormalized(t.clientX, t.clientY)
        cb.onDragMove?.(p.u, p.v)
      }
    } else if (e.touches.length === 2) {
      const [t1, t2] = [e.touches[0]!, e.touches[1]!]
      const cx = (t1.clientX + t2.clientX) / 2
      const cy = (t1.clientY + t2.clientY) / 2

      // 捏合 → 本地缩放（明显变化才算「移动」，避免轻点被误判）
      const d = dist(t1, t2)
      if (pinchStartDist > 0) {
        const newScale = clampScale(pinchBaseScale * (d / pinchStartDist))
        if (Math.abs(newScale - scale) > 0.02) {
          scale = newScale
          cb.onPinch?.(scale)
          twoFingerMoved = true
        }
      }

      // 双指平移 → 滚轮（连续像素 delta，受控端累加成比例滚动；支持横/纵）
      const dx = cx - twoFingerLastX
      const dy = cy - twoFingerLastY
      twoFingerLastX = cx
      twoFingerLastY = cy
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        twoFingerMoved = true
        cb.onWheel?.(dx, dy)
      }
    }
  }

  function clampScale(s: number) {
    return Math.min(4, Math.max(1, s))
  }

  function onTouchEnd(e: TouchEvent) {
    clearTimeout(longPressTimer)

    if (e.changedTouches.length > 0 && pointers === 1) {
      const t = e.changedTouches[0]!
      const p = toNormalized(t.clientX, t.clientY)
      const moved = Math.hypot(t.clientX - startX, t.clientY - startY)
      const elapsed = Date.now() - startTime

      if (isDragging) {
        cb.onDragEnd?.(p.u, p.v)
      } else if (!isLongPressed && moved <= TAP_SLOP_PX && elapsed < LONG_PRESS_MS) {
        cb.onTap?.(p.u, p.v)
      }
    } else if (pointers === 2) {
      // 双指抬起：若几乎没移动、且够快 → 双指轻点 = 右键
      const allUp = e.touches.length === 0 || e.changedTouches.length >= 2
      if (allUp) {
        const elapsed = Date.now() - twoFingerTapStart
        if (!twoFingerMoved && elapsed < TWO_FINGER_TAP_MS) {
          cb.onTwoFingerTap?.(twoFingerTapMid.u, twoFingerTapMid.v)
        }
      }
    }

    if (e.touches.length === 0) {
      pointers = 0
      isDragging = false
      isLongPressed = false
      pinchStartDist = 0
    }
  }

  function onContextMenu(e: Event) {
    e.preventDefault() // 屏蔽系统长按菜单，否则会打断长按手势
  }

  function attach(el: HTMLElement | null) {
    if (!el) return
    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchEnd)
    el.addEventListener('contextmenu', onContextMenu)
  }

  function detach(el: HTMLElement | null) {
    if (!el) return
    el.removeEventListener('touchstart', onTouchStart)
    el.removeEventListener('touchmove', onTouchMove)
    el.removeEventListener('touchend', onTouchEnd)
    el.removeEventListener('touchcancel', onTouchEnd)
    el.removeEventListener('contextmenu', onContextMenu)
  }

  // 使用 watch 自动追踪 ref 变化，在 v-if/v-else 切换时重新绑定监听器
  let currentEl: HTMLElement | null = null
  const stopWatch = watch(elRef, (newEl, oldEl) => {
    if (oldEl && oldEl !== newEl) detach(oldEl)
    if (newEl && newEl !== oldEl) attach(newEl)
    currentEl = newEl
  }, { immediate: true })

  onBeforeUnmount(() => {
    stopWatch()
    detach(currentEl)
    clearTimeout(longPressTimer)
  })

  return {
    /** 供 UI 显示当前缩放倍数 */
    getScale: () => scale,
    /** 双击工具栏"适应屏幕"时重置 */
    resetScale: () => {
      scale = 1
      cb.onPinch?.(1)
    },
  }
}
