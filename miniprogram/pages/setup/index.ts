import { setup } from '../../utils/api'
import { clearMember, showError } from '../../utils/nav'

Page({
  data: { familyName: '幸福之家', membersText: '丈夫\n妻子', saving: false },
  onFamilyName(e: WechatMiniprogram.Input) { this.setData({ familyName: e.detail.value }) },
  onMembers(e: WechatMiniprogram.TextareaInput) { this.setData({ membersText: e.detail.value }) },
  async save() {
    const familyName = this.data.familyName.trim()
    const members = this.data.membersText.split('\n').map((v) => v.trim()).filter(Boolean)
    if (!familyName || members.length < 1 || members.length > 20) { wx.showToast({ title: '请填写家庭名与 1—20 位成员', icon: 'none' }); return }
    this.setData({ saving: true })
    try {
      await setup(familyName, members)
      clearMember()
      wx.redirectTo({ url: '/pages/identity/index' })
    } catch (error) { showError(error) }
    finally { this.setData({ saving: false }) }
  },
})
