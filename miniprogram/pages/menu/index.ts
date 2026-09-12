import { ListLoader } from '../../utils/list'
import { post } from '../../utils/api'
import type { MenuItem, MenuPage, MenuSummary } from '../../utils/types'
import { showError } from '../../utils/nav'
import { dateLabel } from '../../utils/format'

const EMPTY: MenuSummary = { date: '', counts: { pending: 0, cooking: 0, completed: 0, cancelled: 0 }, effectiveCount: 0, progress: null, rating: { average: null, count: 0 } }
const STATUS_OPTIONS = [{ value: '', label: '全部' }, { value: 'pending', label: '待做' }, { value: 'cooking', label: '正在做' }, { value: 'completed', label: '已完成' }, { value: 'cancelled', label: '已取消' }]
Page({
  list: null as unknown as ListLoader<MenuItem>,
  loadVersion: 0,
  data: { nextCursor: null as string | null, listTotal: 0, statusOptions: STATUS_OPTIONS, statusIndex: 0, date: '', status: '', items: [] as MenuItem[], summary: EMPTY, total: 0, isPast: false, isArchive: false, loading: true },
  onLoad(query: Record<string, string | undefined>) {
    const statusOptions = query.view === 'archive' ? STATUS_OPTIONS.filter(o => !['pending', 'cooking'].includes(o.value)) : STATUS_OPTIONS
    const statusIndex = Math.max(0, statusOptions.findIndex(o => o.value === (query.status || '')))
    this.setData({ statusOptions, statusIndex })
    const date = query.date || ((getApp<IAppOption>().globalData.system || { today: '' }).today) || ''
    this.setData({ date, status: statusOptions[statusIndex].value, isPast: !!date && date < (((getApp<IAppOption>().globalData.system || { today: '' }).today) || date), isArchive: query.view === 'archive' })
    wx.setNavigationBarTitle({ title: date === ((getApp<IAppOption>().globalData.system || { today: '' }).today) ? '今日菜单' : `${dateLabel(date)} · 菜单` })
  },
  async onShow() { await this.load() },
  async onPullDownRefresh() { await this.load(); wx.stopPullDownRefresh() },
  async onReachBottom() { if (!this.data.loading && this.data.nextCursor) await this.load(true) },
  async load(append = false) {
    if(!this.list)this.list=new ListLoader<MenuItem>();

    const version = ++this.loadVersion
    this.setData({ loading: true })
    try {
      const response = await this.list.read<MenuPage>('/api/menu', { date: this.data.date, status: this.data.status || null, view: this.data.isArchive ? 'archive' : null, page_size: 10 }, append)
      if (!response) return
      this.setData({ nextCursor: response.data.nextCursor, listTotal: response.data.total })
      const s = response.data.summary
      if (version !== this.loadVersion) return
      this.setData({ items: response.data.items, summary: s, total: s.counts.pending + s.counts.cooking + s.counts.completed + s.counts.cancelled })
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
  openItem(e: WechatMiniprogram.CustomEvent<{ id: string }>) { wx.navigateTo({ url: `/pages/item/index?id=${encodeURIComponent(e.detail.id)}` }) },
  async cardPrimary(e: WechatMiniprogram.CustomEvent<{ item: MenuItem }>) {
    const item = e.detail.item
    if (item.allowedActions.includes('claim')) {
      const ok = await new Promise<boolean>((resolve) => wx.showModal({ title: '开始做这道菜？', content: `将认领“${item.dishName}”。`, success: (r) => resolve(r.confirm), fail: () => resolve(false) }))
      if (!ok) return
      try { await post<MenuItem>(`/api/menu-items/${encodeURIComponent(item.id)}/claim`, { expectedRevision: item.revision }); await this.load() } catch (error) { showError(error); await this.load() }
    } else if (item.allowedActions.includes('review')) wx.navigateTo({ url: `/pages/review/index?id=${encodeURIComponent(item.id)}` })
    else wx.navigateTo({ url: `/pages/item/index?id=${encodeURIComponent(item.id)}` })
  },
  repeat() { wx.navigateTo({ url: `/pages/repeat/index?date=${encodeURIComponent(this.data.date)}&archive=1` }) },
})
