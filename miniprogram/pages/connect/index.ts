import { connect } from '../../utils/api'
import { getBaseURL } from '../../utils/storage'
import { clearMember } from '../../utils/nav'

Page({
  data: { address: getBaseURL(), testing: false, error: '' },
  onAddress(e: WechatMiniprogram.Input) { this.setData({ address: e.detail.value }) },
  async testConnection() {
    if (this.data.testing) return
    this.setData({ testing: true, error: '' })
    try {
      const system = await connect(this.data.address)
      clearMember()
      if (system.initialized) wx.redirectTo({ url: '/pages/identity/index' })
      else wx.redirectTo({ url: '/pages/setup/index' })
    } catch (error) {
      this.setData({ error: (error as Error).message || '无法连接家庭服务' })
    } finally {
      this.setData({ testing: false })
    }
  },
})
