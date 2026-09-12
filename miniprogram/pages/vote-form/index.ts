import { ListLoader } from '../../utils/list'
import { get, post } from '../../utils/api'
import type { Category, Dish, PageResult, Vote } from '../../utils/types'
import { categoryTone } from '../../utils/format'
import { loadMediaPreviewURL } from '../../utils/media'
import { showError } from '../../utils/nav'
interface VoteDish extends Dish { selected:boolean; tone:string; coverURL:string }
Page({
  list: null as unknown as ListLoader<Dish>,
  data:{nextCursor:null as string|null,listTotal:0,title:'今晚吃什么？',dishes:[] as VoteDish[],selectedCount:0,saving:false},
  async onLoad(){await this.load()},
  async onReachBottom(){if(!this.list.loading&&this.data.nextCursor)await this.load(true)},
  async load(append=false){
    if(!this.list)this.list=new ListLoader<Dish>();

    try{
      const [dishRes,catRes]=await Promise.all([this.list.read<PageResult<Dish>>('/api/dishes',{active:'true'},append),get<Category[]>('/api/categories')])
      if(!dishRes)return
      const version=this.list.version
      const dishes=dishRes.data.items.map(d=>{const cat=catRes.data.find(c=>c.id===d.categoryId);const prior=this.data.dishes.find(x=>x.id===d.id);return{...d,selected:!!prior&&prior.selected,tone:categoryTone(cat?cat.name:'其他'),coverURL:''}})
      this.setData({dishes,nextCursor:dishRes.data.nextCursor,listTotal:dishRes.data.total})
      void Promise.all(dishes.map(async d=>{const coverURL=await loadMediaPreviewURL(d.coverMediaId);if(version===this.list.version)this.setData({dishes:this.data.dishes.map(x=>x.id===d.id?{...x,coverURL}:x)})}))
    }catch(e){showError(e)}
  },
  titleInput(e:WechatMiniprogram.Input){this.setData({title:e.detail.value})},
  toggle(e:WechatMiniprogram.TouchEvent){const i=Number(e.currentTarget.dataset.index);const current=this.data.dishes[i];if(!current)return;if(!current.selected&&this.data.selectedCount>=10){wx.showToast({title:'最多选择 10 道',icon:'none'});return}const dishes=this.data.dishes.map((d,n)=>n===i?{...d,selected:!d.selected}:d);this.setData({dishes,selectedCount:dishes.filter(d=>d.selected).length})},
  async save(){const dishIds=this.data.dishes.filter((d)=>d.selected).map((d)=>d.id);if(dishIds.length<2||dishIds.length>10)return;this.setData({saving:true});try{const vote=(await post<Vote>('/api/votes',{title:this.data.title,dishIds})).data;wx.redirectTo({url:`/pages/vote/index?id=${encodeURIComponent(vote.id)}`})}catch(e){showError(e)}finally{this.setData({saving:false})}},
})
