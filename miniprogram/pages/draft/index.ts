import { ensureCurrentContext } from '../../utils/context'
import { request, refreshSystem, ApiError } from '../../utils/api'
import type { DraftItem, PendingIntent, Receipt } from '../../utils/types'
import { getDraft, saveDraft, getPending, savePending, clearPending, clearDraft, uuidV4, currentScope, scopeForIntent } from '../../utils/storage'
import { showError } from '../../utils/nav'

Page({
  data: { voiceBusy:false, memberName: '', targetDate: '', items: [] as DraftItem[], pending: null as PendingIntent | null, submitting: false },
  async onShow() {
    if (!(await ensureCurrentContext())) return
    const app = getApp<IAppOption>()
    const pending = getPending()
    this.setData({ memberName: (app.globalData.member && app.globalData.member.name) || '', targetDate: (pending && pending.targetDate) || (app.globalData.system && app.globalData.system.today) || '', items: getDraft(), pending })
  },
  voiceBusy(e:WechatMiniprogram.CustomEvent){this.setData({voiceBusy:e.detail.busy})},
  voiceChange(e:WechatMiniprogram.CustomEvent){if(this.data.pending)return;const index=Number(e.currentTarget.dataset.index);const items=this.data.items.map((x,i)=>i===index?{...x,noteVoiceMediaId:e.detail.mediaId}:x);try{saveDraft(items);this.setData({items})}catch(e){showError(e)}},
  noteInput(e: WechatMiniprogram.TextareaInput) {
    if (this.data.pending) return
    const index = Number(e.currentTarget.dataset.index)
    const items = this.data.items.map((item, i) => i === index ? { ...item, note: e.detail.value } : item)
    try { saveDraft(items); this.setData({ items }) } catch { wx.showToast({ title: '本机存储不足，备注未保存', icon: 'none' }) }
  },
  remove(e: WechatMiniprogram.TouchEvent) {
    if (this.data.pending) return
    const index = Number(e.currentTarget.dataset.index)
    const items = this.data.items.filter((_item, i) => i !== index)
    try { saveDraft(items); this.setData({ items }) } catch { wx.showToast({ title: '本机存储不可用', icon: 'none' }) }
  },
  buildIntent(): PendingIntent | null {
    const app = getApp<IAppOption>()
    const system = app.globalData.system
    const member = app.globalData.member
    if (!(system && system.instanceId) || !system.dataEpoch || !member || !this.data.items.length) return null
    return {
      key: uuidV4(), baseURL: app.globalData.baseURL, instanceId: system.instanceId, dataEpoch: system.dataEpoch,
      memberId: member.id, targetDate: system.today,
      items: this.data.items.map((item) => ({ dishId: item.dishId, note: item.note, ...(item.noteVoiceMediaId?{noteVoiceMediaId:item.noteVoiceMediaId}:{}), sourceItemId: item.sourceItemId })),
      createdAt: Date.now(),
    }
  },
  requestHeaders(intent: PendingIntent): Record<string, string> {
    return { 'X-Member-Id': intent.memberId, 'X-Instance-Id': intent.instanceId, 'X-Data-Epoch': intent.dataEpoch, 'X-Idempotency-Key': intent.key }
  },
  sendIntent(intent: PendingIntent) {
    return request<Receipt>({
      path: '/api/menu/batches', method: 'POST', baseURL: intent.baseURL, write: false, includeMember: false,
      headers: this.requestHeaders(intent), data: { targetDate: intent.targetDate, items: intent.items },
    })
  },
  receiptFor(intent: PendingIntent) {
    return request<Receipt>({
      path: `/api/menu/batches/receipts/${encodeURIComponent(intent.key)}`, method: 'GET', baseURL: intent.baseURL,
      write: false, includeMember: false, headers: this.requestHeaders(intent),
    })
  },
  async submit() {
    if (this.data.voiceBusy || this.data.submitting || this.data.pending) return
    const intent = this.buildIntent()
    if (!intent) return
    const scope = scopeForIntent(intent)
    try {
      savePending(intent, scope)
    } catch {
      wx.showModal({ title: '尚未发送', content: '本机存储不可用，无法安全保存提交凭据。请释放存储空间后重试。', showCancel: false })
      return
    }
    this.setData({ pending: intent, targetDate: intent.targetDate, submitting: true })
    try {
      const response = await this.sendIntent(intent)
      this.finishSuccess(response.data, intent)
    } catch (error) {
      await this.handleSubmitError(error, intent)
    } finally { this.setData({ submitting: false }) }
  },
  async reconcile() {
    const intent = this.data.pending
    if (!intent || this.data.submitting) return
    this.setData({ submitting: true })
    try {
      try {
        const receipt = await this.receiptFor(intent)
        this.finishSuccess(receipt.data, intent)
        return
      } catch (error) {
        const e = error as ApiError
        if (e.code !== 'RECEIPT_NOT_FOUND') throw error
      }
      // 查无回执不代表可以换 Key；只重试完全相同、同成员、同实例、同代次的原意图。
      const response = await this.sendIntent(intent)
      this.finishSuccess(response.data, intent)
    } catch (error) {
      await this.handleSubmitError(error, intent)
    } finally { this.setData({ submitting: false }) }
  },
  finishSuccess(receipt: Receipt, intent: PendingIntent) {
    const scope = scopeForIntent(intent)
    clearDraft(scope)
    clearPending(scope)
    // 迟到响应只清理它自己的提交作用域，绝不改写当前已切换成员的草稿或页面。
    if (currentScope() !== scope) return
    this.setData({ pending: null, items: [] })
    wx.redirectTo({ url: `/pages/menu/index?date=${encodeURIComponent(receipt.targetDate)}` })
  },
  async handleSubmitError(error: unknown, intent: PendingIntent) {
    const e = error as ApiError
    const scope = scopeForIntent(intent)
    if (e.code === 'DATA_EPOCH_CHANGED' || e.code === 'INSTANCE_CHANGED') {
      const belongsToPage = currentScope() === scope
      if (!belongsToPage) return
      try { await refreshSystem() } catch { /* 保留旧意图 */ }
      const app = getApp<IAppOption>()
      if (app.globalData.baseURL === intent.baseURL && app.globalData.member && app.globalData.member.id === intent.memberId) {
        wx.showModal({
          title: '家庭数据已重新载入',
          content: '旧提交意图不会自动重送。请核对当前菜单后重新选择需要的菜。原待确认凭据仍按旧数据代次保留在本机。',
          showCancel: false,
          complete: () => wx.reLaunch({ url: '/pages/entry/index' }),
        })
      }
      return
    }
    if (e.responseIsDefinite) {
      clearPending(scope)
      if (currentScope() !== scope) return
      this.setData({ pending: null })
      if (e.code === 'DATE_CHANGED') {
        try {
          const refreshed = await refreshSystem()
          this.setData({ targetDate: refreshed.system.today })
        } catch { /* 页面仍保留原草稿 */ }
        wx.showModal({ title: '原日期提交已被明确拒绝', content: '草稿仍保留。请确认新的家庭日期后重新提交，届时会生成新的提交凭据。', showCancel: false })
        return
      }
      showError(error)
      return
    }
    if (currentScope() === scope) wx.showModal({ title: '提交结果尚未确认', content: '可能已经写入服务端，也可能尚未执行。请保留当前页面，恢复连接后使用同一提交凭据确认结果。', showCancel: false })
  },
  goCatalog() { wx.switchTab({ url: '/pages/catalog/index' }) },
})
