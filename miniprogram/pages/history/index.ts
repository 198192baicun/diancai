import { ListLoader } from '../../utils/list'
import { ensureCurrentContext } from '../../utils/context'
import type { HistorySummary, PageResult } from '../../utils/types'
import { dateLabel, ratingText } from '../../utils/format'
import { showError } from '../../utils/nav'

interface DayView extends HistorySummary { dateLabel: string; names: string; ratingText: string }
Page({
  list: null as unknown as ListLoader<HistorySummary>,
  data: { nextCursor: null as string | null, listTotal: 0, avatarId: '', familyName: '', today: '', memberName: '', days: [] as DayView[], loading: true },
  async onShow() { if (await ensureCurrentContext()) await this.load() },
  async onPullDownRefresh() { await this.load(); wx.stopPullDownRefresh() },
  async onReachBottom() { if (!this.data.loading && this.data.nextCursor) await this.load(true) },
  async load(append = false) {
    if(!this.list)this.list=new ListLoader<HistorySummary>();

    const app = getApp<IAppOption>()
    this.setData({ familyName: (app.globalData.system && app.globalData.system.familyName) || '家庭点菜', today: (app.globalData.system && app.globalData.system.today) || '', memberName: (app.globalData.member && app.globalData.member.name) || '', avatarId: (app.globalData.member && app.globalData.member.avatarMediaId) || '', loading: true })
    try {
      const response = await this.list.read<PageResult<HistorySummary>>('/api/history', { page_size: 10 }, append)
      if (!response) return
      this.setData({ nextCursor: response.data.nextCursor, listTotal: response.data.total })
      const days = response.data.items.map((d) => ({ ...d, dateLabel: dateLabel(d.menuDate), names: d.itemNames.join('、'), ratingText: ratingText(d.rating.average) }))
      this.setData({ days })
    } catch (error) { showError(error) }
    finally { this.setData({ loading: this.list.loading }) }
  },
  openDay(e: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: `/pages/menu/index?date=${encodeURIComponent(e.currentTarget.dataset.date)}&view=archive` }) },
  switchMember() { wx.navigateTo({ url: '/pages/identity/index' }) },
})
