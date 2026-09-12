import { request, uploadMedia } from '../../utils/api'
import type { Media } from '../../utils/types'
import { currentScope, makeLocalId } from '../../utils/storage'
import { getRecipeDraft, saveRecipeDraft, StepForm } from '../../utils/recipe-draft'
import { showError } from '../../utils/nav'
interface Imported { name:string; introduction:string; coverMediaId:string|null; steps:Array<{content:string;mediaId:string|null}>; media:Media[]; notice:string }
Page({
  previewStandalone(e:WechatMiniprogram.TouchEvent){const src=String(e.currentTarget.dataset.src||'');if(src)wx.previewImage({current:src,urls:[src]})},
  data:{shareText:'',name:'',text:'',files:[] as Array<{path:string;size:number}>,busy:false,message:''},
  field(e:WechatMiniprogram.Input|WechatMiniprogram.TextareaInput){this.setData({[String(e.currentTarget.dataset.field)]:e.detail.value} as any)},
  choose(){if(this.data.busy)return;wx.chooseMedia({count:9,mediaType:['image'],sizeType:['original'],sourceType:['album'],success:r=>{this.setData({files:[...this.data.files,...r.tempFiles.map(f=>({path:f.tempFilePath,size:f.size}))]})}})},
  remove(e:WechatMiniprogram.TouchEvent){if(this.data.busy)return;const i=Number(e.currentTarget.dataset.index);this.setData({files:this.data.files.filter((_f,n)=>n!==i)})},
  async confirmDraft():Promise<boolean>{if(!getRecipeDraft(''))return true;return new Promise(resolve=>wx.showModal({title:'替换尚未完成的新菜草稿？',content:'已有一份新菜草稿。确认后，导入成功的内容会替换这份草稿；失败时原草稿保留。',success:r=>resolve(r.confirm),fail:()=>resolve(false)}))},
  store(result:Imported,scope:string|null){
    if(scope!==currentScope())throw new Error('家庭或成员已切换，请重新导入')
    const steps:StepForm[]=result.steps.map(s=>({key:makeLocalId('step'),...s,media:result.media.find(m=>m.id===s.mediaId)||null,previewURL:'',sizeText:''}))
    saveRecipeDraft({id:'',revision:1,name:result.name,categoryId:'',estimatedMinutes:'',introduction:result.introduction,coverMediaId:result.coverMediaId,coverMedia:result.media.find(m=>m.id===result.coverMediaId)||null,steps,savedAt:Date.now()},scope)
    wx.redirectTo({url:'/pages/dish-form/index',fail:()=>{this.setData({message:'草稿已保存，但未能打开编辑页。请从“菜谱编辑草稿”继续编辑。'});wx.showToast({title:'草稿已保存，请到草稿列表打开',icon:'none'})}})
  },
  async importLink(){
    if(this.data.busy)return
    if(!this.data.shareText.trim()){this.setData({message:'请先将复制的小红书分享链接粘贴到上方输入框，再点击读取。'});wx.showToast({title:'请先粘贴分享链接',icon:'none'});return}
    this.setData({busy:true,message:'正在读取正文和图片，请稍候；最长等待两分钟。'})
    try{const scope=currentScope();if(!(await this.confirmDraft())){this.setData({message:'已取消导入，原草稿保留。'});return}
      const result=(await request<Imported>({path:'/api/recipe-imports',method:'POST',data:{shareText:this.data.shareText},timeout:120000})).data
      this.setData({message:'图文已读取，正在保存编辑草稿。'});this.store(result,scope)
    }catch(e){const message=e instanceof Error?e.message:'未能读取教程，请使用图片导入';this.setData({message});wx.showModal({title:'未能完成导入',content:message,showCancel:false})}finally{this.setData({busy:false})}
  },
  async importFiles(){
    if(this.data.busy)return
    const chars=Array.from([this.data.shareText,this.data.text].filter(Boolean).join('\n\n')),blocks:string[]=[]
    for(let i=0;i<chars.length;i+=2000)blocks.push(chars.slice(i,i+2000).join(''))
    if(!this.data.name.trim()||!this.data.files.length){wx.showToast({title:'请填写菜名并选择教程图片',icon:'none'});return}
    if(blocks.length+this.data.files.length>50||this.data.files.some(f=>!f.size||f.size>52428800)){wx.showToast({title:'最多 50 段，每张图片不超过 50 MiB',icon:'none'});return}
    const scope=currentScope();this.setData({busy:true,message:''})
    try{
      if(!(await this.confirmDraft()))return
      const media:Media[]=[]
      for(const file of this.data.files){if(scope!==currentScope())throw new Error('家庭或成员已切换');media.push(await uploadMedia(file.path).promise)}
      this.store({name:this.data.name.trim(),introduction:'从已保存教程图片导入；原分享内容保留在正文中。',coverMediaId:media[0].id,steps:[...blocks.map(content=>({content,mediaId:null})),...media.map((m,i)=>({content:`教程原图 ${i+1}（请查看图片内容）`,mediaId:m.id}))],media,notice:''},scope)
    }catch(e){showError(e)}finally{this.setData({busy:false})}
  },
})
