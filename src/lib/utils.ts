import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** shadcn-vue 依赖的类名合并工具 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 统一日期格式化：yyyyMMdd HH:mm（不显示秒）
 *
 * 使用场景：会话列表、最近连接、Agent 会话等时间展示。
 * 相对时间（刚刚 / x分钟前 / x小时前）由各 View 自行处理，
 * 超过相对时间范围后统一用本函数格式化。
 *
 * @param date Date 对象或可被 new Date() 解析的值
 * @returns 如 "08-30 14:05"
 */
export function formatDateTime(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date)
  const MM = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const HH = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${MM}-${dd} ${HH}:${mm}`
}
