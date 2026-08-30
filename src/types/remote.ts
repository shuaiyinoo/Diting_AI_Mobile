/**
 * 远程控制协议定义
 *
 * 分两条通道，职责严格分开：
 *   - 信令（STOMP）：SDP / ICE / 房间生命周期 / 显示器拓扑
 *   - 控制（WebRTC DataChannel）：鼠标键盘指令，高频、低延迟
 */

/* ══════════════════════════════════════════════════════════════
   一、信令消息

   通道规则（与后端 org.dromara.stomp 严格对应）：
     发送：两端都发到 /app/signal
     订阅：受控端 /topic/session/desktop/{sessionCode}
           控制端 /topic/session/mobile/{sessionCode}
   ══════════════════════════════════════════════════════════════ */

/**
 * 对端角色，与后端 org.dromara.stomp.enums.StompRole 保持一致。
 * desktop = 受控端（Electron Agent），mobile = 控制端（Capacitor App）。
 */
export type PeerRole = 'desktop' | 'mobile'

/**
 * 分发式 Omit
 * 直接用 Omit<Union, K> 会把联合类型拍平成单个对象类型，丢掉每个分支的独有字段。
 * 这里必须让 Omit 对每个成员分别生效。
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** 发送信令时的载荷：sessionCode 由 SignalingClient 自动补齐 */
export type SignalPayload = DistributiveOmit<SignalMessage, 'sessionCode'>

export type SignalMessage =
  | { type: 'join'; role: PeerRole; sessionCode: string }
  | { type: 'offer'; sessionCode: string; sdp: RTCSessionDescriptionInit; restart?: boolean }
  | { type: 'answer'; sessionCode: string; sdp: RTCSessionDescriptionInit }
  | { type: 'candidate'; sessionCode: string; candidate: RTCIceCandidateInit | null }
  | { type: 'leave'; sessionCode: string }
  /** Agent 上报显示器拓扑，控制端据此做坐标映射 */
  | { type: 'displays'; sessionCode: string; displays: DisplayInfo[] }
  /** Agent 通知控制端会话结束（如用户在受控端点了断开） */
  | { type: 'terminated'; sessionCode: string; reason?: string }

/* ══════════════════════════════════════════════════════════════
   二、控制指令（走 DataChannel）
   字段名刻意用缩写：指令每秒可达数十条，省一点是一点
   ══════════════════════════════════════════════════════════════ */

/** 鼠标按键：同 DOM 的 MouseEvent.button */
export const MouseButton = {
  Left: 0,
  Middle: 1,
  Right: 2,
} as const
export type MouseButtonValue = (typeof MouseButton)[keyof typeof MouseButton]

export type ControlCommand =
  /** 鼠标移动：u/v 是相对目标显示器的归一化坐标 [0,1]，不用像素！ */
  | { t: 'mm'; u: number; v: number }
  /** 鼠标按下 */
  | { t: 'md'; b: MouseButtonValue }
  /** 鼠标抬起 */
  | { t: 'mu'; b: MouseButtonValue }
  /** 滚轮：dy 纵向行数（正=向下），dx 横向行数（正=向右，可选，支持触控板二维滚动） */
  | { t: 'mw'; dy: number; dx?: number }
  /** 按键按下：k 为键名，m 为修饰键 */
  | { t: 'kd'; k: string; m?: string[] }
  /** 按键抬起 */
  | { t: 'ku'; k: string; m?: string[] }
  /** 直接输入一整串文本（比逐字符 keyTap 快得多） */
  | { t: 'ty'; s: string }
  /** 切换目标显示器（多屏场景） */
  | { t: 'sw'; d: number }
  /** 切换画质：low / medium / high，运行时调参，不重新协商 */
  | { t: 'q'; q: 'low' | 'medium' | 'high' }
  /** 切换分辨率：480p / 720p / 1080p / native，编码端降采样，不重新协商 */
  | { t: 'rs'; r: '480p' | '720p' | '1080p' | 'native' }
  /** 剪贴板同步 */
  | { t: 'cb'; s: string }

/* ══════════════════════════════════════════════════════════════
   三、显示器拓扑
   ══════════════════════════════════════════════════════════════ */

export interface DisplayInfo {
  /** Electron 的 Display.id */
  id: number
  /**
   * 显示器在虚拟桌面中的原点。
   * ⚠️ 副屏位于主屏左侧时 x 为负 —— 忽略这一点会导致点击偏移，
   * 这是远程控制最常见的 bug。
   */
  x: number
  y: number
  /** 逻辑像素宽高。注意：不是物理像素，不要乘 scaleFactor */
  width: number
  height: number
  /** DPI 缩放（Retina=2，Windows 150%=1.5）。仅用于显示，不参与坐标换算 */
  scaleFactor: number
  primary: boolean
}

/* ══════════════════════════════════════════════════════════════
   四、连接状态
   ══════════════════════════════════════════════════════════════ */

/**
 * idle        未开始
 * signaling   已连 STOMP，正在交换 SDP
 * connecting  SDP 交换完成，ICE 打洞中
 * live        已连通
 * recovering  正在 ICE Restart（L2，通常 1-3s）
 * rebuilding  正在全量重建（L3，通常 3-8s）
 * dead        多次重试失败，需用户手动重连
 */
export type SessionState =
  | 'idle'
  | 'signaling'
  | 'connecting'
  | 'live'
  | 'recovering'
  | 'rebuilding'
  | 'dead'
