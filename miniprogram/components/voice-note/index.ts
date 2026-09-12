import {uploadMedia} from '../../utils/api'
import {loadMediaPreviewURL} from '../../utils/media'
import {currentScope} from '../../utils/storage'
let uploadInFlight=false
let recordingOwner: string | null = null
let manager: WechatMiniprogram.RecorderManager | null = null
let stopped: ((r:WechatMiniprogram.OnStopCallbackResult)=>void) | null = null
let failed: (()=>void) | null = null
function recorderManager(){if(!manager){manager=wx.getRecorderManager();manager.onStop(r=>{if(stopped)stopped(r)});manager.onError(()=>{if(failed)failed()})}return manager}
Component({
 properties:{mediaId:{type:String,value:''},editable:{type:Boolean,value:false},disabled:{type:Boolean,value:false}},
 data:{recording:false,busy:false,playing:false,error:''},
 lifetimes:{detached(){const self=this as any;self.dead=true;if(recordingOwner===self.owner){self.cancelled=true;wx.getRecorderManager().stop()}if(self.audio)self.audio.destroy()}},
 pageLifetimes:{hide(){const self=this as any;if(recordingOwner===self.owner){self.cancelled=true;wx.getRecorderManager().stop();this.setData({recording:false})}if(self.audio)self.audio.stop()}},
 methods:{
  record(){
   if(this.data.disabled||this.data.busy)return
   const self=this as any, recorder=recorderManager()
   if(this.data.recording){recorder.stop();return}
   if(recordingOwner||uploadInFlight){this.setData({error:'请先完成另一条录音或上传'});return}
   self.owner=self.owner||String(Math.random());self.scope=currentScope();self.dead=false;self.cancelled=false
   self.stopListener=async (r:WechatMiniprogram.OnStopCallbackResult)=>{
    if(recordingOwner!==self.owner)return
    recordingOwner=null;if(self.dead||self.cancelled||self.scope!==currentScope()){if(!self.dead){this.setData({recording:false,busy:false});this.triggerEvent('busy',{busy:false})}return}this.setData({recording:false,busy:true});this.triggerEvent('busy',{busy:true})
    uploadInFlight=true
    try{const media=await uploadMedia(r.tempFilePath).promise;if(!self.dead&&self.scope===currentScope()){this.triggerEvent('change',{mediaId:media.id});this.setData({error:''})}}
    catch{if(!self.dead)this.setData({error:'语音上传失败，请重新录制'})}
    finally{uploadInFlight=false;if(!self.dead){this.setData({busy:false});this.triggerEvent('busy',{busy:false})}}
   }
   self.errorListener=()=>{if(recordingOwner!==self.owner)return;recordingOwner=null;this.setData({recording:false,busy:false,error:'无法录音，请检查微信麦克风权限'});this.triggerEvent('busy',{busy:false})}
   stopped=self.stopListener;failed=self.errorListener;recordingOwner=self.owner
   this.setData({recording:true,error:''});this.triggerEvent('busy',{busy:true})
   recorder.start({duration:60000,format:'mp3',sampleRate:16000,numberOfChannels:1,encodeBitRate:64000})
  },
  async play(){const self=this as any;if(this.data.playing){self.audio.stop();return}const src=await loadMediaPreviewURL(this.data.mediaId);if(!src){this.setData({error:'语音暂时无法读取'});return}if(!self.audio){self.audio=wx.createInnerAudioContext();const done=()=>this.setData({playing:false});self.audio.onEnded(done);self.audio.onStop(done);self.audio.onError(()=>{done();this.setData({error:'播放失败，请重试'})})}self.audio.src=src;self.audio.play();this.setData({playing:true})},
  remove(){if(!this.data.disabled&&!this.data.busy&&!this.data.recording)this.triggerEvent('change',{mediaId:null})}
 }
})