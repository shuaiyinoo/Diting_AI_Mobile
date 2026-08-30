import { createRouter, createWebHashHistory } from 'vue-router'
import { useAppStore } from '@/stores/app'

/**
 * ⚠️ 必须用 Hash 模式
 * App 内页面通过 file:// 协议加载，history 模式刷新会 404。
 */
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { title: '登录' },
    },
    {
      path: '/',
      name: 'home',
      component: () => import('@/components/AppLayout.vue'),
      meta: { title: 'Diting Mobile' },
    },
    {
      path: '/connect',
      name: 'connect',
      component: () => import('@/views/ConnectView.vue'),
      meta: { title: '连接设备' },
    },
    {
      path: '/remote/:code',
      name: 'remote',
      component: () => import('@/views/RemoteView.vue'),
      meta: { title: '远程桌面', immersive: true },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/SettingsView.vue'),
      meta: { title: '设置' },
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

/**
 * 登录守卫
 *
 * WebSocket 与所有业务接口都依赖登录令牌，
 * 因此未登录时统一拦截到登录页，避免拿到一堆 401 后再跳转。
 */
router.beforeEach(async (to) => {
  const app = useAppStore()
  // 首次进入时恢复本地登录态
  if (!app.loaded) {
    await app.load()
  }

  if (!app.isLoggedIn && to.name !== 'login') {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (app.isLoggedIn && to.name === 'login') {
    return { name: 'home' }
  }
  return true
})

router.afterEach((to) => {
  const title = (to.meta.title as string) ?? 'Diting Mobile'
  document.title = title
})

export default router
