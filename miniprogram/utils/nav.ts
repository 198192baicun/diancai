import { setStoredMember } from './storage'

export function requireMemberOrIdentity(): boolean {
  const app = getApp<IAppOption>()
  if (app.globalData.member && app.globalData.member.active && app.globalData.system && app.globalData.system.initialized) return true
  wx.reLaunch({ url: '/pages/identity/index' })
  return false
}

export function chooseMember(member: DiancaiMember): void {
  const app = getApp<IAppOption>()
  app.globalData.member = member
  setStoredMember(member)
}

export function clearMember(): void {
  const app = getApp<IAppOption>()
  app.globalData.member = null
  setStoredMember(null)
}

export function showError(error: unknown, fallback = '暂时无法完成，请重试'): void {
  const e = error as { message?: string; code?: string }
  if (e && (e.code === 'DATA_EPOCH_CHANGED' || e.code === 'INSTANCE_CHANGED' || e.code === 'CONTEXT_REQUIRED')) {
    wx.showModal({
      title: '家庭数据已重新载入',
      content: '旧草稿和待确认意图不会自动重送。请先核对当前菜单，再重新选择需要的菜。',
      showCancel: false,
      complete: () => wx.reLaunch({ url: '/pages/entry/index' }),
    })
    return
  }
  if (e && e.code === 'MEMBER_INACTIVE') {
    clearMember()
    wx.showModal({
      title: '当前成员已停用',
      content: '请重新选择一位启用的家庭成员。',
      showCancel: false,
      complete: () => wx.reLaunch({ url: '/pages/identity/index' }),
    })
    return
  }
  wx.showToast({ title: (e && e.message) || fallback, icon: 'none', duration: 2800 })
}
