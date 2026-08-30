<script setup lang="ts">
import { Info, LogOut, Server, Trash2, User, Type, Type as FontIcon } from '@lucide/vue'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectLabel, SelectItem } from '@/components/ui/select'
import { isNative, platform } from '@/composables/useCapacitor'
import { useAppStore } from '@/stores/app'
import { FONT_SIZE_OPTIONS, getMarkdownFontSize, setMarkdownFontSize, type FontSizeValue } from '@/lib/markdown-font-size'
import { fontFamilyGroups, getFontFamily, setFontFamily } from '@/lib/font-family'

const router = useRouter()
const app = useAppStore()
const cleared = ref(false)

/** Markdown 字号档位 */
const mdFontSize = ref<FontSizeValue>(getMarkdownFontSize())

/** 切换 Markdown 字号 */
function onFontSizeChange(size: FontSizeValue) {
  mdFontSize.value = size
  setMarkdownFontSize(size)
}

/** 当前字体族 */
const currentFont = ref(getFontFamily())

/** 切换字体族 */
function onFontChange(val: string) {
  currentFont.value = val
  setFontFamily(val)
}

const envItems = [
  { label: 'API 地址', value: import.meta.env.VITE_API_BASE_URL },
  { label: 'STOMP 信令', value: import.meta.env.VITE_STOMP_URL },
  { label: 'TURN 服务器', value: import.meta.env.VITE_TURN_URL },
]

async function clearHistory() {
  await app.clearHistory()
  cleared.value = true
  setTimeout(() => (cleared.value = false), 2000)
}

/** 退出登录：清理令牌后由路由守卫自动跳回登录页 */
async function logout() {
  await app.logout()
  await router.replace('/login')
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="flex min-h-full flex-col gap-4 px-5 pb-8 pt-2">
      <!-- 连接配置（来自 .env，运行时只读） -->
      <Card class="gap-4 py-5">
        <CardHeader class="px-5">
          <CardTitle class="flex items-center gap-2 text-base">
            <Server class="size-4" />
            连接配置
          </CardTitle>
          <CardDescription>由构建时环境变量注入，如需修改请调整 .env 后重新构建</CardDescription>
        </CardHeader>
        <CardContent class="space-y-3 px-5">
          <div v-for="item in envItems" :key="item.label">
            <p class="text-xs text-muted-foreground">{{ item.label }}</p>
            <p class="break-all font-mono text-sm">{{ item.value || '（未配置）' }}</p>
          </div>
        </CardContent>
      </Card>

      <!-- 消息字号 -->
      <Card class="gap-4 py-5">
        <CardHeader class="px-5">
          <CardTitle class="flex items-center gap-2 text-base">
            <Type class="size-4" />
            消息字号
          </CardTitle>
          <CardDescription>调整对话消息中 Markdown 内容的字号大小</CardDescription>
        </CardHeader>
        <CardContent class="px-5">
          <div class="flex gap-2">
            <button
              v-for="opt in FONT_SIZE_OPTIONS"
              :key="opt.value"
              type="button"
              class="flex flex-1 flex-col items-center gap-0.5 rounded-lg border py-3 transition-colors"
              :class="mdFontSize === opt.value
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-border text-muted-foreground active:bg-accent'"
              @click="onFontSizeChange(opt.value)"
            >
              <span class="text-sm font-medium">{{ opt.label }}</span>
              <span class="font-mono text-xs opacity-60">{{ opt.hint }}</span>
            </button>
          </div>
        </CardContent>
      </Card>

      <!-- 字体设置 -->
      <Card class="gap-4 py-5">
        <CardHeader class="px-5">
          <CardTitle class="flex items-center gap-2 text-base">
            <FontIcon class="size-4" />
            字体设置
          </CardTitle>
          <CardDescription>选择全局 UI 字体族，部分字体需联网加载</CardDescription>
        </CardHeader>
        <CardContent class="px-5">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-foreground">字体族</p>
              <p class="mt-0.5 text-xs text-muted-foreground">应用于界面和 Markdown 内容</p>
            </div>
            <Select :model-value="currentFont" @update:model-value="onFontChange">
              <SelectTrigger class="h-9 w-[160px] shrink-0 text-xs">
                <SelectValue placeholder="选择字体" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup v-for="grp in fontFamilyGroups" :key="grp.group">
                  <SelectLabel class="text-[11px]">{{ grp.group }}</SelectLabel>
                  <SelectItem
                    v-for="opt in grp.options"
                    :key="opt.value"
                    :value="opt.value"
                  >{{ opt.label }}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <!-- 账号 -->
      <Card class="gap-4 py-5">
        <CardHeader class="px-5">
          <CardTitle class="flex items-center gap-2 text-base">
            <User class="size-4" />
            账号
          </CardTitle>
        </CardHeader>
        <CardContent class="space-y-4 px-5">
          <div>
            <p class="text-sm text-muted-foreground">当前登录</p>
            <p class="text-sm font-medium">{{ app.displayName || '未知用户' }}</p>
            <p v-if="app.user?.email" class="font-mono text-xs text-muted-foreground">
              {{ app.user.email }}
            </p>
          </div>
          <Button variant="outline" class="w-full" @click="logout">
            <LogOut class="size-4" />
            退出登录
          </Button>
        </CardContent>
      </Card>

      <!-- 运行环境 -->
      <Card class="gap-4 py-5">
        <CardHeader class="px-5">
          <CardTitle class="flex items-center gap-2 text-base">
            <Info class="size-4" />
            运行环境
          </CardTitle>
        </CardHeader>
        <CardContent class="space-y-3 px-5">
          <div class="flex justify-between">
            <span class="text-sm text-muted-foreground">运行平台</span>
            <span class="font-mono text-sm">{{ platform }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-sm text-muted-foreground">原生容器</span>
            <span class="font-mono text-sm">{{ isNative ? 'Capacitor App' : '浏览器 / H5' }}</span>
          </div>
        </CardContent>
      </Card>

      <!-- 数据 -->
      <Card class="gap-4 py-5">
        <CardHeader class="px-5">
          <CardTitle class="text-base">数据</CardTitle>
          <CardDescription>清除本机保存的连接历史</CardDescription>
        </CardHeader>
        <CardContent class="px-5">
          <Button variant="outline" class="w-full" @click="clearHistory">
            <Trash2 class="size-4" />
            {{ cleared ? '已清除' : '清除连接历史' }}
          </Button>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
