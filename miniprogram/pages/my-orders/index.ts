import { ListLoader } from '../../utils/list'
import { ensureCurrentContext } from '../../utils/context'
import type { MenuItem, PageResult } from '../../utils/types'
import { showError } from '../../utils/nav'

const STATUS_OPTIONS = [{ value: 'all', label: '全部' }, { value: 'pending', label: '待做' }, { value: 'cooking', label: '正在做' }, { value: 'completed', label: '已完成' }, { value: 'cancelled', label: '已取消' }]
Page({
  list: null as unknown as ListLoader<MenuItem>,
  loadVersion: 0,
  data: { nextCursor: null as string | null, listTotal: 0, statusOptions: STATUS_OPTIONS, statusIndex: 0, items: [] as MenuItem[], loading: true, status: 'all' },
  async onShow() { if (await ensureCurrentContext()) await this.load() },
  async onPullDownRefresh() { await this.load(); wx.stopPullDownRefresh() },
  async onReachBottom() { if (!this.data.loading && this.data.nextCursor) await this.load(true) },
  async load(append = false) {
    if(!this.list)this.list=new ListLoader<MenuItem>();

    const version = ++this.loadVersion
    this.setData({ loading: true })
    try {
      const query: Record<string, string | number> = { page_size: 10 }
      if (this.data.status !== 'all') query.status = this.data.status
      const response = await this.list.read<PageResult<MenuItem>>('/api/me/orders', query, append)
      if (!response) return
      this.setData({ nextCursor: response.data.nextCursor, listTotal: response.data.total })
      if (version !== this.loadVersion) return
      this.setData({ items: response.data.items })
    } catch (error) { if (version === this.loadVersion) showError(error) }
    finally { if (version === this.loadVersion) this.setData({ loading: false }) }
  },
  filter(e: WechatMiniprogram.PickerChange) {
    const statusIndex = Number(e.detail.value)
    const option = this.data.statusOptions[statusIndex]
    if (!option || option.value === this.data.status) return
    this.setData({ statusIndex, status: option.value })
    void this.load()
  },
  open(e: WechatMiniprogram.CustomEvent<{ id: string }>) { wx.navigateTo({ url: `/pages/item/index?id=${encodeURIComponent(e.detail.id)}` }) },
  primary(e: WechatMiniprogram.CustomEvent<{ item: MenuItem }>) {
    const item = e.detail.item
    if (item.allowedActions && item.allowedActions.includes('claim') || item.allowedActions && item.allowedActions.includes('complete')) wx.navigateTo({ url: `/pages/item/index?id=${encodeURIComponent(item.id)}` })
    else if (item.allowedActions && item.allowedActions.includes('review')) wx.navigateTo({ url: `/pages/review/index?id=${encodeURIComponent(item.id)}` })
  },
})
