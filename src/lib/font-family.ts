/**
 * 字体管理工具（Mobile 版）
 *
 * 从 Desktop 的 theme.js 迁移字体选择功能。
 * 提供 UI 字体族选择，通过 CSS 变量 --font-family 驱动全局字体。
 * 持久化到 localStorage。
 */

/** 字体信息 */
interface FontInfo {
  /** 显示名称 */
  label: string
  /** 分组名 */
  group: string
  /** CSS font-family 值 */
  value: string
}

/** 字体映射表（与 Desktop theme.js 保持一致） */
export const fontFamilyMap: Record<string, FontInfo> = {
  // ── 系统默认 ──
  system: {
    label: 'System',
    group: '系统',
    value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  },

  // ── 无衬线（Sans Serif）──
  geist: {
    label: 'Geist Sans',
    group: '无衬线',
    value: "'Geist Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  inter: {
    label: 'Inter',
    group: '无衬线',
    value: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  notoSans: {
    label: 'Noto Sans',
    group: '无衬线',
    value: "'Noto Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  nunitoSans: {
    label: 'Nunito Sans',
    group: '无衬线',
    value: "'Nunito Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  figtree: {
    label: 'Figtree',
    group: '无衬线',
    value: "'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  roboto: {
    label: 'Roboto',
    group: '无衬线',
    value: "'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  raleway: {
    label: 'Raleway',
    group: '无衬线',
    value: "'Raleway', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  dmSans: {
    label: 'DM Sans',
    group: '无衬线',
    value: "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  publicSans: {
    label: 'Public Sans',
    group: '无衬线',
    value: "'Public Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  outfit: {
    label: 'Outfit',
    group: '无衬线',
    value: "'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  manrope: {
    label: 'Manrope',
    group: '无衬线',
    value: "'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  spaceGrotesk: {
    label: 'Space Grotesk',
    group: '无衬线',
    value: "'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  montserrat: {
    label: 'Montserrat',
    group: '无衬线',
    value: "'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  ibmPlexSans: {
    label: 'IBM Plex Sans',
    group: '无衬线',
    value: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  sourceSans3: {
    label: 'Source Sans 3',
    group: '无衬线',
    value: "'Source Sans 3', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  instrumentSans: {
    label: 'Instrument Sans',
    group: '无衬线',
    value: "'Instrument Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },

  // ── 等宽（Monospace）──
  jetbrainsMono: {
    label: 'JetBrains Mono',
    group: '等宽',
    value: "'JetBrains Mono', 'SF Mono', Menlo, ui-monospace, monospace",
  },
  geistMono: {
    label: 'Geist Mono',
    group: '等宽',
    value: "'Geist Mono', 'SF Mono', Menlo, ui-monospace, monospace",
  },

  // ── 衬线（Serif）──
  notoSerif: {
    label: 'Noto Serif',
    group: '衬线',
    value: "'Noto Serif', Georgia, 'Times New Roman', serif",
  },
  robotoSlab: {
    label: 'Roboto Slab',
    group: '衬线',
    value: "'Roboto Slab', Georgia, 'Times New Roman', serif",
  },
  merriweather: {
    label: 'Merriweather',
    group: '衬线',
    value: "'Merriweather', Georgia, 'Times New Roman', serif",
  },
  lora: {
    label: 'Lora',
    group: '衬线',
    value: "'Lora', Georgia, 'Times New Roman', serif",
  },
  playfairDisplay: {
    label: 'Playfair Display',
    group: '衬线',
    value: "'Playfair Display', Georgia, 'Times New Roman', serif",
  },
}

/** 分组顺序 */
const fontGroupOrder = ['系统', '无衬线', '等宽', '衬线']

/** 分组后的字体选项（用于 Select 组件） */
export const fontFamilyGroups = fontGroupOrder
  .map((group) => ({
    group,
    options: Object.entries(fontFamilyMap)
      .filter(([, info]) => info.group === group)
      .map(([value, info]) => ({ value, label: info.label })),
  }))
  .filter((g) => g.options.length > 0)

/** 默认字体 */
export const DEFAULT_FONT_FAMILY = 'system'

/** localStorage 存储键 */
const STORAGE_KEY = 'theme-font-family'

/** 将字体应用到 DOM */
export function applyFontFamily(font: string) {
  const validFont = fontFamilyMap[font] ? font : DEFAULT_FONT_FAMILY
  const fontInfo = fontFamilyMap[validFont]
  const root = document.documentElement

  root.style.setProperty('--font-family', fontInfo.value)

  // 如果用户选择的字体是等宽类，则 --font-mono 也跟随用户选择
  if (fontInfo.group === '等宽') {
    root.style.setProperty('--font-mono', fontInfo.value)
  } else {
    // 恢复默认等宽字体栈
    root.style.setProperty('--font-mono', "'SF Mono', Menlo, Monaco, 'Cascadia Code', 'Roboto Mono', ui-monospace, monospace")
  }
}

/** 获取持久化的字体 */
export function getFontFamily(): string {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored && fontFamilyMap[stored]) {
    return stored
  }
  return DEFAULT_FONT_FAMILY
}

/** 更新字体并持久化 */
export function setFontFamily(font: string) {
  localStorage.setItem(STORAGE_KEY, font)
  applyFontFamily(font)
}

/** 初始化字体（从 localStorage 读取并应用到 DOM） */
export function initFontFamily(): string {
  const font = getFontFamily()
  applyFontFamily(font)
  return font
}
