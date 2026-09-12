import { ListLoader } from '../../utils/list'
import { uploadMedia } from '../../utils/api'
import { get, post, patch } from '../../utils/api'
import type { Dish, Media, MenuItem, PageResult, Review, DraftItem } from '../../utils/types'
import { statusText } from '../../utils/format'
import { getDraft, saveDraft, getPending, makeLocalId, currentScope } from '../../utils/storage'
import { showError } from '../../utils/nav'
import { previewURLForMedia } from '../../utils/media'

interface StepView { id: string; content: string; mediaURL: string; mediaDownloadOnly: boolean }
interface ReviewView extends Review { starText: string }
Page({
  scope:null as string|null,
  reviewList:null as unknown as ListLoader<Review>,
  imageVersion:0,
  data: {
    voiceTouched:false, reviewCursor:null as string|null, voiceBusy:false, photoBusy:false, actionBusy:false, actionVoiceId:null as string|null, completionNote:'', photos:[] as string[],
    id: '', item: null as MenuItem | null, dish: null as Dish | null, statusLabel: '', isPast: false, steps: [] as StepView[], reviews: [] as ReviewView[], myReview: null as Review | null,
    canClaim: false, canComplete: false, canUnclaim: false, canNote: false, canCancel: false, canReview: false, canRepeat: false,
  },
  onLoad(query: Record<string, string | undefined>) { this.scope=currentScope();this.setData({ id: query.id || '' }) },
  async onShow() { if(this.scope!==currentScope()){this.scope=currentScope();this.setData({actionVoiceId:null,voiceTouched:false,photos:[],completionNote:'',voiceBusy:false})} if (this.data.id) await this.load() },
  async onPullDownRefresh() { await this.load(true); wx.stopPullDownRefresh() },
  async load(forceDish = false) {
    try {
      const item = (await get<MenuItem>(`/api/menu-items/${encodeURIComponent(this.data.id)}`)).data
      let dish = this.data.dish
      let steps = this.data.steps
      if (forceDish || !dish || dish.id !== item.dishId) {
        dish = (await get<Dish>(`/api/dishes/${encodeURIComponent(item.dishId)}`)).data
        steps = dish.steps.map(step=>({id:step.id,content:step.content,mediaURL:'',mediaDownloadOnly:false}))
      }
      if(!this.reviewList)this.reviewList=new ListLoader<Review>();
      const reviewPage = item.status === 'completed' ? await this.reviewList.read<PageResult<Review>>(`/api/menu-items/${encodeURIComponent(item.id)}/reviews`) : null;
      const reviews=reviewPage?reviewPage.data.items:[];this.setData({reviewCursor:reviewPage?reviewPage.data.nextCursor:null})
      const memberId = ((getApp<IAppOption>().globalData.member || { id: '' }).id)
      const myReview = reviews.find((r) => r.memberId === memberId) || null
      const a = item.allowedActions
      this.setData({ item, dish, steps, statusLabel: statusText[item.status], isPast: item.menuDate < (((getApp<IAppOption>().globalData.system || { today: '' }).today) || item.menuDate), reviews: reviews.map((r) => ({ ...r, starText: `${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}` })), myReview,
        canClaim: a.includes('claim'), canComplete: a.includes('complete'), canUnclaim: a.includes('unclaim'), canNote: a.includes('note'), canCancel: a.includes('cancel'), canReview: a.includes('review'), canRepeat: a.includes('repeat') })
      if(forceDish || !this.imagesLoaded){this.imagesLoaded=true;void this.loadImages(dish!)}
    } catch (error) { showError(error) }
  },
  onReachBottom(){void this.moreReviews()},
  async moreReviews(){if(!this.data.reviewCursor || !this.reviewList)return;try{const r=await this.reviewList.read<PageResult<Review>>(`/api/menu-items/${encodeURIComponent(this.data.id)}/reviews`,{},true);if(r)this.setData({reviews:r.data.items.map(x=>({...x,starText:'★'.repeat(x.rating)+'☆'.repeat(5-x.rating)})),reviewCursor:r.data.nextCursor})}catch(e){showError(e)}},
  voiceChange(e:WechatMiniprogram.CustomEvent){this.setData({actionVoiceId:e.detail.mediaId,voiceTouched:true})},
  voiceBusy(e:WechatMiniprogram.CustomEvent){this.setData({voiceBusy:e.detail.busy})},
  completionInput(e:WechatMiniprogram.TextareaInput){this.setData({completionNote:e.detail.value})},
  removePhoto(e:WechatMiniprogram.TouchEvent){this.setData({photos:this.data.photos.filter((_x,i)=>i!==Number(e.currentTarget.dataset.index))})},
  async choosePhotos(){if(this.data.photoBusy||this.data.photos.length>=9)return;const scope=currentScope();this.setData({photoBusy:true});try{const r=await new Promise<WechatMiniprogram.ChooseImageSuccessCallbackResult>((resolve,reject)=>wx.chooseImage({count:9-this.data.photos.length,sizeType:['original'],success:resolve,fail:reject}));for(const file of r.tempFiles){if(scope!==currentScope())return;if(file.size>52428800)throw new Error('单图不能超过 50 MiB');const m=await uploadMedia(file.path).promise;if(scope!==currentScope())return;this.setData({photos:[...this.data.photos,m.id]})}}catch(e){showError(e)}finally{this.setData({photoBusy:false})}},
  imagesLoaded:false,
  async loadImages(dish:Dish){const version=++this.imageVersion;await Promise.all(dish.steps.map(async step=>{if(!step.mediaId)return;try{const media=(await get<Media>(`/api/media/${encodeURIComponent(step.mediaId)}`)).data;const mediaURL=await previewURLForMedia(media);if(version===this.imageVersion)this.setData({steps:this.data.steps.map(x=>x.id===step.id?{...x,mediaURL,mediaDownloadOnly:media.previewPolicy==='download'}:x)})}catch{}}))},
  previewImage(e:WechatMiniprogram.TouchEvent){const current=String(e.currentTarget.dataset.src);if(current)wx.previewImage({current,urls:this.data.steps.map(x=>x.mediaURL).filter(Boolean)})},
  onUnload(){this.imageVersion++},
  async confirm(title: string, content: string): Promise<boolean> { return new Promise((resolve) => wx.showModal({ title, content, success: (r) => resolve(r.confirm), fail: () => resolve(false) })) },
  async action(path: string, title: string, content: string) {
    const item = this.data.item
    if (!item || this.data.voiceBusy || this.data.photoBusy || this.data.actionBusy || !(await this.confirm(title, content))) return
    this.setData({actionBusy:true})
    try { await post<MenuItem>(`/api/menu-items/${encodeURIComponent(item.id)}/${path}`, { expectedRevision: item.revision, ...(['claim','complete'].includes(path)?{voiceMediaId:this.data.actionVoiceId}:{}), ...(path==='complete'?{photoMediaIds:this.data.photos,completionNote:this.data.completionNote}:{}) }); this.setData({actionVoiceId:null,photos:[],completionNote:''}); await this.load() }
    catch (error) { showError(error); await this.load() }
    finally {this.setData({actionBusy:false})}
  },
  claim() { void this.action('claim', '开始做这道菜？', '认领后其他家人仍可查看做法。') },
  complete() { void this.action('complete', '确认已经做好？', '完成后家人可以评价，这条事项不能回到待做。') },
  unclaim() { void this.action('unclaim', '取消认领？', '这条事项将回到待做，其他家人可以接手。') },
  async cancel() {
    const item = this.data.item
    if (!item || this.data.voiceBusy || this.data.photoBusy || this.data.actionBusy) return
    const result = await new Promise<WechatMiniprogram.ShowModalSuccessCallbackResult | null>((resolve) => wx.showModal({
      title: item.status === 'cooking' ? '这次不做了？' : '取消这次点菜？',
      content: '取消本条并保留历史记录。可填写原因，也可以留空。', editable: true, placeholderText: '取消原因（选填）',
      success: (r) => resolve(r), fail: () => resolve(null),
    }))
    if (!result || !result.confirm) return
    try { await post<MenuItem>(`/api/menu-items/${encodeURIComponent(item.id)}/cancel`, { expectedRevision: item.revision, reason: result.content || '' }); await this.load() }
    catch (error) { showError(error); await this.load() }
  },
  async editNote() {
    const item = this.data.item
    if (!item || this.data.voiceBusy || this.data.photoBusy || this.data.actionBusy) return
    const result = await new Promise<WechatMiniprogram.ShowModalSuccessCallbackResult | null>((resolve) => wx.showModal({ title: '本次点菜备注', content: item.note, editable: true, placeholderText: '最多 200 字', success: (r) => resolve(r), fail: () => resolve(null) }))
    if (!result || !result.confirm) return
    try { await patch<MenuItem>(`/api/menu-items/${encodeURIComponent(item.id)}/note`, { note: result.content || '', voiceMediaId:this.data.voiceTouched?this.data.actionVoiceId:(item.noteVoiceMediaId||null), expectedRevision: item.revision }); await this.load() }
    catch (error) { showError(error); await this.load() }
  },
  review() { if (this.data.item) wx.navigateTo({ url: `/pages/review/index?id=${encodeURIComponent(this.data.item.id)}` }) },
  openDish() { if (this.data.item) wx.navigateTo({ url: `/pages/dish/index?id=${encodeURIComponent(this.data.item.dishId)}` }) },
  repeatOne() {
    const item = this.data.item
    if (!item || !this.data.canRepeat) return
    if (getPending()) { wx.navigateTo({ url: '/pages/draft/index' }); return }
    const draft = getDraft()
    if (draft.length >= 50) { wx.showToast({ title: '一次最多选择 50 条', icon: 'none' }); return }
    const next: DraftItem = { localId: makeLocalId(), dishId: item.dishId, dishName: item.dishName, note: item.note, sourceItemId: item.id }
    try { saveDraft([...draft, next]); wx.navigateTo({ url: '/pages/draft/index' }) } catch { wx.showToast({ title: '本机存储不可用', icon: 'none' }) }
  },
})
