<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import {
  FolderClosed,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ChevronLeft,
  File as FileIcon,
  FileText,
  RefreshCw,
  Globe,
  Server,
  ShieldCheck,
  HardDrive,
  Network,
  Cloud,
  Inbox,
} from '@lucide/vue'
import { useAppStore } from '@/stores/app'
import type { FileFolderItem, FileItemTreeNode, FileContentResult } from '@/types/sync'
import type { Component } from 'vue'
import FileTreeNode from '@/components/FileTreeNode.vue'
import MdTtEditor from '@/components/MdTtEditor.vue'

/**
 * 文件模块页
 *
 * 布局与 AgentView 一致：
 *   - 小屏：顶部下拉框 → 展开后包含文件夹列表 + 完整文件树 → 点击文件预览
 *   - 宽屏：左侧树形列表 + 右侧预览，中间可拖动分隔条
 *
 * 数据来源：通过 STOMP sync 协议从 Desktop 端实时拉取
 */

const props = withDefaults(
  defineProps<{
    isWide?: boolean
    /** 侧边栏宽度（由父组件 AppLayout 统一管理） */
    sidebarWidth?: number
    /** 大屏侧边栏展开/收起（由父组件 AppLayout 统一管理） */
    sidebarOpen?: boolean
  }>(),
  { isWide: false, sidebarWidth: 300, sidebarOpen: true },
)

const emit = defineEmits<{
  /** 大屏侧边栏展开/收起切换请求 */
  'toggle-sidebar': []
}>()

const appStore = useAppStore()

// 从 store 获取数据
const folders = computed<FileFolderItem[]>(() => appStore.fileData.folders)
const trees = computed<Record<number, FileItemTreeNode[]>>(() => appStore.fileData.trees)
const loading = computed(() => appStore.syncLoading)

// 选中的文件夹
const selectedFolderId = ref<number | null>(null)
const selectedFolder = computed<FileFolderItem | null>(
  () => folders.value.find((f) => f.id === selectedFolderId.value) ?? null,
)

// 展开的目录（按 node id 索引）
const expandedDirs = ref<Set<number>>(new Set())

// 选中的文件
const selectedFile = ref<FileItemTreeNode | null>(null)

// 文件内容
const fileContent = ref<FileContentResult | null>(null)
const contentLoading = ref(false)

// Markdown 编辑内容（v-model 绑定 MdTtEditor）
const mdContent = ref('')
// 编辑器是否可编辑（当前默认可编辑，后续可接权限控制）
const mdEditable = ref(true)

// 小屏抽屉展开/收起
const drawerOpen = ref(false)

/** 大屏切换时自动收起小屏抽屉 */
watch(
  () => props.isWide,
  (wide) => {
    if (wide) drawerOpen.value = false
  },
)

/** 数据同步到达后，自动选中第一个文件夹 */
watch(folders, (list) => {
  if (list.length > 0 && !selectedFolderId.value) {
    selectFolder(list[0])
  }
})

/**
 * 当前选中文件夹的可见树（跳过虚拟根节点，直接返回 rootNode.children）
 *
 * Desktop 返回的结构是 [rootNode]，rootNode.isRoot=true，名称=文件夹名。
 * 外层已经显示了文件夹名（大屏侧边栏 / 小屏下拉顶部），所以根节点本身不需要再显示，
 * 直接渲染它的 children 即可，减少一层冗余。
 */
const visibleTree = computed<FileItemTreeNode[]>(() => {
  if (!selectedFolderId.value) return []
  const tree = trees.value[selectedFolderId.value] ?? []
  // 跳过虚拟根节点，直接返回 children
  if (tree.length > 0 && tree[0].isRoot) {
    return tree[0].children ?? []
  }
  return tree
})

/** 当前标题 */
const currentTitle = computed(() => {
  if (selectedFile.value) return selectedFile.value.name
  if (!selectedFolder.value) return '选择文件夹'
  return getFolderDisplayName(selectedFolder.value)
})

// ────── 文件夹选择 ──────

function selectFolder(folder: FileFolderItem) {
  selectedFolderId.value = folder.id
  selectedFile.value = null
  fileContent.value = null
  // 默认展开第一级目录（让用户直接看到文件）
  expandedDirs.value = new Set()
  // 自动展开 visibleTree 中所有一级目录
  for (const node of visibleTree.value) {
    if (node.is_dir === 1) {
      expandedDirs.value.add(node.id)
    }
  }
  // 小屏模式下不收起抽屉——让用户在下拉面板里继续浏览文件树
}

function toggleFolderList() {
  if (props.isWide) return
  drawerOpen.value = !drawerOpen.value
}

// ────── 树操作 ──────

function toggleDir(node: FileItemTreeNode) {
  if (expandedDirs.value.has(node.id)) {
    expandedDirs.value.delete(node.id)
  } else {
    expandedDirs.value.add(node.id)
  }
  expandedDirs.value = new Set(expandedDirs.value)
}

async function onSelectFile(node: FileItemTreeNode) {
  selectedFile.value = node
  // 小屏选文件后收起下拉面板
  if (!props.isWide) drawerOpen.value = false

  // 加载文件内容
  if (node.is_dir === 0) {
    contentLoading.value = true
    fileContent.value = null
    try {
      fileContent.value = await appStore.loadFileContent(node.id)
      // 将加载到的 Markdown 内容同步到编辑器
      mdContent.value = fileContent.value?.isText ? (fileContent.value.content || '') : ''
    } finally {
      contentLoading.value = false
    }
  }
}

// ────── 协议标签辅助 ──────

function getProtocolBadge(protocol: string): string {
  const map: Record<string, string> = {
    local: 'LOC',
    ftp: 'FTP',
    ftps: 'FTPS',
    sftp: 'SFTP',
    smb: 'SMB',
    webdav: 'DAV',
    s3: 'S3',
  }
  return map[protocol] || 'LOC'
}

function getProtocolLabel(protocol: string): string {
  const map: Record<string, string> = {
    local: '本地',
    ftp: 'FTP',
    ftps: 'FTPS',
    sftp: 'SFTP',
    smb: 'SMB',
    webdav: 'WebDAV',
    s3: 'S3',
  }
  return map[protocol] || '本地'
}

function getProtocolBadgeClass(protocol: string): string {
  const map: Record<string, string> = {
    local: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
    ftp: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400',
    ftps: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
    sftp: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
    smb: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    webdav: 'bg-pink-500/15 text-pink-600 dark:text-pink-400',
    s3: 'bg-green-500/15 text-green-600 dark:text-green-400',
  }
  return map[protocol] || map.local
}

function getProtocolIcon(protocol: string): Component {
  const map: Record<string, Component> = {
    local: FolderClosed,
    ftp: Globe,
    ftps: ShieldCheck,
    sftp: Server,
    smb: HardDrive,
    webdav: Network,
    s3: Cloud,
  }
  return map[protocol] || FolderClosed
}

// ────── 格式化工具 ──────

function getFolderDisplayName(folder: FileFolderItem): string {
  if (folder.alias) return folder.alias
  if (folder.folder_name) return folder.folder_name
  const parts = folder.path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || folder.path
}

function formatFileSize(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let size = bytes
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024
    i++
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function formatDateTime(isoStr: string): string {
  if (!isoStr) return '-'
  const d = new Date(isoStr)
  if (isNaN(d.getTime())) return isoStr
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function getFileIcon(node: FileItemTreeNode): Component {
  if (node.is_dir === 1) return FolderClosed
  const textTypes = ['txt', 'md', 'json', 'js', 'ts', 'vue', 'html', 'css', 'scss', 'xml', 'yaml', 'yml', 'csv', 'log', 'sh', 'py', 'java', 'sql']
  if (textTypes.includes(node.type?.toLowerCase())) return FileText
  return FileIcon
}

// ────── 刷新 ──────

async function refresh() {
  await appStore.refreshFileData()
}

onMounted(() => {
  if (appStore.syncConnected && folders.value.length === 0) {
    void refresh()
  }
})
</script>

<template>
  <!-- 大屏：flex-row 左右布局；小屏：flex-col 上下布局 -->
  <div class="relative flex h-full overflow-hidden" :class="isWide ? 'flex-row' : 'flex-col'">
    <!-- ════ 大屏：左侧侧边栏 ════ -->
    <template v-if="isWide">
      <div
        v-if="sidebarOpen"
        class="flex h-full shrink-0 flex-col border-r border-border bg-card"
        :style="{ width: props.sidebarWidth + 'px' }"
      >
        <!-- 侧边栏头部 -->
        <div class="flex items-center justify-between border-b border-border px-3 py-2.5">
          <span class="flex items-center gap-2">
            <FolderClosed class="size-4 text-primary" />
            <span class="text-sm font-medium">文件列表</span>
          </span>
          <div class="flex items-center gap-1">
            <button
              type="button"
              class="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors active:bg-accent"
              title="刷新"
              @click="refresh"
            >
              <RefreshCw class="size-3.5" :class="loading ? 'animate-spin' : ''" />
            </button>
            <button
              type="button"
              class="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors active:bg-accent"
              title="收起侧边栏"
              @click="$emit('toggle-sidebar')"
            >
              <ChevronLeft class="size-4" />
            </button>
          </div>
        </div>

        <!-- 文件夹列表 + 树形结构 -->
        <div class="min-h-0 flex-1 overflow-y-auto">
          <div v-if="folders.length === 0" class="px-4 py-8 text-center text-sm text-muted-foreground">
            {{ loading ? '正在同步…' : '暂无文件' }}
          </div>
          <div v-else class="divide-y divide-border border-t border-border">
            <div v-for="folder in folders" :key="folder.id">
              <!-- 文件夹行 -->
              <button
                type="button"
                class="flex w-full items-center gap-1.5 px-3 py-2 text-left transition-colors active:bg-accent"
                :class="selectedFolderId === folder.id ? 'bg-primary/5' : ''"
                @click="selectFolder(folder)"
              >
                <component
                  :is="selectedFolderId === folder.id ? ChevronDown : ChevronRight"
                  class="size-3.5 shrink-0 text-muted-foreground"
                />
                <!-- 协议标签 -->
                <span
                  class="flex h-[18px] w-[30px] shrink-0 items-center justify-center rounded text-[9px] font-bold leading-none tracking-wide"
                  :class="getProtocolBadgeClass(folder.protocol || 'local')"
                  :title="getProtocolLabel(folder.protocol || 'local')"
                >
                  {{ getProtocolBadge(folder.protocol || 'local') }}
                </span>
                <span class="truncate text-sm font-medium">{{ getFolderDisplayName(folder) }}</span>
              </button>

              <!-- 文件夹内的树形结构（跳过虚拟根节点，直接渲染 children） -->
              <div
                v-if="selectedFolderId === folder.id"
                class="border-l-2 border-border pl-2"
              >
                <template v-if="(trees[folder.id] ?? []).length > 0 && (trees[folder.id] ?? [])[0]?.isRoot">
                  <FileTreeNode
                    v-for="node in ((trees[folder.id] ?? [])[0].children ?? [])"
                    :key="node.id"
                    :node="node"
                    :depth="0"
                    :expanded-dirs="expandedDirs"
                    :selected-file="selectedFile"
                    @toggle-dir="toggleDir"
                    @select-file="onSelectFile"
                  />
                </template>
                <template v-else>
                  <FileTreeNode
                    v-for="node in (trees[folder.id] ?? [])"
                    :key="node.id"
                    :node="node"
                    :depth="0"
                    :expanded-dirs="expandedDirs"
                    :selected-file="selectedFile"
                    @toggle-dir="toggleDir"
                    @select-file="onSelectFile"
                  />
                </template>
                <div
                  v-if="(trees[folder.id] ?? []).length === 0 || (((trees[folder.id] ?? [])[0]?.children ?? []).length === 0 && (trees[folder.id] ?? [])[0]?.isRoot)"
                  class="px-4 py-2 text-xs text-muted-foreground"
                >
                  暂无文件
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 侧边栏收起态 -->
      <button
        v-else
        type="button"
        class="flex h-full w-[50px] shrink-0 flex-col items-center justify-center gap-2 border-r border-border bg-muted/30 transition-colors active:bg-accent"
        title="展开文件列表"
        @click="$emit('toggle-sidebar')"
      >
        <span
          class="text-xs font-medium text-muted-foreground"
          style="writing-mode: vertical-rl; letter-spacing: 2px"
        >展开文件</span>
        <ChevronRight class="size-4 text-muted-foreground" />
      </button>
    </template>

    <!-- ════ 小屏：顶部下拉（文件夹选择 + 完整树） ════ -->
    <template v-else>
      <!-- 顶部下拉触发条 -->
      <button
        v-if="!isWide"
        type="button"
        class="flex w-full items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5 text-left transition-colors active:bg-accent"
        @click="toggleFolderList"
      >
        <span class="flex items-center gap-2">
          <component
            :is="selectedFile ? getFileIcon(selectedFile) : (selectedFolder ? getProtocolIcon(selectedFolder.protocol || 'local') : FolderClosed)"
            class="size-4 text-primary"
          />
          <span class="truncate text-sm font-medium">{{ currentTitle }}</span>
          <!-- 协议标签（仅选中文件夹时显示） -->
          <span
            v-if="selectedFolder && !selectedFile"
            class="flex h-[18px] w-[30px] shrink-0 items-center justify-center rounded text-[9px] font-bold leading-none tracking-wide"
            :class="getProtocolBadgeClass(selectedFolder.protocol || 'local')"
          >
            {{ getProtocolBadge(selectedFolder.protocol || 'local') }}
          </span>
        </span>
        <component
          :is="drawerOpen ? ChevronUp : ChevronDown"
          class="size-4 shrink-0 text-muted-foreground"
        />
      </button>

      <!-- 下拉面板：文件夹列表 + 选中文件夹的完整树（绝对定位浮层） -->
      <div
        v-if="drawerOpen && !isWide"
        class="absolute inset-x-0 top-[41px] z-20 max-h-[60vh] overflow-y-auto border-b border-border bg-card shadow-lg"
      >
        <!-- 文件夹选择区 -->
        <div v-if="folders.length === 0" class="px-4 py-8 text-center text-sm text-muted-foreground">
          {{ loading ? '正在同步…' : '暂无文件' }}
        </div>
        <template v-else>
          <!-- 文件夹选择标签 -->
          <div class="border-b border-border bg-muted/20 px-3 py-1 text-xs font-medium text-muted-foreground">
            文件夹
          </div>
          <div class="divide-y divide-border">
            <button
              v-for="folder in folders"
              :key="folder.id"
              type="button"
              class="flex w-full items-center gap-1.5 px-4 py-2 text-left transition-colors active:bg-accent"
              :class="selectedFolderId === folder.id ? 'bg-primary/5' : ''"
              @click="selectFolder(folder)"
            >
              <component
                :is="getProtocolIcon(folder.protocol || 'local')"
                class="size-3.5 shrink-0 text-muted-foreground"
              />
              <span class="truncate text-sm font-medium">{{ getFolderDisplayName(folder) }}</span>
              <span
                class="ml-auto flex h-[18px] w-[30px] shrink-0 items-center justify-center rounded text-[9px] font-bold leading-none tracking-wide"
                :class="getProtocolBadgeClass(folder.protocol || 'local')"
              >
                {{ getProtocolBadge(folder.protocol || 'local') }}
              </span>
            </button>
          </div>

          <!-- 选中文件夹的树形结构 -->
          <template v-if="selectedFolderId">
            <div class="border-t border-border bg-muted/20 px-3 py-1 text-xs font-medium text-muted-foreground">
              {{ getFolderDisplayName(selectedFolder!) }} 的文件
            </div>
            <FileTreeNode
              v-for="node in visibleTree"
              :key="node.id"
              :node="node"
              :depth="0"
              :expanded-dirs="expandedDirs"
              :selected-file="selectedFile"
              @toggle-dir="toggleDir"
              @select-file="onSelectFile"
            />
            <div v-if="visibleTree.length === 0" class="px-4 py-8 text-center text-sm text-muted-foreground">
              暂无文件
            </div>
          </template>
        </template>
      </div>
    </template>

    <!-- ════ 右侧/下方：文件预览区 ════ -->
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <!-- 预览区头部 -->
      <div v-if="selectedFile" class="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <div class="flex min-w-0 items-center gap-2">
          <component :is="getFileIcon(selectedFile)" class="size-4 shrink-0 text-muted-foreground" />
          <span class="truncate text-sm font-medium">{{ selectedFile.name }}</span>
        </div>
        <div class="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
          <span>{{ formatFileSize(selectedFile.size) }}</span>
          <span>{{ formatDateTime(selectedFile.mtime) }}</span>
        </div>
      </div>

      <!-- 预览区内容 -->
      <div class="min-h-0 flex-1 overflow-auto">
        <!-- 加载中 -->
        <div v-if="contentLoading" class="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
          <div class="flex items-center gap-1.5 text-muted-foreground">
            <span class="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" :style="{ animationDelay: '0ms' }" />
            <span class="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" :style="{ animationDelay: '150ms' }" />
            <span class="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" :style="{ animationDelay: '300ms' }" />
            <span class="ml-1 text-xs">加载中...</span>
          </div>
        </div>

        <!-- Markdown 文件内容（MdTtEditor，保留完整编辑能力） -->
        <div v-else-if="fileContent?.isText && fileContent.content" class="h-full">
          <MdTtEditor
            v-model="mdContent"
            :editable="mdEditable"
            placeholder="开始编辑..."
            class="h-full"
          />
        </div>

        <!-- 非文本文件 -->
        <div v-else-if="selectedFile && !contentLoading" class="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
          <component :is="getFileIcon(selectedFile)" class="size-12 text-muted-foreground/40" />
          <div>
            <p class="text-sm font-medium text-muted-foreground">无法预览此文件类型</p>
            <p class="mt-1 text-xs text-muted-foreground/70">{{ selectedFile.type || '未知' }} · {{ formatFileSize(selectedFile.size) }}</p>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-else class="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
          <Inbox class="size-12 text-muted-foreground/40" />
          <div>
            <p class="text-sm font-medium text-muted-foreground">选择一个文件预览</p>
            <p class="mt-1 text-xs text-muted-foreground/70">支持文本文件在线预览</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
