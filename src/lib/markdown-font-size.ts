/**
 * Markdown 字号管理工具（Mobile 版）
 *
 * 三档字号偏好（小/中/大），通过 data 属性 + CSS 变量驱动 markstream-vue 渲染。
 * Mobile 屏幕较小，字号整体比 Desktop 下调一级：
 *   小（默认）= 11px（Desktop 无此档，比 Desktop 小更小）
 *   中        = 13px（等于 Desktop 的「小」）
 *   大        = 15px（等于 Desktop 的「中」）
 *
 * 通过在 <html> 上设置 data-md-font-size 属性，
 * main.css 中的 CSS 规则覆盖 markstream-vue 的 --ms-text-* 变量。
 * 持久化到 localStorage。
 */

/** 字号档位选项 */
export const FONT_SIZE_OPTIONS = [
  { value: 'small', label: '小', hint: '11px' },
  { value: 'medium', label: '中', hint: '13px' },
  { value: 'large', label: '大', hint: '15px' },
] as const

/** 字号值类型 */
export type FontSizeValue = (typeof FONT_SIZE_OPTIONS)[number]['value']

/** 默认字号档位 */
export const DEFAULT_FONT_SIZE: FontSizeValue = 'small'

/** localStorage 存储键 */
const STORAGE_KEY = 'markdown-font-size'

/**
 * 将字号档位写入 DOM（data 属性）
 *
 * main.css 中的 [data-md-font-size='...'] .markstream-vue 规则
 * 会覆盖 markstream-vue 默认的 --ms-text-body 等 CSS 变量
 */
export function applyMarkdownFontSize(size: string) {
  const validSize = FONT_SIZE_OPTIONS.some((o) => o.value === size) ? size : DEFAULT_FONT_SIZE
  document.documentElement.setAttribute('data-md-font-size', validSize)
}

/** 获取持久化的字号档位 */
export function getMarkdownFontSize(): FontSizeValue {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored && FONT_SIZE_OPTIONS.some((o) => o.value === stored)) {
    return stored as FontSizeValue
  }
  return DEFAULT_FONT_SIZE
}

/** 更新字号档位并持久化 */
export function setMarkdownFontSize(size: FontSizeValue) {
  localStorage.setItem(STORAGE_KEY, size)
  applyMarkdownFontSize(size)
}

/** 初始化字号（从 localStorage 读取并应用到 DOM） */
export function initMarkdownFontSize(): FontSizeValue {
  const size = getMarkdownFontSize()
  applyMarkdownFontSize(size)
  return size
}
