<script setup lang="ts">
import { cn } from '@/lib/utils'
import { X } from '@lucide/vue'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from 'reka-ui'

const props = defineProps<{
  title?: string
  description?: string
  class?: string
}>()

const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogTrigger v-if="$slots.trigger" as-child>
      <slot name="trigger" />
    </DialogTrigger>

    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/70" />
      <DialogContent
        :class="
          cn(
            'fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 shadow-lg',
            props.class,
          )
        "
      >
        <DialogTitle v-if="props.title" class="pr-8 text-lg font-semibold">
          {{ props.title }}
        </DialogTitle>
        <DialogDescription
          v-if="props.description"
          class="mt-1.5 pr-8 text-sm text-muted-foreground"
        >
          {{ props.description }}
        </DialogDescription>

        <div v-if="$slots.default" class="mt-4">
          <slot />
        </div>

        <div v-if="$slots.footer" class="mt-6 flex justify-end gap-2">
          <slot name="footer" />
        </div>

        <DialogClose
          class="absolute right-4 top-4 rounded-sm opacity-60 transition-opacity hover:opacity-100"
          aria-label="关闭"
        >
          <X class="size-4" />
        </DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
