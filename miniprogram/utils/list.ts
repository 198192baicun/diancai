import { get, ApiError } from './api'
import { currentScope } from './storage'
import type { ApiEnvelope, PageResult } from './types'

// 每个页面独立的分页状态；重置查询使较早请求失效。
export class ListLoader<T> {
  version: number
  loading: boolean
  cursor: string | null
  items: T[]
  scope: string | null

  // 避免预览编译产物保留运行环境不支持的类字段语法。
  constructor() {
    this.version = 0
    this.loading = false
    this.cursor = null
    this.items = []
    this.scope = null
  }
  async read<R extends PageResult<T>>(path: string, query: Record<string, string | number | boolean | null> = {}, append = false): Promise<ApiEnvelope<R> | null> {
    if (append && (this.loading || !this.cursor)) return null
    const scope = currentScope()
    if (append && scope !== this.scope) throw new ApiError('家庭或成员已切换，请刷新列表')
    const version = ++this.version
    this.scope = scope
    this.loading = true
    try {
      const response = await get<R>(path, { ...query, page_size: 10, cursor: append ? this.cursor : null })
      if (version !== this.version || scope !== currentScope()) return null
      this.items = append ? [...this.items, ...response.data.items] : response.data.items
      this.cursor = response.data.nextCursor
      return { ...response, data: { ...response.data, items: this.items } }
    } catch (error) {
      if (version !== this.version || scope !== currentScope()) return null
      throw error
    } finally { if (version === this.version) this.loading = false }
  }
  invalidate() { this.version++; this.loading = false }
}
