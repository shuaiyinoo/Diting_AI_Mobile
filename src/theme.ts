import { ref, watch } from 'vue'

/**
 * 主题系统 — Diting AI Mobile
 *
 * 精简版：只支持亮色/暗色/跟随系统三种模式。
 * 与 Desktop 保持一致的 HSL 变量体系（shadcn-vue 标准）。
 */

// ========== 主题模式 ==========
/** 当前是否暗色 */
const isDark = ref(false)
/** 主题模式：'light' | 'dark' | 'system' */
const themeMode = ref<'light' | 'dark' | 'system'>('light')
/** 系统暗色偏好 */
const systemDark = ref(
  typeof window !== 'undefined'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false,
)

// ========== 应用自定义变量派生 ==========
function applyAppCustomVariables(dark: boolean) {
  const root = document.documentElement
  const cs = getComputedStyle(root)

  function getVar(name: string): string {
    return cs.getPropertyValue(name).trim()
  }
  function h(c: string): string {
    return `hsl(${c})`
  }
  function ha(c: string, a: string): string {
    return `hsl(${c} / ${a})`
  }

  if (dark) {
    root.style.setProperty('--bg-layout', ha(getVar('--background'), '0.7'))
    root.style.setProperty('--bg-panel', h(getVar('--background')))
    root.style.setProperty('--bg-sidebar', h(getVar('--muted')))
    root.style.setProperty('--bg-statusbar', h(getVar('--muted')))
    root.style.setProperty('--bg-hover', h(getVar('--accent')))
    root.style.setProperty('--bg-active', ha(getVar('--accent'), '0.8'))
    root.style.setProperty('--bg-divider', h(getVar('--border')))
    root.style.setProperty('--bg-divider-hover', 'hsl(var(--primary))')
    root.style.setProperty('--border-color', h(getVar('--border')))
    root.style.setProperty('--border-color-light', h(getVar('--border')))
    root.style.setProperty('--text-primary', h(getVar('--foreground')))
    root.style.setProperty('--text-secondary', h(getVar('--muted-foreground')))
    root.style.setProperty('--text-muted', ha(getVar('--muted-foreground'), '0.7'))
    root.style.setProperty('--accent-color', 'hsl(var(--primary))')
    root.style.setProperty('--accent-hover', 'hsl(var(--primary) / 0.8)')
    root.style.setProperty('--shadow-sm', '0 1px 4px hsl(0 0% 0% / 0.3)')
    root.style.setProperty('--scrollbar-thumb', ha(getVar('--muted-foreground'), '0.3'))
    root.style.setProperty('--scrollbar-track', 'transparent')
  } else {
    root.style.setProperty('--bg-layout', h(getVar('--secondary')))
    root.style.setProperty('--bg-panel', h(getVar('--background')))
    root.style.setProperty('--bg-sidebar', h(getVar('--secondary')))
    root.style.setProperty('--bg-statusbar', h(getVar('--secondary')))
    root.style.setProperty('--bg-hover', h(getVar('--accent')))
    root.style.setProperty('--bg-active', ha(getVar('--accent'), '0.6'))
    root.style.setProperty('--bg-divider', h(getVar('--border')))
    root.style.setProperty('--bg-divider-hover', 'hsl(var(--primary))')
    root.style.setProperty('--border-color', h(getVar('--border')))
    root.style.setProperty('--border-color-light', ha(getVar('--secondary'), '0.5'))
    root.style.setProperty('--text-primary', h(getVar('--foreground')))
    root.style.setProperty('--text-secondary', h(getVar('--muted-foreground')))
    root.style.setProperty('--text-muted', ha(getVar('--muted-foreground'), '0.7'))
    root.style.setProperty('--accent-color', 'hsl(var(--primary))')
    root.style.setProperty('--accent-hover', 'hsl(var(--primary) / 0.8)')
    root.style.setProperty('--shadow-sm', '0 1px 4px hsl(0 0% 0% / 0.06)')
    root.style.setProperty('--scrollbar-thumb', ha(getVar('--muted-foreground'), '0.4'))
    root.style.setProperty('--scrollbar-track', 'transparent')
  }
}

// ========== 应用主题到 DOM ==========
function applyTheme() {
  const dark = themeMode.value === 'dark' || (themeMode.value === 'system' && systemDark.value)
  isDark.value = dark

  const html = document.documentElement
  if (dark) {
    html.classList.add('dark')
    html.setAttribute('data-theme', 'dark')
  } else {
    html.classList.remove('dark')
    html.setAttribute('data-theme', 'light')
  }

  applyAppCustomVariables(dark)
}

// ========== 主题切换函数 ==========

/** 在亮色/暗色之间切换 */
function toggleTheme() {
  const newMode: 'light' | 'dark' = isDark.value ? 'light' : 'dark'
  setThemeMode(newMode)
}

/** 设置主题模式 */
function setThemeMode(mode: 'light' | 'dark' | 'system') {
  themeMode.value = mode
  localStorage.setItem('app-theme-mode', mode)
  applyTheme()
}

// ========== 初始化 ==========

// 监听系统主题变化
if (typeof window !== 'undefined' && window.matchMedia) {
  const mql = window.matchMedia('(prefers-color-scheme: dark)')
  mql.addEventListener('change', (e) => {
    systemDark.value = e.matches
    if (themeMode.value === 'system') {
      applyTheme()
    }
  })
}

// 从 localStorage 恢复配置
function initTheme() {
  const savedMode = (localStorage.getItem('app-theme-mode') as 'light' | 'dark' | 'system') || 'light'
  themeMode.value = savedMode
  applyTheme()
}

// 立即初始化
initTheme()

// 当 isDark 变化时，重新应用定制
watch(isDark, () => {
  applyAppCustomVariables(isDark.value)
})

export {
  isDark,
  themeMode,
  systemDark,
  toggleTheme,
  setThemeMode,
}
