import { ListLoader } from '../../utils/list'
import { post } from '../../utils/api'
import type { MenuItem, PageResult } from '../../utils/types'
import { showError } from '../../utils/nav'
Page({
  list: null as unknown as ListLoader<MenuItem>,
  data: { nextCursor: null as string | null, listTotal: 0, items: [] as MenuItem[], loading: true },
  async onShow() { await this.load() }, async onPullDownRefresh(){await this.load();wx.stopPullDownRefresh()},
  async onReachBottom(){if(!this.data.loading && this.data.nextCursor)await this.load(true)},
  async load(append=false){
    if(!this.list)this.list=new ListLoader<MenuItem>();
this.setData({loading:true});try{const response=await this.list.read<PageResult<MenuItem>>('/api/me/tasks',{},append);if(response)this.setData({items:response.data.items,nextCursor:response.data.nextCursor,listTotal:response.data.total})}catch(e){showError(e)}finally{this.setData({loading:this.list.loading})}},
  openItem(e:WechatMiniprogram.CustomEvent<{id:string}>){wx.navigateTo({url:`/pages/item/index?id=${encodeURIComponent(e.detail.id)}`})},
  async primary(e:WechatMiniprogram.CustomEvent<{item:MenuItem}>){const item=e.detail.item;if(item.allowedActions.includes('claim')){try{await post<MenuItem>(`/api/menu-items/${encodeURIComponent(item.id)}/claim`,{expectedRevision:item.revision});await this.load()}catch(err){showError(err);await this.load()}}else wx.navigateTo({url:`/pages/item/index?id=${encodeURIComponent(item.id)}`})},
})
