import { refreshSystem } from './api'
import { requireMemberOrIdentity } from './nav'

export async function ensureCurrentContext(): Promise<boolean> {
  if (!requireMemberOrIdentity()) return false
  try {
    const changed = await refreshSystem()
    if (!changed.system.initialized) {
      wx.reLaunch({ url: '/pages/setup/index' })
      return false
    }
    if (changed.instanceChanged || changed.epochChanged) {
      await new Promise<void>((resolve) => wx.showModal({
        title: '家庭数据已重新载入',
        content: '旧草稿和待确认意图不会自动重送。请先核对当前菜单，再重新选择需要的菜。',
        showCancel: false,
        complete: () => resolve(),
      }))
      wx.reLaunch({ url: '/pages/entry/index' })
      return false
    }
    return true
  } catch {
    // 读取系统失败不自动清除本机草稿或待确认意图；页面自行显示离线状态。
    return true
  }
}
