import {get,patch,uploadMedia} from '../../utils/api'
import type {Member} from '../../utils/types'
import {showError} from '../../utils/nav'
import {currentScope} from '../../utils/storage'
import { ensureCurrentContext } from '../../utils/context'
Page({
  data: { avatarId:'', avatarBusy:false, familyName: '', today: '', memberName: '', memberInitial: '家' },
  async onShow() {
    if (!(await ensureCurrentContext())) return
    const app = getApp<IAppOption>()
    const memberName = (app.globalData.member && app.globalData.member.name) || ''
    try{const members=(await get<Member[]>('/api/members')).data;const m=members.find(x=>x.id===(app.globalData.member && app.globalData.member.id));this.setData({avatarId:(m && m.avatarMediaId)||''})}catch(e){showError(e)}
    this.setData({ familyName: (app.globalData.system && app.globalData.system.familyName) || '家庭点菜', today: (app.globalData.system && app.globalData.system.today) || '', memberName, memberInitial: memberName ? Array.from(memberName)[0] : '家' })
  },
  async chooseAvatar(e:WechatMiniprogram.CustomEvent){await this.saveAvatar(e.detail.avatarUrl)},
  async uploadAvatar(){try{const r=await new Promise<WechatMiniprogram.ChooseImageSuccessCallbackResult>((resolve,reject)=>wx.chooseImage({count:1,sizeType:['original'],success:resolve,fail:reject}));if(r.tempFiles[0].size>52428800)throw new Error('头像不能超过 50 MiB');await this.saveAvatar(r.tempFilePaths[0])}catch(e){showError(e)}},
  async saveAvatar(path:string){if(!path||this.data.avatarBusy)return;const scope=currentScope();this.setData({avatarBusy:true});try{const m=await uploadMedia(path).promise;if(scope!==currentScope())return;const member=(await patch<Member>('/api/me/avatar',{avatarMediaId:m.id})).data;if(scope!==currentScope())return;getApp<IAppOption>().globalData.member=member;this.setData({avatarId:member.avatarMediaId||''})}catch(e){showError(e)}finally{this.setData({avatarBusy:false})}},
  dashboard(){wx.navigateTo({url:'/pages/dashboard/index'})},
  voteHistory(){wx.navigateTo({url:'/pages/vote-history/index'})},
  switchMember() { wx.navigateTo({ url: '/pages/identity/index' }) },
  myTasks() { wx.navigateTo({ url: '/pages/my-tasks/index' }) },
  myOrders() { wx.navigateTo({ url: '/pages/my-orders/index' }) },
  myReviews() { wx.navigateTo({ url: '/pages/my-reviews/index' }) },
  recipeDrafts() { wx.navigateTo({ url: '/pages/recipe-drafts/index' }) },
  importRecipe() { wx.navigateTo({ url: '/pages/recipe-import/index' }) },
  manage() { wx.navigateTo({ url: '/pages/manage/index' }) },
  members() { wx.navigateTo({ url: '/pages/members/index' }) },
  categories() { wx.navigateTo({ url: '/pages/categories/index' }) },
  settings() { wx.navigateTo({ url: '/pages/settings/index' }) },
})
