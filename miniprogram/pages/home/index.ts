import { ensureCurrentContext } from '../../utils/context'
import { get, post, ApiError } from '../../utils/api'
import type { MenuItem, MenuPage, MenuSummary, Vote, VoteEntry } from '../../utils/types'
import { showError } from '../../utils/nav'

const EMPTY_SUMMARY: MenuSummary = { date: '', counts: { pending: 0, cooking: 0, completed: 0, cancelled: 0 }, effectiveCount: 0, progress: null, rating: { average: null, count: 0 } }

Page({
  data: {
    avatarId: '', familyName: '', today: '', memberName: '', items: [] as MenuItem[], summary: EMPTY_SUMMARY,
    progressPercent: 0, unfinishedCount: 0, activeVote: null as Vote | null, latestVote: null as Vote | null,
    latestWinnerName: '', loading: true, offline: false,
  },
  async onShow() { if (await ensureCurrentContext()) await this.load() },
  async onPullDownRefresh() { await this.load(); wx.stopPullDownRefresh() },
  async load() {
    const app = getApp<IAppOption>()
    const system = app.globalData.system
    const member = app.globalData.member
    if (!system || !member) return
    this.setData({ familyName: system.familyName || '家庭点菜', today: system.today, memberName: member.name, avatarId: member.avatarMediaId || '', loading: true, offline: false })
    try {
      const [menuRes, unfinishedRes, voteRes] = await Promise.all([
        get<MenuPage>('/api/menu', { date: system.today, page_size: 10 }),
        get<{ items: MenuItem[]; nextCursor: string | null; total: number }>('/api/menu/unfinished', { page_size: 10 }),
        get<VoteEntry>('/api/votes/entry'),
      ])
      const summary = menuRes.data.summary
      const activeVote = voteRes.data.active
      const latestVote = voteRes.data.latestResult
      const latestWinner = (latestVote && latestVote.winnerDishId) ? (() => { const winner = latestVote.candidates.find((c) => c.dishId === latestVote.winnerDishId); return winner ? winner.dishName : '' })() : ''
      this.setData({
        items: menuRes.data.items,
        summary,
        progressPercent: summary.progress == null ? 0 : Math.round(summary.progress * 100),
        unfinishedCount: unfinishedRes.data.total,
        activeVote,
        latestVote,
        latestWinnerName: latestWinner,
      })
    } catch (error) {
      const e = error as ApiError
      if (e.network || e.status >= 500) this.setData({ offline: true })
      else showError(error)
    } finally { this.setData({ loading: false }) }
  },
  switchMember() { wx.navigateTo({ url: '/pages/identity/index' }) },
  goCatalog() { wx.switchTab({ url: '/pages/catalog/index' }) },
  openOverdue() { wx.navigateTo({ url: '/pages/overdue/index' }) },
  openMenu(e: WechatMiniprogram.TouchEvent) {
    const status = e.currentTarget.dataset.status || ''
    wx.navigateTo({ url: `/pages/menu/index?date=${encodeURIComponent(this.data.today)}${status ? `&status=${status}` : ''}` })
  },
  openItem(e: WechatMiniprogram.CustomEvent<{ id: string }>) { wx.navigateTo({ url: `/pages/item/index?id=${encodeURIComponent(e.detail.id)}` }) },
  async cardPrimary(e: WechatMiniprogram.CustomEvent<{ item: MenuItem }>) {
    const item = e.detail.item
    if (item.allowedActions.includes('claim')) {
      const confirm = await new Promise<boolean>((resolve) => wx.showModal({ title: '开始做这道菜？', content: `${this.data.memberName} 将认领“${item.dishName}”。`, success: (r) => resolve(r.confirm), fail: () => resolve(false) }))
      if (!confirm) return
      try { await post<MenuItem>(`/api/menu-items/${encodeURIComponent(item.id)}/claim`, { expectedRevision: item.revision }); await this.load() }
      catch (error) { showError(error); await this.load() }
    } else if (item.allowedActions.includes('review')) {
      wx.navigateTo({ url: `/pages/review/index?id=${encodeURIComponent(item.id)}` })
    } else {
      wx.navigateTo({ url: `/pages/item/index?id=${encodeURIComponent(item.id)}` })
    }
  },
  startVote() { wx.navigateTo({ url: '/pages/vote-form/index' }) },
  openVote(e: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: `/pages/vote/index?id=${encodeURIComponent(e.currentTarget.dataset.id)}` }) },
})
