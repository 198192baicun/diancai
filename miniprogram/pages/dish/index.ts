import { ListLoader } from '../../utils/list'
import { get } from '../../utils/api'
import type { Category, Dish, Media, PageResult, Review, DraftItem } from '../../utils/types'
import { categoryTone, ratingText, joinURL, bytesText } from '../../utils/format'
import { getDraft, saveDraft, getPending, makeLocalId } from '../../utils/storage'
import { showError } from '../../utils/nav'
import { previewURLForMedia } from '../../utils/media'

interface ReviewView extends Review { starText: string }
interface StepView { id: string; content: string; mediaURL: string; mediaDownloadOnly: boolean; downloadURL: string }
Page({
  reviewList:null as unknown as ListLoader<Review>,imageVersion:0,
  data: {
    reviewCursor:null as string|null,reviewTotal:0,id: '', dish: null as Dish | null, categoryName: '', tone: 'other', ratingText: '', coverURL: '', coverMedia: null as Media | null, coverSize: '',
    steps: [] as StepView[], reviews: [] as ReviewView[], updatedDate: '',
  },
  onLoad(query: Record<string, string | undefined>) { this.setData({ id: query.id || '' }) },
  async onShow() { if (this.data.id) await this.load() },
  async load() {
    if(!this.reviewList)this.reviewList=new ListLoader<Review>()
    try {
      const [dishRes, catRes, reviewRes] = await Promise.all([
        get<Dish>(`/api/dishes/${encodeURIComponent(this.data.id)}`),
        get<Category[]>('/api/categories', { includeInactive: true }),
        this.reviewList.read<PageResult<Review>>(`/api/dishes/${encodeURIComponent(this.data.id)}/reviews`),
      ])
      const dish = dishRes.data
      const category = catRes.data.find((c) => c.id === dish.categoryId)
      const categoryName = category ? category.name : '其他'
      const steps:StepView[]=dish.steps.map(x=>({id:x.id,content:x.content,mediaURL:'',mediaDownloadOnly:false,downloadURL:''}))
      this.setData({
        dish, categoryName, tone: categoryTone(categoryName), ratingText: ratingText(dish.rating.average), coverMedia:null, coverURL:'',
        coverSize:'', steps, updatedDate: dish.updatedAt ? dish.updatedAt.slice(0, 10) : '',
        reviews: (reviewRes?reviewRes.data.items:[]).map((r) => ({ ...r, starText: `${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}` })),
      })
      this.setData({reviewCursor:reviewRes?reviewRes.data.nextCursor:null,reviewTotal:reviewRes?reviewRes.data.total:0})
      void this.loadImages(dish)
    } catch (error) { showError(error) }
  },
  onReachBottom(){if(this.data.reviewCursor)void this.moreReviews()},
  async moreReviews(){try{const r=await this.reviewList.read<PageResult<Review>>(`/api/dishes/${encodeURIComponent(this.data.id)}/reviews`,{},true);if(r)this.setData({reviews:r.data.items.map(x=>({...x,starText:'★'.repeat(x.rating)+'☆'.repeat(5-x.rating)})),reviewCursor:r.data.nextCursor,reviewTotal:r.data.total})}catch(e){showError(e)}},
  async loadImages(dish:Dish){
    const version=++this.imageVersion,baseURL=getApp<IAppOption>().globalData.baseURL
    if(dish.coverMediaId)void(async()=>{try{const media=(await get<Media>(`/api/media/${encodeURIComponent(dish.coverMediaId!)}`)).data;const coverURL=await previewURLForMedia(media);if(version===this.imageVersion)this.setData({coverMedia:media,coverURL,coverSize:bytesText(media.byteSize)})}catch{}})()
    await Promise.all(dish.steps.map(async step=>{if(!step.mediaId)return;try{const media=(await get<Media>(`/api/media/${encodeURIComponent(step.mediaId)}`)).data;const mediaURL=await previewURLForMedia(media);if(version===this.imageVersion)this.setData({steps:this.data.steps.map(x=>x.id===step.id?{...x,mediaURL,mediaDownloadOnly:media.previewPolicy==='download',downloadURL:joinURL(baseURL,media.downloadUrl)||''}:x)})}catch{}}))
  },
  previewImage(e:WechatMiniprogram.TouchEvent){const current=String(e.currentTarget.dataset.src);if(current)wx.previewImage({current,urls:this.data.steps.map(x=>x.mediaURL).filter(Boolean)})},
  onUnload(){this.imageVersion++;if(this.reviewList)this.reviewList.invalidate()},
  add() {
    const dish = this.data.dish
    if (!dish || !dish.active) return
    if (getPending()) { wx.navigateTo({ url: '/pages/draft/index' }); return }
    const draft = getDraft()
    if (draft.length >= 50) { wx.showToast({ title: '一次最多选择 50 条', icon: 'none' }); return }
    const item: DraftItem = { localId: makeLocalId(), dishId: dish.id, dishName: dish.name, note: '', sourceItemId: null }
    try { saveDraft([...draft, item]); wx.showToast({ title: '已加入已选菜品', icon: 'none' }) } catch { wx.showToast({ title: '本机存储不可用', icon: 'none' }) }
  },
  edit() { if (this.data.dish) wx.navigateTo({ url: `/pages/dish-form/index?id=${encodeURIComponent(this.data.dish.id)}` }) },
  copyCoverDownload() {
    const media = this.data.coverMedia
    if (!media) return
    const url = joinURL(getApp<IAppOption>().globalData.baseURL, media.downloadUrl)
    if (url) wx.setClipboardData({ data: url })
  },
  copyDownload(e: WechatMiniprogram.TouchEvent) { const url = e.currentTarget.dataset.url; if (url) wx.setClipboardData({ data: url }) },
})
