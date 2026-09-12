import type { Status } from './types'

export const statusText: Record<Status, string> = {
  pending: '待做',
  cooking: '正在做',
  completed: '已完成',
  cancelled: '已取消',
}

export function dateLabel(date: string): string {
  const parts = date.split('-')
  return parts.length === 3 ? `${Number(parts[1])} 月 ${Number(parts[2])} 日` : date
}

export function ratingText(value: number | null, count = 0): string {
  return value == null ? '未评价' : `★ ${value.toFixed(1)}${count ? ` · ${count} 条评价` : ''}`
}

export function bytesText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`
}

export function categoryTone(name: string): string {
  if (name.includes('荤')) return 'braise'
  if (name.includes('素') || name.includes('凉')) return 'green'
  if (name.includes('汤')) return 'soup'
  if (name.includes('主食')) return 'rice'
  return 'other'
}

export function joinURL(baseURL: string, maybePath: string | null): string | null {
  if (!maybePath) return null
  if (/^https?:\/\//i.test(maybePath)) return maybePath
  return `${baseURL.replace(/\/$/, '')}${maybePath.startsWith('/') ? '' : '/'}${maybePath}`
}
