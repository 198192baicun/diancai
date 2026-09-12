import { ensureCurrentContext } from '../../utils/context'
import { get } from '../../utils/api'
import type { Category, Dish, PageResult, DraftItem } from '../../utils/types'
import { categoryTone, ratingText } from '../../utils/format'
import { loadMediaPreviewURL } from '../../utils/media'
import { getDraft, saveDraft, getPending, makeLocalId } from '../../utils/storage'
import { showError } from '../../utils/nav'
import { ListLoader } from '../../utils/list'

interface DishView extends Dish { categoryName: string; tone: string; ratingText: string; selectedCount: number; coverURL: string }
let searchTimer: number | undefined

Page({
  list: null as unknown as ListLoader<Dish>,
  data: {
    avatarId: '', familyName: '', today: '', memberName: '', categories: [] as Category[], dishes: [] as DishView[], q: '', categoryId: '',
    categoryIds: [''], categoryNames: ['全部分类'], categoryIndex: 0,
    loading: false, nextCursor: null as string | null, draftCount: 0, pending: false,
  },
  async onShow() {
    if (!(await ensureCurrentContext())) return
    const app = getApp<IAppOption>()
    this.setData({ familyName: (app.globalData.system && app.globalData.system.familyName) || '家庭点菜', today: (app.globalData.system && app.globalData.system.today) || '', memberName: (app.globalData.member && app.globalData.member.name) || '', avatarId: (app.globalData.member && app.globalData.member.avatarMediaId) || '' })
    await this.loadCategories()
    await this.loadDishes(true)
    this.refreshDraft()
  },
  async onPullDownRefresh() { await this.loadCategories(); await this.loadDishes(true); this.refreshDraft(); wx.stopPullDownRefresh() },
  async onReachBottom() { if (this.data.nextCursor && !this.data.loading) await this.loadDishes(false) },
  refreshDraft() {
    const draft = getDraft()
    this.setData({ draftCount: draft.length, pending: !!getPending() })
    this.setData({ dishes: this.data.dishes.map(d => ({ ...d, selectedCount: draft.filter(x => x.dishId === d.id).length })) })
  },
  async loadCategories() {
    try {
      const categories = (await get<Category[]>('/api/categories')).data
      const categoryIds = ['', ...categories.map((category) => category.id)]
      const categoryNames = ['全部分类', ...categories.map((category) => category.name)]
      const selectedIndex = categoryIds.indexOf(this.data.categoryId)
      const categoryIndex = selectedIndex >= 0 ? selectedIndex : 0
      this.setData({ categories, categoryIds, categoryNames, categoryIndex, categoryId: categoryIds[categoryIndex] })
    } catch (error) { showError(error) }
  },
  async loadDishes(reset: boolean) {
    if(!this.list)this.list=new ListLoader<Dish>();

    if (!reset && this.data.loading) return
    this.setData({ loading: true })
    try {
      const response = await this.list.read<PageResult<Dish>>('/api/dishes', { q: this.data.q, categoryId: this.data.categoryId || null, active: 'true' }, !reset)
      if (!response) return
      void this.decorateDishes(response.data.items)
      this.setData({ nextCursor: response.data.nextCursor })
    } catch (error) { showError(error) }
    finally { this.setData({ loading: this.list.loading }) }
  },
  async decorateDishes(raw: Array<Dish | DishView>) {
    const version = this.list.version
    const categories = this.data.categories
    const draft = getDraft()
    const views = raw.map((dish) => {
      const base = dish as Dish
      const category = categories.find((c) => c.id === base.categoryId)
      const categoryName = (category ? category.name : '') || (dish as DishView).categoryName || '其他'
      return { ...base, categoryName, tone: categoryTone(categoryName), ratingText: ratingText(base.rating.average, base.rating.count), selectedCount: draft.filter((d) => d.dishId === base.id).length, coverURL: '' }
    })
    this.setData({ dishes: views })
    await Promise.all(views.map(async (base) => {
      const coverURL = await loadMediaPreviewURL(base.coverMediaId)
      if (version === this.list.version) this.setData({ dishes: this.data.dishes.map(d => d.id === base.id ? { ...d, coverURL } : d) })
    }))
  },
  onUnload() { if (searchTimer) clearTimeout(searchTimer); if(this.list)this.list.invalidate() },
  onSearchInput(e: WechatMiniprogram.Input) {
    this.setData({ q: e.detail.value })
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => { void this.loadDishes(true) }, 350) as unknown as number
  },
  searchNow() { if (searchTimer) clearTimeout(searchTimer); void this.loadDishes(true) },
  categoryChange(e: WechatMiniprogram.PickerChange) {
    const categoryIndex = Number(e.detail.value)
    const categoryId = this.data.categoryIds[categoryIndex] || ''
    this.setData({ categoryIndex, categoryId })
    void this.loadDishes(true)
  },
  addDish(e: WechatMiniprogram.TouchEvent) {
    if (getPending()) { wx.navigateTo({ url: '/pages/draft/index' }); return }
    const draft = getDraft()
    if (draft.length >= 50) { wx.showToast({ title: '一次最多选择 50 条', icon: 'none' }); return }
    const dishId = String(e.currentTarget.dataset.id)
    const dishName = String(e.currentTarget.dataset.name)
    const next: DraftItem[] = [...draft, { localId: makeLocalId(), dishId, dishName, note: '', sourceItemId: null }]
    try { saveDraft(next); this.refreshDraft() } catch { wx.showToast({ title: '本机存储不可用，未加入草稿', icon: 'none' }) }
  },
  random() { wx.navigateTo({url:'/pages/random/index'}) },
  removeDish(e: WechatMiniprogram.TouchEvent) {
    if(getPending()) {this.openDraft();return}
    const draft=getDraft(), id=String(e.currentTarget.dataset.id);
    const matches=draft.filter(x=>x.dishId===id);
    if(!matches.length)return;
    const last=matches[matches.length-1];
    if(last.note || last.noteVoiceMediaId){this.openDraft();return}
    try{saveDraft(draft.filter(x=>x.localId!==last.localId));this.refreshDraft()}catch(e){showError(e)}
  },
  openDish(e: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: `/pages/dish/index?id=${encodeURIComponent(e.currentTarget.dataset.id)}` }) },
  openDraft() { wx.navigateTo({ url: '/pages/draft/index' }) },
  manage() { wx.navigateTo({ url: '/pages/manage/index' }) },
  switchMember() { wx.navigateTo({ url: '/pages/identity/index' }) },
})
