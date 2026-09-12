import { currentScope } from '../../utils/storage'
import { get, post, put, ApiError } from '../../utils/api'
import type { MenuItem, Vote, VoteEntry } from '../../utils/types'
import { showError } from '../../utils/nav'
import { loadMediaPreviewURL } from '../../utils/media'
interface CandidateView { dishId:string; dishName:string; votes:number; selected:boolean; winner:boolean; percent:number; coverURL:string }
Page({
  scope:null as string|null,
  data:{note:'',voiceMediaId:null as string|null,voiceBusy:false,ballots:[] as any[],selectedIds:[] as string[],ballotDirty:false,ballotSaving:false,id:'',vote:null as Vote|null,candidates:[] as CandidateView[],owner:false,statusLabel:'',winnerName:'',winnerVotes:0,tieChosen:false,hasActiveElsewhere:false},
  onLoad(q:Record<string,string|undefined>){this.scope=currentScope();this.setData({id:q.id||''})},
  async onShow(){if(this.scope!==currentScope()){this.scope=currentScope();this.setData({note:'',voiceMediaId:null,voiceBusy:false,ballotDirty:false,selectedIds:[]})}await this.load()}, async onPullDownRefresh(){await this.load();wx.stopPullDownRefresh()},
  async load(){try{let vote:Vote;if(this.data.id)vote=(await get<Vote>(`/api/votes/${encodeURIComponent(this.data.id)}`)).data;else{const entry=(await get<VoteEntry>('/api/votes/entry')).data;vote=entry.active||entry.latestResult!;if(!vote){wx.navigateTo({url:'/pages/vote-form/index'});return}}const total=vote.participantCount;const max=Math.max(0,...vote.candidates.map((c)=>c.votes));const leaders=vote.candidates.filter((c)=>c.votes===max);const winner=vote.candidates.find((c)=>c.dishId===vote.winnerDishId);const entry=(await get<VoteEntry>('/api/votes/entry')).data;const selectedIds=this.data.ballotDirty && vote.status==='active' && !vote.votingClosedAt?this.data.selectedIds:vote.myDishIds;const candidates=vote.candidates.map((c)=>({dishId:c.dishId,dishName:c.dishName,votes:c.votes,selected:selectedIds.includes(c.dishId),winner:vote.winnerDishId===c.dishId,percent:total?Math.round(c.votes/total*100):0,coverURL:''}));this.setData({vote,candidates,selectedIds,note:this.data.ballotDirty?this.data.note:vote.myNote.note,voiceMediaId:this.data.ballotDirty?this.data.voiceMediaId:vote.myNote.voiceMediaId,ballots:vote.ballots.map(b=>({...b,names:b.dishIds.map(id=>(vote.candidates.find(c=>c.dishId===id)||{dishName:''}).dishName).join('、')})),ballotDirty:vote.status==='active'&&!vote.votingClosedAt&&this.data.ballotDirty,owner:vote.initiatorId===((getApp<IAppOption>().globalData.member || { id: '' }).id),statusLabel:vote.status==='active'?(vote.votingClosedAt?'已收齐 · 等待选定获胜菜':'进行中'):vote.status==='finished'?'已结束':'已取消',winnerName:(winner ? winner.dishName : '')||'',winnerVotes:winner ? winner.votes : 0||0,tieChosen:vote.status==='finished'&&leaders.length>1,hasActiveElsewhere:!!entry.active&&entry.active.id!==vote.id});void Promise.all(vote.candidates.map(async c=>{const coverURL=await loadMediaPreviewURL(c.coverMediaId);if(this.data.vote && this.data.vote.id===vote.id)this.setData({candidates:this.data.candidates.map(x=>x.dishId===c.dishId?{...x,coverURL}:x)})}))}catch(e){showError(e)}},
  history(){wx.navigateTo({url:'/pages/vote-history/index'})},
  noteInput(e:WechatMiniprogram.TextareaInput){this.setData({note:e.detail.value,ballotDirty:true})},
  voiceChange(e:WechatMiniprogram.CustomEvent){this.setData({voiceMediaId:e.detail.mediaId,ballotDirty:true})},
  voiceBusy(e:WechatMiniprogram.CustomEvent){this.setData({voiceBusy:e.detail.busy})},
  ballot(e:WechatMiniprogram.TouchEvent){
    if(this.data.ballotSaving || !this.data.vote || this.data.vote.status!=='active'||this.data.vote.votingClosedAt)return
    const dishId=String(e.currentTarget.dataset.dish)
    const selectedIds=this.data.selectedIds.includes(dishId)?this.data.selectedIds.filter(id=>id!==dishId):[...this.data.selectedIds,dishId]
    this.setData({selectedIds,ballotDirty:true,candidates:this.data.candidates.map(c=>({...c,selected:selectedIds.includes(c.dishId)}))})
    try{wx.enableAlertBeforeUnload({message:'投票选择还未保存，确认离开？'})}catch{}
  },
  async saveBallot(){
    const vote=this.data.vote
    if(!vote || vote.votingClosedAt || this.data.voiceBusy || this.data.ballotSaving || !this.data.ballotDirty)return
    const scope=currentScope(),dishIds=[...this.data.selectedIds]
    this.setData({ballotSaving:true})
    try{
      await put<Vote>(`/api/votes/${encodeURIComponent(vote.id)}/my-ballot`,{dishIds,note:this.data.note,voiceMediaId:this.data.voiceMediaId})
      if(currentScope()!==scope)return
      this.setData({ballotDirty:false})
      try{wx.disableAlertBeforeUnload()}catch{}
      await this.load()
    }catch(error){if(currentScope()===scope)showError(error)}
    finally{this.setData({ballotSaving:false})}
  },
  async finish(){if(this.data.ballotDirty){wx.showToast({title:'请先保存本次选择',icon:'none'});return}const vote=this.data.vote;if(!vote)return;const ok=await new Promise<boolean>((r)=>wx.showModal({title:'结束本轮投票？',content:'结束后不能继续投票或改票，服务器会按提交瞬间的最终票数计算。',success:x=>r(x.confirm),fail:()=>r(false)}));if(!ok)return;await this.finishWith(null)},
  async finishWith(winnerDishId:string|null){const vote=this.data.vote;if(!vote)return;try{await post<Vote>(`/api/votes/${encodeURIComponent(vote.id)}/finish`,{winnerDishId});await this.load()}catch(error){const e=error as ApiError;if(e.code==='TIE_REQUIRES_SELECTION'&&Array.isArray((e.details && e.details.candidates))){const choices=e.details.candidates as Array<{dishId:string;dishName:string}>;wx.showActionSheet({itemList:choices.map((c)=>c.dishName),success:(r)=>{void this.finishWith(choices[r.tapIndex].dishId)}});return}showError(error);await this.load()}},
  async cancel(){const vote=this.data.vote;if(!vote)return;const ok=await new Promise<boolean>((r)=>wx.showModal({title:'取消本轮投票？',content:'取消后不产生获胜菜，结果仍然保留。',confirmColor:'#ac3944',success:x=>r(x.confirm),fail:()=>r(false)}));if(!ok)return;try{await post<Vote>(`/api/votes/${encodeURIComponent(vote.id)}/cancel`,{});await this.load()}catch(e){showError(e);await this.load()}},
  async addWinner(){const vote=this.data.vote;const today=((getApp<IAppOption>().globalData.system || { today: '' }).today);if(!vote||!today)return;try{await post<MenuItem>(`/api/votes/${encodeURIComponent(vote.id)}/menu-item`,{targetDate:today});await this.load()}catch(e){showError(e);await this.load()}},
  openAdded(){if((this.data.vote && this.data.vote.addedItem))wx.navigateTo({url:`/pages/item/index?id=${encodeURIComponent(this.data.vote.addedItem.id)}`})},
  newVote(){wx.navigateTo({url:'/pages/vote-form/index'})},
})
