import { KeepAwake } from '@capacitor-community/keep-awake'
import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'
import { StatusBar, Style } from '@capacitor/status-bar'
import { onMounted, onUnmounted } from 'vue'

/** 是否运行在原生 App 内（H5 部署时为 false） */
export const isNative = Capacitor.isNativePlatform()
/** 'ios' | 'android' | 'web' */
export const platform = Capacitor.getPlatform()

/**
 * 轻触反馈
 * 注意：H5 下无效，Capacitor 会自动降级为 no-op，无需额外判断
 */
export function hapticLight() {
  void Haptics.impact({ style: ImpactStyle.Light })
}

export function hapticMedium() {
  void Haptics.impact({ style: ImpactStyle.Medium })
}

export function hapticSuccess() {
  void Haptics.notification({ type: NotificationType.Success })
}

export function hapticError() {
  void Haptics.notification({ type: NotificationType.Error })
}

/**
 * 远程桌面页专用：
 *  - 隐藏状态栏，画面沉浸
 *  - 保持屏幕常亮（仅前台，非后台保活，完全合规）
 */
export function useImmersiveMode() {
  onMounted(async () => {
    if (!isNative) return
    try {
      await StatusBar.hide()
      await StatusBar.setStyle({ style: Style.Dark })
      await KeepAwake.keepAwake()
    } catch (e) {
      console.warn('[capacitor] 沉浸模式设置失败:', e)
    }
  })

  onUnmounted(async () => {
    if (!isNative) return
    try {
      await StatusBar.show()
      await KeepAwake.allowSleep()
    } catch (e) {
      console.warn('[capacitor] 恢复状态栏失败:', e)
    }
  })
}

/**
 * Android 系统栏样式设置（仅 Android 生效）
 *
 * ⚠️ 关于安全区避让：这里【不做】任何避让处理，避让完全交给 CSS。
 *
 * 根因：
 * - Android WebView 不向 CSS 注入 env(safe-area-inset-*)（恒返回 0）
 * - Android 15（API 35）起强制 edge-to-edge，无法退出
 * - StatusBar.setOverlaysWebView() / setBackgroundColor() 在 Android 15+
 *   已被 Capacitor 官方标注为失效（本项目 targetSdk=36，即 Android 16）
 *
 * 正确做法（Capacitor 8 官方方案）：
 * 保持 edge-to-edge，由内置 SystemBars 插件（insetsHandling 默认 'css'）
 * 把真实 inset 注入 CSS 变量 --safe-area-inset-*，前端在
 * src/assets/styles/main.css 中优先读取：
 *   padding-top: var(--safe-area-inset-top, env(safe-area-inset-top, 0px));
 * 详情见 android/.../MainActivity.java 的说明。
 */
export async function applyAndroidSystemBars() {
  if (!isNative || platform !== 'android') return
  try {
    // 深色背景下使用浅色系统栏图标（setStyle 在 Android 16+ 仍有效）
    await StatusBar.setStyle({ style: Style.Light })
  } catch (e) {
    console.warn('[capacitor] Android 系统栏样式设置失败:', e)
  }
}
