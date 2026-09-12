import { getPublic } from '../../utils/api'
import type { Member } from '../../utils/types'
import { chooseMember, showError } from '../../utils/nav'

interface MemberView extends Member { initial: string }
Page({
  data: { familyName: '', members: [] as MemberView[], loading: true },
  async onShow() {
    const app = getApp<IAppOption>()
    this.setData({ familyName: (app.globalData.system && app.globalData.system.familyName) || '' })
    try {
      const members = (await getPublic<Member[]>('/api/members')).data.filter((m) => m.active).map((m) => ({ ...m, initial: Array.from(m.name)[0] || '家' }))
      this.setData({ members })
    } catch (error) { showError(error) }
    finally { this.setData({ loading: false }) }
  },
  choose(e: WechatMiniprogram.TouchEvent) {
    const member = this.data.members.find((m) => m.id === e.currentTarget.dataset.id)
    if (!member) return
    chooseMember({ id: member.id, name: member.name, active: member.active })
    wx.switchTab({ url: '/pages/home/index' })
  },
  connect() { wx.navigateTo({ url: '/pages/connect/index' }) },
})
