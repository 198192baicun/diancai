import { ListLoader } from '../../utils/list'
import { get } from '../../utils/api'
import type { Dish, MenuItem, MenuPage, DraftItem } from '../../utils/types'
import { getDraft, saveDraft, getPending, makeLocalId } from '../../utils/storage'
import { showError } from '../../utils/nav'
interface RepeatView extends MenuItem { selected: boolean; available: boolean }
Page({
  list: null as unknown as ListLoader<MenuItem>,
  data: { nextCursor:null as string|null,listTotal:0, date: '', memberName: '', items: [] as RepeatView[], selectedCount: 0, archive: false },
  onLoad(query:Record<string,string|undefined>){this.setData({date:query.date||'',memberName:((getApp<IAppOption>().globalData.member || { name: '' }).name)||'',archive:query.archive==='1'})},
  async onShow(){if(!this.data.items.length)await this.load()},
  async onReachBottom(){if(!this.list.loading&&this.data.nextCursor)await this.load(true)},
  async load(append=false){
    if(!this.list)this.list=new ListLoader<MenuItem>();
try{
    const response=await this.list.read<MenuPage>('/api/menu',{date:this.data.date,view:this.data.archive?'archive':null},append)
    if(!response)return
    const version=this.list.version,availability=new Map<string,boolean>()
    await Promise.all(response.data.items.map(async item=>{if(availability.has(item.dishId))return;try{availability.set(item.dishId,(await get<Dish>(`/api/dishes/${encodeURIComponent(item.dishId)}`)).data.active)}catch{availability.set(item.dishId,false)}}))
    if(version!==this.list.version)return
    this.setData({items:response.data.items.map(i=>{const prior=this.data.items.find(x=>x.id===i.id);return{...i,note:prior?prior.note:i.note,selected:!!prior&&prior.selected,available:availability.get(i.dishId)===true}}),nextCursor:response.data.nextCursor,listTotal:response.data.total})
  }catch(e){showError(e)}},
  toggle(e:WechatMiniprogram.TouchEvent){const index=Number(e.currentTarget.dataset.index);const items=this.data.items.map((item,i)=>i===index&&item.available?{...item,selected:!item.selected}:item);this.setData({items,selectedCount:items.filter((i)=>i.selected).length})},
  noteInput(e:WechatMiniprogram.TextareaInput){const index=Number(e.currentTarget.dataset.index);this.setData({items:this.data.items.map((item,i)=>i===index?{...item,note:e.detail.value}:item)})},
  add(){if(getPending()){wx.navigateTo({url:'/pages/draft/index'});return}const selected=this.data.items.filter((i)=>i.selected&&i.available);const draft=getDraft();if(draft.length+selected.length>50){wx.showToast({title:'一次最多选择 50 条',icon:'none'});return}const next:DraftItem[]=[...draft,...selected.map((i)=>({localId:makeLocalId(),dishId:i.dishId,dishName:i.dishName,note:i.note,sourceItemId:i.id}))];try{saveDraft(next);wx.navigateTo({url:'/pages/draft/index'})}catch{wx.showToast({title:'本机存储不可用',icon:'none'})}},
})
