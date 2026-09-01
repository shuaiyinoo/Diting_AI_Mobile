<script setup lang="ts">
import { type Component } from 'vue'
import { ChevronRight, ChevronDown, FolderClosed, File as FileIcon, FileText } from '@lucide/vue'
import type { FileItemTreeNode } from '@/types/sync'

/**
 * 文件树节点组件（递归渲染）
 *
 * 使用 defineModel + self-include 实现递归树，
 * 支持任意深度的文件夹嵌套。
 */

const props = defineProps<{
  node: FileItemTreeNode
  depth: number
  expandedDirs: Set<number>
  selectedFile: FileItemTreeNode | null
}>()

const emit = defineEmits<{
  'toggle-dir': [node: FileItemTreeNode]
  'select-file': [node: FileItemTreeNode]
}>()

function onClick() {
  if (props.node.is_dir === 1) {
    emit('toggle-dir', props.node)
  } else {
    emit('select-file', props.node)
  }
}

function isExpanded(): boolean {
  return props.expandedDirs.has(props.node.id)
}

function isSelected(): boolean {
  return props.selectedFile?.id === props.node.id
}

function getFileIcon(node: FileItemTreeNode): Component {
  if (node.is_dir === 1) return FolderClosed
  const textTypes = ['txt', 'md', 'json', 'js', 'ts', 'vue', 'html', 'css', 'scss', 'xml', 'yaml', 'yml', 'csv', 'log', 'sh', 'py', 'java', 'sql']
  if (textTypes.includes(node.type?.toLowerCase())) return FileText
  return FileIcon
}

function statusClass(node: FileItemTreeNode): string {
  switch (node.status) {
    case 'READY':
      return 'bg-green-500'
    case 'PROCESSING':
      return 'animate-pulse bg-amber-500'
    case 'FAILED':
      return 'bg-red-500'
    default:
      return ''
  }
}
</script>

<template>
  <div>
    <!-- 节点行 -->
    <button
      type="button"
      class="flex w-full items-center gap-1.5 px-3 py-1.5 text-left transition-colors active:bg-accent"
      :class="isSelected() ? 'bg-primary/5' : ''"
      :style="{ paddingLeft: depth * 16 + 12 + 'px' }"
      @click="onClick"
    >
      <!-- 展开/折叠箭头（仅目录有） -->
      <component
        v-if="node.is_dir === 1"
        :is="isExpanded() ? ChevronDown : ChevronRight"
        class="size-3.5 shrink-0 text-muted-foreground"
      />
      <span v-else class="inline-block size-3.5 shrink-0" />

      <!-- 文件/文件夹图标 -->
      <component
        :is="getFileIcon(node)"
        :class="[
          'size-3.5 shrink-0',
          node.is_dir === 1 ? 'text-muted-foreground' : 'text-muted-foreground/70',
        ]"
      />

      <!-- 名称 -->
      <span class="truncate text-sm" :class="node.is_dir === 1 ? 'font-medium' : ''">
        {{ node.name }}
      </span>

      <!-- RAG 状态标记 -->
      <span
        v-if="node.status === 'READY' || node.status === 'PROCESSING' || node.status === 'FAILED'"
        class="ml-auto size-1.5 shrink-0 rounded-full"
        :class="statusClass(node)"
      />
    </button>

    <!-- 递归渲染子节点 -->
    <template v-if="node.is_dir === 1 && isExpanded() && node.children">
      <FileTreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :expanded-dirs="expandedDirs"
        :selected-file="selectedFile"
        @toggle-dir="$emit('toggle-dir', $event)"
        @select-file="$emit('select-file', $event)"
      />
    </template>
  </div>
</template>
