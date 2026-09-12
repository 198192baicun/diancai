import { refreshSystem, getPublic } from '../../utils/api'
import type { Member } from '../../utils/types'
import { clearMember, chooseMember } from '../../utils/nav'

Page({
  async onLoad() {
    try {
      const { system, instanceChanged, epochChanged } = await refreshSystem()
      if (!system.initialized) {
        clearMember()
        wx.redirectTo({ url: '/pages/setup/index' })
        return
      }
      const members = (await getPublic<Member[]>('/api/members')).data
      const app = getApp<IAppOption>()
      const current = app.globalData.member ? members.find((m) => m.id === app.globalData.member!.id && m.active) : null
      if (current) chooseMember(current)
      else clearMember()
      if (instanceChanged || epochChanged) {
        await new Promise<void>((resolve) => wx.showModal({
          title: '家庭数据已重新载入',
          content: '旧草稿和待确认意图不会自动重送。请核对当前菜单，再重新选择需要的菜。',
          showCancel: false,
          success: () => resolve(),
          fail: () => resolve(),
        }))
      }
      if (current) wx.switchTab({ url: '/pages/home/index' })
      else wx.redirectTo({ url: '/pages/identity/index' })
    } catch {
      wx.redirectTo({ url: '/pages/connect/index' })
    }
  },
})
