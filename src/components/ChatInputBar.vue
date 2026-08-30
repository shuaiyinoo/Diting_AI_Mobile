<script setup lang="ts">
import { ref, computed } from 'vue'
import { Send } from '@lucide/vue'

/**
 * 底部聊天输入栏
 *
 * 与顶部选择条统一风格：一条横向条带，内嵌输入框 + 发送按钮。
 * 始终是一行高度，点击输入框直接打字，不需要展开/收起。
 * 输入框聚焦时条带高亮边框。
 */

const model = defineModel<string>({ default: '' })

const props = withDefaults(
  defineProps<{
    placeholder?: string
    disabled?: boolean
  }>(),
  { placeholder: '输入消息…', disabled: false },
)

const emit = defineEmits<{
  submit: [text: string]
}>()

const focused = ref(false)
const hasText = computed(() => model.value.trim().length > 0)

function onSubmit() {
  const text = model.value.trim()
  if (!text || props.disabled) return
  emit('submit', text)
  model.value = ''
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    onSubmit()
  }
}
</script>

<template>
  <div class="shrink-0 border-t border-border bg-muted/30 px-4 py-[5px]">
    <div
      class="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 transition-colors"
      :class="focused ? 'border-primary/40' : 'border-border'"
    >
      <input
        v-model="model"
        type="text"
        :placeholder="placeholder"
        :disabled="disabled"
        class="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        @focus="focused = true"
        @blur="focused = false"
        @keydown="onKeydown"
      />
      <button
        type="button"
        class="flex size-7 shrink-0 items-center justify-center rounded-full transition-all active:scale-90"
        :class="
          hasText && !disabled
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground'
        "
        :disabled="!hasText || disabled"
        @click="onSubmit"
      >
        <Send class="size-4" />
      </button>
    </div>
  </div>
</template>
