<script setup lang="ts">
import { Loader2, LogIn, MonitorPlay, ShieldCheck } from '@lucide/vue'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAppStore } from '@/stores/app'

const router = useRouter()
const app = useAppStore()

// ⚠️ Vue 模板表达式不是 module 上下文，不能直接用 import.meta，
//    必须在 script 中取值后再交给模板
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL

const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

async function submit() {
  if (!email.value.trim() || !password.value) {
    error.value = '请输入邮箱和密码'
    return
  }

  loading.value = true
  error.value = ''
  const res = await app.login(email.value.trim(), password.value)
  loading.value = false

  if (res.success) {
    // 登录成功 → 回到首页，后续页面即可建立 WebSocket 连接
    await router.replace('/')
  } else {
    error.value = res.message || '登录失败，请检查邮箱和密码'
  }
}

function onInput() {
  if (error.value) error.value = ''
}
</script>

<template>
  <div class="flex min-h-full flex-col justify-center p-safe">
    <div class="mx-auto w-full max-w-sm px-6">
      <!-- 品牌区 -->
      <div class="mb-10 text-center">
        <div class="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-primary/10">
          <MonitorPlay class="size-8 text-primary" />
        </div>
        <h1 class="text-2xl font-semibold tracking-tight">Diting Mobile</h1>
        <p class="mt-1.5 text-sm text-muted-foreground">登录后即可远程控制你的电脑</p>
      </div>

      <div class="space-y-4">
        <div class="space-y-1.5">
          <label class="text-sm font-medium" for="email">邮箱</label>
          <Input
            id="email"
            v-model="email"
            type="email"
            inputmode="email"
            autocomplete="username"
            placeholder="you@example.com"
            :class="error && 'border-destructive'"
            @input="onInput"
            @keyup.enter="submit"
          />
        </div>

        <div class="space-y-1.5">
          <label class="text-sm font-medium" for="password">密码</label>
          <Input
            id="password"
            v-model="password"
            type="password"
            autocomplete="current-password"
            placeholder="请输入密码"
            :class="error && 'border-destructive'"
            @input="onInput"
            @keyup.enter="submit"
          />
        </div>

        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

        <Button class="w-full" size="lg" :disabled="loading" @click="submit">
          <Loader2 v-if="loading" class="size-5 animate-spin" />
          <LogIn v-else class="size-5" />
          {{ loading ? '登录中…' : '登录' }}
        </Button>
      </div>

      <!-- 服务端地址，便于联调时确认环境 -->
      <div class="mt-10 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck class="size-3.5" />
        <span class="font-mono">{{ apiBaseUrl }}</span>
      </div>
    </div>
  </div>
</template>
