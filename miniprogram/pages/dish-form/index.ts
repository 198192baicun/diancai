import { get, post, put, uploadMedia, ApiError } from '../../utils/api'
import type { Category, Dish, Media } from '../../utils/types'
import { bytesText, joinURL } from '../../utils/format'
import { makeLocalId, currentScope } from '../../utils/storage'
import { showError } from '../../utils/nav'
import { previewURLForMedia, loadMediaPreviewURL } from '../../utils/media'

import { StepForm, getRecipeDraft, saveRecipeDraft, removeRecipeDraft } from '../../utils/recipe-draft'
interface ConflictField { key:string; label:string; localText:string; remoteText:string; choice:string; localImages:string[]; remoteImages:string[] }

Page({
  previewStandalone(e:WechatMiniprogram.TouchEvent){const src=String(e.currentTarget.dataset.src||'');if(src)wx.previewImage({current:src,urls:[src]})},
  scope:null as string|null,closed:false,activeUploadTask:null as WechatMiniprogram.UploadTask|null,
  data:{voiceBusy:false,voiceMediaId:null as string|null,loading:true,draftStatus:'',latest:null as Dish|null,conflicts:[] as ConflictField[],mergeReady:false,
    id:'',revision:1,name:'',categoryId:'',estimatedMinutes:'',introduction:'',categories:[] as Category[],categoryIds:[] as string[],categoryNames:[] as string[],categoryIndex:0,
    coverMediaId:null as string|null,coverMedia:null as Media|null,coverPreviewURL:'',coverPreviewUnavailable:false,coverSize:'',steps:[] as StepForm[],saving:false,uploading:false,uploadPercent:0,dirty:false,
  },
  onLoad(query:Record<string,string|undefined>){this.scope=currentScope();this.setData({id:query.id||''});wx.setNavigationBarTitle({title:query.id?'编辑公共菜品':'新建公共菜品'});void this.load()},
  belongs(){return !this.closed&&!!this.scope&&currentScope()===this.scope},
  onUnload(){this.closed=true;if(this.activeUploadTask)this.activeUploadTask.abort()},
  refreshCategories(){const cats=this.data.categories.filter(c=>c.active||c.id===this.data.categoryId);const categoryIds=cats.map(c=>c.id),categoryNames=cats.map(c=>c.name+(c.active?'':'（停用）'));const categoryId=this.data.categoryId||categoryIds[0]||'';this.setData({categoryIds,categoryNames,categoryId,categoryIndex:Math.max(0,categoryIds.indexOf(categoryId))})},
  async load(){
    try{
      const draft=getRecipeDraft(this.data.id,this.scope)
      if(draft){this.setData({...draft,dirty:true,draftStatus:'已恢复本机草稿'});this.alertUnsaved()}
      const categories=(await get<Category[]>('/api/categories',{includeInactive:true})).data
      if(!this.belongs())return
      this.setData({categories})
      if(this.data.id){const dish=(await get<Dish>(`/api/dishes/${encodeURIComponent(this.data.id)}`)).data;if(!this.belongs())return
        if(!draft)this.setData({revision:dish.revision,name:dish.name,categoryId:dish.categoryId,estimatedMinutes:dish.estimatedMinutes==null?'':String(dish.estimatedMinutes),introduction:dish.introduction,voiceMediaId:dish.voiceMediaId||null,coverMediaId:dish.coverMediaId,steps:dish.steps.map(x=>({key:x.id,content:x.content,mediaId:x.mediaId,media:null,previewURL:'',sizeText:''}))})
        else if(draft.revision!==dish.revision)this.showConflict(dish)
      }
      this.refreshCategories();void this.loadImages()
    }catch(e){if(this.belongs())showError(e)}finally{this.setData({loading:false})}
  },
  async loadImages(){
    const coverId=this.data.coverMediaId
    if(coverId)void (async()=>{try{const media=(await get<Media>(`/api/media/${encodeURIComponent(coverId)}`)).data;const url=await previewURLForMedia(media);if(this.belongs()&&this.data.coverMediaId===coverId)this.setData({coverMedia:media,coverPreviewURL:url,coverSize:bytesText(media.byteSize)})}catch{}})()
    await Promise.all(this.data.steps.map(async step=>{if(!step.mediaId)return;try{const media=(await get<Media>(`/api/media/${encodeURIComponent(step.mediaId)}`)).data;const previewURL=await previewURLForMedia(media);if(this.belongs())this.setData({steps:this.data.steps.map(x=>x.key===step.key&&x.mediaId===media.id?{...x,media,previewURL,sizeText:bytesText(media.byteSize)}:x)})}catch{}}))
  },
  alertUnsaved(){try{wx.enableAlertBeforeUnload({message:'修改尚未保存到家庭菜谱，确认离开？'})}catch{}},
  markDirty(){
    if(!this.belongs())return
    this.setData({dirty:true});this.alertUnsaved();const d=this.data
    try{saveRecipeDraft({id:d.id,revision:d.revision,name:d.name,categoryId:d.categoryId,estimatedMinutes:d.estimatedMinutes,introduction:d.introduction,voiceMediaId:d.voiceMediaId,coverMediaId:d.coverMediaId,coverMedia:d.coverMedia,steps:d.steps,savedAt:Date.now()},this.scope);this.setData({draftStatus:'已保存到本机草稿'})}catch{this.setData({draftStatus:'本机存储不足，修改尚未保存，请勿关闭页面'})}
  },
  showConflict(latest:Dish){
    const d=this.data
    const local:Record<string,any>={name:d.name,categoryId:d.categoryId,estimatedMinutes:d.estimatedMinutes,introduction:d.introduction,voiceMediaId:d.voiceMediaId,coverMediaId:d.coverMediaId,steps:d.steps.map(x=>({content:x.content,mediaId:x.mediaId}))}
    const remote:Record<string,any>={...latest,estimatedMinutes:latest.estimatedMinutes==null?'':String(latest.estimatedMinutes),steps:latest.steps.map(x=>({content:x.content,mediaId:x.mediaId}))}
    const labels:Record<string,string>={name:'菜名',categoryId:'分类',estimatedMinutes:'时长',introduction:'简介',voiceMediaId:'简介语音',coverMediaId:'封面',steps:'步骤与图片'}
    const describe=(key:string,value:any):string=>key==='steps'?value.map((x:any,i:number)=>`${i+1}. ${x.content}${x.mediaId?'（附图）':''}`).join('\n'):key==='categoryId'?(d.categories.find(x=>x.id===value)||{name:'未选择'}).name:key==='coverMediaId'?(value?'已选择图片':'无图片'):key==='voiceMediaId'?(value?'已保存语音':'无语音'):String(value||'')
    const conflicts=Object.keys(local).filter(k=>JSON.stringify(local[k])!==JSON.stringify(remote[k])).map(key=>({key,label:labels[key],localText:describe(key,local[key]),remoteText:describe(key,remote[key]),choice:'',localVoiceId:key==='voiceMediaId'?local[key]:null,remoteVoiceId:key==='voiceMediaId'?remote[key]:null,localImages:[] as string[],remoteImages:[] as string[]}))
    this.setData({latest,conflicts,mergeReady:conflicts.length===0})
    const imageIds=(key:string,value:any):Array<string|null>=>key==='coverMediaId'?[value]:key==='steps'?value.map((x:any)=>x.mediaId):[]
    void Promise.all(conflicts.map(async f=>{const localImages=await Promise.all(imageIds(f.key,local[f.key]).map(loadMediaPreviewURL));const remoteImages=await Promise.all(imageIds(f.key,remote[f.key]).map(loadMediaPreviewURL));if(this.belongs()&&this.data.latest&&this.data.latest.revision===latest.revision)this.setData({conflicts:this.data.conflicts.map(x=>x.key===f.key?{...x,localImages:localImages.filter(Boolean),remoteImages:remoteImages.filter(Boolean)}:x)})}))
  },
  chooseConflict(e:WechatMiniprogram.TouchEvent){const key=String(e.currentTarget.dataset.key),choice=String(e.currentTarget.dataset.choice);const conflicts=this.data.conflicts.map(f=>f.key===key?{...f,choice}:f);this.setData({conflicts,mergeReady:conflicts.every(f=>!!f.choice)})},
  mergeConflict(){
    const latest=this.data.latest;if(!latest||!this.data.mergeReady)return
    const values:Record<string,any>={revision:latest.revision,latest:null,conflicts:[],mergeReady:false}
    for(const f of this.data.conflicts){if(f.choice!=='remote')continue
      if(f.key==='steps')values.steps=latest.steps.map(x=>({key:x.id,content:x.content,mediaId:x.mediaId,media:null,previewURL:'',sizeText:''}))
      else if(f.key==='estimatedMinutes')values.estimatedMinutes=latest.estimatedMinutes==null?'':String(latest.estimatedMinutes)
      else values[f.key]=(latest as any)[f.key]
      if(f.key==='coverMediaId'){values.coverMedia=null;values.coverPreviewURL='';values.coverSize=''}
    }
    this.setData(values);this.refreshCategories();this.markDirty();void this.loadImages()
  },
  fieldInput(e:WechatMiniprogram.Input|WechatMiniprogram.TextareaInput){const field=String(e.currentTarget.dataset.field);this.setData({[field]:e.detail.value} as any);this.markDirty()},
  categoryChange(e:WechatMiniprogram.PickerChange){const index=Number(e.detail.value);this.setData({categoryIndex:index,categoryId:this.data.categoryIds[index]||''});this.markDirty()},
  addStep(){if(this.data.steps.length>=50){wx.showToast({title:'最多 50 个步骤',icon:'none'});return}this.setData({steps:[...this.data.steps,{key:makeLocalId('step'),content:'',mediaId:null,media:null,previewURL:'',sizeText:''}]});this.markDirty()},
  stepInput(e:WechatMiniprogram.TextareaInput){const index=Number(e.currentTarget.dataset.index);this.setData({steps:this.data.steps.map((s,i)=>i===index?{...s,content:e.detail.value}:s)});this.markDirty()},
  removeStep(e:WechatMiniprogram.TouchEvent){const index=Number(e.currentTarget.dataset.index);this.setData({steps:this.data.steps.filter((_s,i)=>i!==index)});this.markDirty()},
  stepUp(e:WechatMiniprogram.TouchEvent){const index=Number(e.currentTarget.dataset.index);if(index<=0)return;const steps=[...this.data.steps];[steps[index-1],steps[index]]=[steps[index],steps[index-1]];this.setData({steps});this.markDirty()},
  voiceChange(e:WechatMiniprogram.CustomEvent){this.setData({voiceMediaId:e.detail.mediaId});this.markDirty()},
  voiceBusy(e:WechatMiniprogram.CustomEvent){this.setData({voiceBusy:e.detail.busy})},
  removeCover(){this.setData({coverMediaId:null,coverMedia:null,coverPreviewURL:'',coverPreviewUnavailable:false,coverSize:''});this.markDirty()},
  removeStepMedia(e:WechatMiniprogram.TouchEvent){const index=Number(e.currentTarget.dataset.index);this.setData({steps:this.data.steps.map((s,i)=>i===index?{...s,mediaId:null,media:null,previewURL:'',sizeText:''}:s)});this.markDirty()},
  chooseMedia(e:WechatMiniprogram.TouchEvent){if(this.data.uploading)return;const target=String(e.currentTarget.dataset.target);const step=this.data.steps[Number(e.currentTarget.dataset.index)];const index=step?step.key:'';wx.showActionSheet({itemList:['相册/相机原图','微信文件'],success:(r)=>{if(r.tapIndex===0)this.pickAlbum(target,index);else this.pickMessage(target,index)}})},
  pickAlbum(target:string,index:string){wx.chooseMedia({count:1,mediaType:['image'],sourceType:['album','camera'],sizeType:['original'],success:(r)=>{const f=r.tempFiles[0];if(f)this.confirmUpload(target,index,f.tempFilePath,f.size)}})},
  pickMessage(target:string,index:string){wx.chooseMessageFile({count:1,type:'all',success:(r)=>{const f=r.tempFiles[0];if(f)this.confirmUpload(target,index,f.path,f.size)}})},
  confirmUpload(target:string,index:string,path:string,size:number){if(!size||size>52428800){wx.showToast({title:size?'文件超过 50 MiB':'空文件不能上传',icon:'none'});return}wx.showModal({title:'保存原文件',content:'服务端会按原字节保存，不压缩、不转码、不清除元数据。原图可能包含设备与位置信息。继续上传？',success:(r)=>{if(r.confirm)void this.upload(target,index,path)}})},
  async upload(target:string,index:string,path:string){if(this.data.uploading||!this.belongs())return;this.setData({uploading:true,uploadPercent:0});try{const handle=uploadMedia(path,(p)=>{if(this.belongs())this.setData({uploadPercent:p})});this.activeUploadTask=handle.task;const media=await handle.promise;if(!this.belongs())return;const previewURL=media.previewPolicy==='inline'?path:(joinURL(getApp<IAppOption>().globalData.baseURL,media.contentUrl)||'');if(target==='cover')this.setData({coverMediaId:media.id,coverMedia:media,coverPreviewURL:previewURL,coverPreviewUnavailable:false,coverSize:bytesText(media.byteSize)});else if(index)this.setData({steps:this.data.steps.map(s=>s.key===index?{...s,mediaId:media.id,media,previewURL,sizeText:bytesText(media.byteSize)}:s)});this.markDirty()}catch(e){showError(e)}finally{this.activeUploadTask=null;this.setData({uploading:false,uploadPercent:0})}},
  coverPreviewError(){this.setData({coverPreviewUnavailable:true})},
  cancelUpload(){if (this.activeUploadTask) this.activeUploadTask.abort()},
  async save(){if(this.data.voiceBusy||this.data.saving||this.data.uploading||this.data.loading||this.data.latest||!this.belongs())return;const name=this.data.name.trim();if(!name||!this.data.categoryId){wx.showToast({title:'请填写菜名和分类',icon:'none'});return}if(this.data.steps.some((s)=>!s.content.trim())){wx.showToast({title:'每个步骤都需要正文',icon:'none'});return}const body={name,categoryId:this.data.categoryId,estimatedMinutes:this.data.estimatedMinutes===''?null:Number(this.data.estimatedMinutes),introduction:this.data.introduction,voiceMediaId:this.data.voiceMediaId,coverMediaId:this.data.coverMediaId,steps:this.data.steps.map((s)=>({content:s.content,mediaId:s.mediaId}))};this.setData({saving:true});try{let dish:Dish;if(this.data.id)dish=(await put<Dish>(`/api/dishes/${encodeURIComponent(this.data.id)}`,{...body,expectedRevision:this.data.revision})).data;else dish=(await post<Dish>('/api/dishes',body)).data;try{removeRecipeDraft(this.data.id,this.scope)}catch{};if(!this.belongs())return;this.setData({dirty:false});try{wx.disableAlertBeforeUnload()}catch{/* ignore */}wx.redirectTo({url:`/pages/dish/index?id=${encodeURIComponent(dish.id)}`})}catch(error){if(!this.belongs())return;const e=error as ApiError;if(e.code==='VERSION_CONFLICT'){const latest=(e.details && e.details.latest) as Dish|undefined;if(latest)this.showConflict(latest);return}showError(error)}finally{this.setData({saving:false})}},
})
