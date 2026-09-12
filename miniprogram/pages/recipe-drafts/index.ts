import { listRecipeDrafts, removeRecipeDraft, RecipeDraft } from '../../utils/recipe-draft'
import { currentScope } from '../../utils/storage'
Page({
  data:{drafts:[] as RecipeDraft[]},
  scope:null as string|null,
  onShow(){this.scope=currentScope();this.setData({drafts:listRecipeDrafts(this.scope)})},
  open(e:WechatMiniprogram.TouchEvent){wx.navigateTo({url:`/pages/dish-form/index?id=${encodeURIComponent(e.currentTarget.dataset.id||'')}`})},
  remove(e:WechatMiniprogram.TouchEvent){
    const scope=this.scope,id=e.currentTarget.dataset.id
    if(!scope||scope!==currentScope()||typeof id!=='string')return
    const draft=this.data.drafts.find(d=>d.id===id)
    if(!draft)return
    wx.showModal({title:'删除这份草稿？',content:`“${draft.name||'未命名的新菜'}”的本机编辑内容将被删除，无法恢复。已保存的家庭菜谱不受影响。`,confirmText:'删除草稿',confirmColor:'#b42318',success:r=>{
      if(!r.confirm||scope!==currentScope()||scope!==this.scope)return
      try{
        removeRecipeDraft(id,scope)
        this.setData({drafts:listRecipeDrafts(scope)})
        wx.showToast({title:'草稿已删除',icon:'success'})
      }catch{wx.showToast({title:'删除失败，请重试',icon:'none'})}
    }})
  },
})
