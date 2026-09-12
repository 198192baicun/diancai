import { ListLoader } from '../../utils/list'
import { get, post } from '../../utils/api'
import type { Category, Dish, PageResult } from '../../utils/types'
import { categoryTone } from '../../utils/format'
import { loadMediaPreviewURL } from '../../utils/media'
import { showError } from '../../utils/nav'
interface DishView extends Dish {categoryName:string;tone:string;coverURL:string}
Page({
  list: null as unknown as ListLoader<Dish>,
  data:{nextCursor:null as string|null,listTotal:0,dishes:[] as DishView[],categories:[] as Category[],loading:true},
  async onShow(){await this.load()},async onPullDownRefresh(){await this.load();wx.stopPullDownRefresh()},
  async onReachBottom(){if(!this.data.loading&&this.data.nextCursor)await this.load(true)},
  async load(append=false){
    if(!this.list)this.list=new ListLoader<Dish>();

    this.setData({loading:true})
    try{
      const [d,c]=await Promise.all([this.list.read<PageResult<Dish>>('/api/dishes',{active:'all'},append),get<Category[]>('/api/categories',{includeInactive:true})])
      if(!d)return
      const categories=c.data,version=this.list.version
      const dishes=d.data.items.map(x=>{const cat=categories.find(k=>k.id===x.categoryId);const name=cat?cat.name:'其他';return{...x,categoryName:name,tone:categoryTone(name),coverURL:''}})
      this.setData({categories,dishes,nextCursor:d.data.nextCursor,listTotal:d.data.total})
      void Promise.all(dishes.map(async x=>{const coverURL=await loadMediaPreviewURL(x.coverMediaId);if(version===this.list.version)this.setData({dishes:this.data.dishes.map(d=>d.id===x.id?{...d,coverURL}:d)})}))
    }catch(e){showError(e)}finally{this.setData({loading:this.list.loading})}
  },
  importRecipe(){wx.navigateTo({url:'/pages/recipe-import/index'})},
  create(){wx.navigateTo({url:'/pages/dish-form/index'})},edit(e:WechatMiniprogram.TouchEvent){wx.navigateTo({url:`/pages/dish-form/index?id=${encodeURIComponent(e.currentTarget.dataset.id)}`})},
  async toggle(e:WechatMiniprogram.TouchEvent){const dish=this.data.dishes.find((d)=>d.id===e.currentTarget.dataset.id);if(!dish)return;const ok=await new Promise<boolean>((r)=>wx.showModal({title:dish.active?'下架这道菜？':'上架这道菜？',content:dish.active?'下架后不能新点；菜谱、已点事项和历史仍保留。':'上架后家庭成员可以选择这道菜。',success:x=>r(x.confirm),fail:()=>r(false)}));if(!ok)return;try{await post<Dish>(`/api/dishes/${encodeURIComponent(dish.id)}/status`,{active:!dish.active,expectedRevision:dish.revision});await this.load()}catch(err){showError(err);await this.load()}},
})
