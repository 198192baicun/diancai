import {currentScope} from '../../utils/storage'
import { get, put } from '../../utils/api'
import type { MenuItem, PageResult, Review } from '../../utils/types'
import { showError } from '../../utils/nav'
Page({
  scope:null as string|null,
  data: { voiceMediaId:null as string|null, voiceBusy:false, id: '', item: null as MenuItem | null, stars: [1,2,3,4,5], rating: 0, comment: '', saving: false, alreadySubmitted: false },
  onLoad(query: Record<string,string|undefined>) { this.scope=currentScope();this.setData({ id: query.id || '' }) },
  async onShow() {
    if(this.scope!==currentScope()){this.scope=currentScope();this.setData({rating:0,comment:'',voiceMediaId:null,voiceBusy:false})}
    if (!this.data.id) return
    try {
      const item = (await get<MenuItem>(`/api/menu-items/${encodeURIComponent(this.data.id)}`)).data
      const reviews = (await get<PageResult<Review>>(`/api/menu-items/${encodeURIComponent(this.data.id)}/reviews`, { page_size: 10 })).data.items
      const mine = reviews.find((r) => r.memberId === ((getApp<IAppOption>().globalData.member || { id: '' }).id))
      this.setData({ item, alreadySubmitted: !!mine || !item.allowedActions.includes('review') })
    } catch (error) { showError(error) }
  },
  voiceChange(e:WechatMiniprogram.CustomEvent){this.setData({voiceMediaId:e.detail.mediaId});this.markDirty()},
  voiceBusy(e:WechatMiniprogram.CustomEvent){this.setData({voiceBusy:e.detail.busy})},
  rate(e: WechatMiniprogram.TouchEvent) { this.setData({ rating: Number(e.currentTarget.dataset.rating) }); this.markDirty() },
  commentInput(e: WechatMiniprogram.TextareaInput) { this.setData({ comment: e.detail.value }); this.markDirty() },
  markDirty() { try { wx.enableAlertBeforeUnload({ message: '评价尚未提交，确认离开？' }) } catch {} },
  async save() {
    if (this.data.voiceBusy || this.data.saving || !this.data.rating || !this.data.item || this.data.alreadySubmitted) return
    this.setData({ saving: true })
    try { await put<Review>(`/api/menu-items/${encodeURIComponent(this.data.item.id)}/my-review`, { rating: this.data.rating, comment: this.data.comment, voiceMediaId:this.data.voiceMediaId }); try { wx.disableAlertBeforeUnload() } catch {}; wx.navigateBack() }
    catch (error) { showError(error) }
    finally { this.setData({ saving: false }) }
  },
})
