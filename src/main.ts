import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'

// ===== 全局样式 =====
// markstream-vue 流式 Markdown 渲染器样式（必须在 main.css 之前导入）
import 'markstream-vue/index.css'
import 'katex/dist/katex.min.css'
// Tailwind CSS + shadcn-vue 全局变量 + 移动端适配
import './assets/styles/main.css'

// ===== 主题初始化（亮/暗模式） =====
import './theme.ts'

// ===== Markdown 字号初始化（小/中/大，默认小） =====
import { initMarkdownFontSize } from './lib/markdown-font-size'
initMarkdownFontSize()

// ===== 字体初始化（UI 字体族选择） =====
import { initFontFamily } from './lib/font-family'
initFontFamily()

// ===== markstream-vue 初始化 =====
import { enableKatex, enableMermaid, setCustomComponents } from 'markstream-vue'
import WidgetNode from './components/WidgetNode.vue'

// 启用 Mermaid 图表和 KaTeX 数学公式渲染
enableMermaid()
enableKatex()

// 注册自定义 widget 组件：LLM 输出 ```widget fence 时由 WidgetNode 渲染
setCustomComponents('chat', { widget: WidgetNode })

const app = createApp(App)

app.use(createPinia())
app.use(router)

// 等路由就绪再挂载，避免首屏闪白
router.isReady().then(() => {
  app.mount('#app')
})
