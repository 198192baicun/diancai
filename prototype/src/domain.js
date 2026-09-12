/* 浏览器原型领域模型。使用本机演示数据，不替代服务端事务或权限校验。 */
(function(root,factory){ const api=factory(); if(typeof module==='object'&&module.exports)module.exports=api; else root.MealDomain=api; })(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
const fail=(code,message,details={})=>{const e=new Error(message);e.code=code;e.details=details;throw e;};
const norm=x=>String(x).normalize('NFKC').trim().toLocaleLowerCase('en-US'); // 演示数据有限；产品使用固定 Unicode case-fold 规则。
const text=(x,max,required=false)=>{const v=String(x??'').trim();if((required&&!v)||[...v].length>max)fail('INVALID_INPUT',`请填写${required?'非空且':''}不超过 ${max} 字的内容`);return v;};
const active=(s,id)=>s.members.find(m=>m.id===id&&m.active);
const dish=(s,id)=>s.dishes.find(d=>d.id===id);
const cat=(s,id)=>s.categories.find(c=>c.id===id);
const available=(s,id)=>{const d=dish(s,id);return !!(d&&d.active&&cat(s,d.categoryId)?.active);};
const memberName=(s,id)=>s.members.find(m=>m.id===id)?.name||'未知成员';
const uid=(s,p)=>`${p}-${++s.sequence}`;
const stamp=s=>`${s.today}T10:30:00.000Z`;
const revision=(obj,expected)=>{if(expected!==undefined&&expected!==obj.revision)fail('VERSION_CONFLICT','内容已有变化，请查看最新状态',{latest:clone(obj)});};
const item=(s,id)=>{const x=s.items.find(i=>i.id===id);if(!x)fail('NOT_FOUND','这条菜单事项不存在');return x;};
function seed(){
 const s={version:2,sequence:100,today:'2026-09-10',instance:'demo-home',epoch:'demo-epoch-1',family:{name:'幸福之家',timezone:'Asia/Shanghai'},
 members:[{id:'m1',name:'丈夫',active:true},{id:'m2',name:'妻子',active:true},{id:'m3',name:'爸爸',active:true},{id:'m4',name:'妈妈',active:true}],
 categories:['荤菜','素菜','汤','主食','凉菜','其他'].map((name,i)=>({id:'c'+(i+1),name,active:true})),
 dishes:[
 {id:'d1',name:'红烧肉',categoryId:'c1',minutes:60,tone:'braise',intro:'收汁后软糯入味，留一点汤汁拌饭。',steps:['五花肉切块，冷水下锅焯去浮沫。','小火炒糖色，放入肉块翻炒上色。','加入调料和热水，炖至软糯，最后收汁。']},
 {id:'d2',name:'番茄炒蛋',categoryId:'c2',minutes:15,tone:'tomato',intro:'番茄多一点，鸡蛋炒得嫩一点。',steps:['番茄切块，鸡蛋打散。','炒熟鸡蛋盛出，另炒番茄至出汁。','倒回鸡蛋翻匀，调味后出锅。']},
 {id:'d3',name:'清炒时蔬',categoryId:'c2',minutes:10,tone:'greens',intro:'一盘简单清爽的家常蔬菜。',steps:['蔬菜洗净沥水，蒜切末。','热锅下油，蒜末炒香后加入蔬菜。','快速翻炒，调味后出锅。']},
 {id:'d4',name:'紫菜蛋花汤',categoryId:'c3',minutes:10,tone:'soup',intro:'一碗热汤，配今天的家常饭。',steps:['水烧开，放入紫菜。','缓缓淋入蛋液，待蛋花凝固。','加入少许调味料即可。']},
 {id:'d5',name:'可乐鸡翅',categoryId:'c1',minutes:35,tone:'wings',intro:'甜咸适口，慢慢收汁。',steps:['鸡翅处理后煎至两面金黄。','加入可乐和调料，小火煮透。','转中火收汁。']},
 {id:'d6',name:'凉拌黄瓜',categoryId:'c5',minutes:8,tone:'cucumber',intro:'清爽开胃，现拌现吃。',steps:['黄瓜洗净拍开，切段。','加入蒜末和调味料拌匀。']},
 {id:'d7',name:'私房焖饭',categoryId:'c4',minutes:40,tone:'rice',intro:'米饭和配菜一起焖，省心的一餐。',steps:[]},
 {id:'d8',name:'香煎三文鱼',categoryId:'c1',minutes:20,tone:'fish',intro:'下架资料仍然可以查看。',steps:['鱼块擦干，按口味调味。','煎至熟透后出锅。'],active:false}
 ].map(d=>({...d,active:d.active!==false,revision:1,cover:null,updatedAt:'2026-09-10T06:00:00.000Z'})),items:[],reviews:[],votes:[],receipts:[]};
 function add(id,did,date,orderedBy,status,cook,note=''){const d=dish(s,did);s.items.push({id,dishId:did,date,orderedBy,orderedName:memberName(s,orderedBy),name:d.name,categoryName:cat(s,d.categoryId).name,tone:d.tone,cover:d.cover,note,status,cook:cook||null,cookName:cook?memberName(s,cook):null,claimedAt:cook?date+'T08:00:00Z':null,completedAt:status==='completed'?date+'T09:00:00Z':null,cancelledAt:null,cancelledBy:null,cancelReason:'',sourceVote:null,sourceItem:null,revision:1});}
 add('i1','d1',s.today,'m2','pending',null,'少放一点糖');
 add('i2','d2',s.today,'m2','cooking','m1','鸡蛋嫩一点');
 add('i3','d3',s.today,'m3','completed','m3');
 add('i4','d4','2026-09-09','m4','cooking','m4','晚点回来再做');
 add('i5','d8','2026-09-09','m2','completed','m1');
 add('i6','d5','2026-09-08','m1','completed','m4');
 add('i7','d2','2026-09-09','m2','completed','m1','不加葱');
 s.reviews=[{id:'r1',itemId:'i3',dishId:'d3',date:s.today,memberId:'m2',memberName:'妻子',rating:5,comment:'清爽，刚刚好。'},{id:'r2',itemId:'i5',dishId:'d8',date:'2026-09-09',memberId:'m2',memberName:'妻子',rating:4,comment:'外面煎得很好。'},{id:'r3',itemId:'i6',dishId:'d5',date:'2026-09-08',memberId:'m1',memberName:'丈夫',rating:5,comment:'很下饭。'}];
 s.votes=[{id:'v1',title:'今晚再加一道？',initiator:'m2',initiatorName:'妻子',status:'active',createdAt:stamp(s),closedAt:null,winner:null,candidates:['d5','d6'].map(id=>({dishId:id,name:dish(s,id).name,tone:dish(s,id).tone,cover:null})),ballots:{m1:['d5'],m4:['d6']},addedItemId:null}];
 return s;
}
function dependencies(s,id){return {pending:s.items.filter(i=>i.orderedBy===id&&i.status==='pending'),cooking:s.items.filter(i=>i.cook===id&&i.status==='cooking'),votes:s.votes.filter(v=>v.initiator===id&&v.status==='active'),last:s.members.filter(m=>m.active).length===1&&!!active(s,id)};}
function average(s,dishId){const rs=s.reviews.filter(r=>r.dishId===dishId);return {count:rs.length,value:rs.length?rs.reduce((a,r)=>a+r.rating,0)/rs.length:null};}
function dayAverage(s,date){const rs=s.reviews.filter(r=>r.date===date);return rs.length?rs.reduce((a,r)=>a+r.rating,0)/rs.length:null;}
function counts(v){const c={};v.candidates.forEach(x=>c[x.dishId]=0);Object.values(v.ballots).flat().forEach(id=>{if(id in c)c[id]++;});return c;}
function leaders(v){const c=counts(v),max=Math.max(...Object.values(c));return Object.keys(c).filter(k=>c[k]===max);}
function appendItem(s,actor,did,note,source={}){const d=dish(s,did),id=uid(s,'item');s.items.push({id,dishId:did,date:s.today,orderedBy:actor,orderedName:memberName(s,actor),name:d.name,categoryName:cat(s,d.categoryId).name,tone:d.tone,cover:d.cover||null,note:note||'',status:'pending',cook:null,cookName:null,claimedAt:null,completedAt:null,cancelledAt:null,cancelledBy:null,cancelReason:'',sourceVote:source.vote||null,sourceItem:source.item||null,revision:1});return id;}
function execute(original,actor,action,p={}){
 const s=clone(original);let result=null;
 // 已有成功回执可只读重放，即便该成员随后停用。
 if(action==='submit'){
  if(p.epoch!==s.epoch||p.instance!==s.instance)fail('DATA_EPOCH_CHANGED','家庭数据已重新载入，请核对菜单');
  if(p.member!==actor)fail('ACTOR_MISMATCH','请求属于另一位成员');
  const semantic=JSON.stringify({date:p.date,items:p.items});
  const receipt=s.receipts.find(r=>r.key===p.key&&r.member===actor&&r.epoch===p.epoch);
  if(receipt){if(receipt.semantic!==semantic)fail('IDEMPOTENCY_MISMATCH','此提交凭据不能用于不同的点菜内容');return {state:s,result:clone(receipt)};}
 }
 if(!active(s,actor))fail('MEMBER_INACTIVE','当前成员已停用，请重新选择');
 switch(action){
 case 'submit':{
  if(!p.key)fail('INVALID_INPUT','缺少提交凭据');
  if(p.date!==s.today)fail('DATE_CHANGED',`家庭当前日期为 ${s.today}，请确认点菜日期`);
  if(!Array.isArray(p.items)||!p.items.length||p.items.length>50)fail('INVALID_INPUT','一次请选择 1—50 条菜品');
  const invalid=p.items.filter(x=>!available(s,x.dishId));if(invalid.length)fail('DISH_UNAVAILABLE','部分菜品不可点，请检查已选内容',{invalid});
  p.items.forEach(x=>{text(x.note,200);if(x.sourceItem&&!s.items.some(i=>i.id===x.sourceItem&&i.dishId===x.dishId))fail('INVALID_SOURCE','历史来源不匹配');});
  const itemIds=p.items.map(x=>appendItem(s,actor,x.dishId,text(x.note,200),{item:x.sourceItem}));
  result={key:p.key,member:actor,epoch:s.epoch,date:s.today,itemIds,semantic:JSON.stringify({date:p.date,items:p.items})};s.receipts.push(result);break;
 }
 case 'claim':case 'unclaim':case 'complete':case 'cancel':case 'note':{
  const i=item(s,p.id);revision(i,p.revision);
  if(action==='claim'){if(i.status!=='pending')fail('STATE_CONFLICT','这道菜的状态已变化',{latest:i});i.status='cooking';i.cook=actor;i.cookName=memberName(s,actor);i.claimedAt=stamp(s);}
  if(action==='unclaim'||action==='complete'){if(i.status!=='cooking'||i.cook!==actor)fail('FORBIDDEN','只有当前做菜人可以操作');if(action==='unclaim'){i.status='pending';i.cook=null;i.cookName=null;i.claimedAt=null;}else{i.status='completed';i.completedAt=stamp(s);}}
  if(action==='cancel'){if(!((i.status==='pending'&&i.orderedBy===actor)||(i.status==='cooking'&&i.cook===actor)))fail('FORBIDDEN','当前成员不能取消这条事项');i.status='cancelled';i.cancelledBy=actor;i.cancelledAt=stamp(s);i.cancelReason=text(p.reason,200);}
  if(action==='note'){if(i.status!=='pending'||i.orderedBy!==actor)fail('FORBIDDEN','只有点菜人可以编辑待做备注');i.note=text(p.note,200);}
  i.revision++;result=i;break;
 }
 case 'review':{const i=item(s,p.id);if(i.status!=='completed')fail('STATE_CONFLICT','只能评价已完成的菜');if(!Number.isInteger(p.rating)||p.rating<1||p.rating>5)fail('INVALID_RATING','请选择 1—5 星');if(s.reviews.some(x=>x.dishId===i.dishId&&x.date===i.date&&x.memberId===actor))fail('REVIEW_ALREADY_SUBMITTED','当天已经评价过这道菜，提交后不能修改');const values={itemId:i.id,dishId:i.dishId,date:i.date,memberId:actor,memberName:memberName(s,actor),rating:p.rating,comment:text(p.comment,1000)};s.reviews.push({id:uid(s,'review'),...values});result=values;break;}
 case 'saveDish':{
  const old=p.id?dish(s,p.id):null;if(p.id&&!old)fail('NOT_FOUND','菜品不存在');if(old)revision(old,p.revision);
  const name=text(p.name,50,true);if(s.dishes.some(d=>d.id!==p.id&&norm(d.name)===norm(name)))fail('NAME_EXISTS','这个菜名已经存在');
  const c=cat(s,p.categoryId);if(!c||(!(old&&old.active===false)&&!c.active))fail('CATEGORY_INACTIVE','请选择启用的分类');
  const minutes=p.minutes===''||p.minutes===null?null:Number(p.minutes);if(minutes!==null&&(!Number.isInteger(minutes)||minutes<1||minutes>1440))fail('INVALID_INPUT','预计时长须为 1—1440 分钟整数');
  const rawSteps=p.steps||[];if(rawSteps.length>50)fail('INVALID_INPUT','最多 50 个步骤');const steps=rawSteps.map(x=>text(x,2000,true));
  const values={name,categoryId:p.categoryId,minutes,intro:text(p.intro,1000),steps,cover:p.cover||null,updatedAt:stamp(s)};
  if(old){Object.assign(old,values);old.revision++;result=old;}else{result={id:uid(s,'dish'),tone:'rice',active:true,revision:1,...values};s.dishes.push(result);}break;
 }
 case 'toggleDish':{const d=dish(s,p.id);if(!d)fail('NOT_FOUND','菜品不存在');revision(d,p.revision);if(d.active&&s.votes.some(v=>v.status==='active'&&v.candidates.some(c=>c.dishId===d.id)))fail('ACTIVE_VOTE','该菜正在参与投票，请先结束或取消投票');if(!d.active&&!cat(s,d.categoryId)?.active)fail('CATEGORY_INACTIVE','分类已停用，请先调整分类');d.active=!d.active;d.revision++;result=d;break;}
 case 'saveMember':case 'saveCategory':{
  const isMember=action==='saveMember',list=isMember?s.members:s.categories,old=list.find(x=>x.id===p.id),name=text(p.name,20,true);
  if(p.id&&!old)fail('NOT_FOUND','资料不存在');if(list.some(x=>x.id!==p.id&&norm(x.name)===norm(name)))fail('NAME_EXISTS','名称已存在，停用资料也保留名称');
  if(old){old.name=name;result=old;}else{result={id:uid(s,isMember?'member':'category'),name,active:true};list.push(result);}break;
 }
 case 'toggleMember':{const m=s.members.find(m=>m.id===p.id);if(!m)fail('NOT_FOUND','成员不存在');if(m.active){const d=dependencies(s,m.id);if(d.last||d.pending.length||d.cooking.length||d.votes.length)fail('MEMBER_IN_USE',d.last?'至少保留一位启用成员':'请先处理该成员的未完成事项或进行中投票',d);}m.active=!m.active;result=m;break;}
 case 'toggleCategory':{const c=cat(s,p.id);if(!c)fail('NOT_FOUND','分类不存在');if(c.active&&s.dishes.some(d=>d.categoryId===c.id&&d.active))fail('CATEGORY_IN_USE','请先下架或移动该分类下的上架菜品');c.active=!c.active;result=c;break;}
 case 'familyName':s.family.name=text(p.name,30,true);break;
 case 'startVote':{
  if(s.votes.some(v=>v.status==='active'))fail('ACTIVE_VOTE','已有进行中的投票');const ids=[...new Set(p.dishIds||[])];if(ids.length<2||ids.length>10||ids.length!==p.dishIds.length)fail('INVALID_CANDIDATES','请选择 2—10 道不同的菜');if(ids.some(id=>!available(s,id)))fail('DISH_UNAVAILABLE','候选菜品必须可点');
  result={id:uid(s,'vote'),title:text(p.title,50,true),initiator:actor,initiatorName:memberName(s,actor),status:'active',createdAt:stamp(s),closedAt:null,candidates:ids.map(id=>{const d=dish(s,id);return {dishId:id,name:d.name,tone:d.tone,cover:d.cover||null};}),ballots:{},winner:null,addedItemId:null};s.votes.push(result);break;
 }
 case 'ballot':case 'finishVote':case 'cancelVote':case 'addWinner':{
  const v=s.votes.find(v=>v.id===p.id);if(!v)fail('NOT_FOUND','投票不存在');
  if(action==='addWinner'){
   if(v.status!=='finished')fail('STATE_CONFLICT','这轮投票没有可加入的结果');const prior=s.items.find(i=>i.sourceVote===v.id);if(prior){result=prior;break;}
   if(p.date!==s.today)fail('DATE_CHANGED','日期已变化，请重新确认加入日期');if(!available(s,v.winner))fail('DISH_UNAVAILABLE','获胜菜目前不可点，结果仍然保留');const id=appendItem(s,actor,v.winner,'',{vote:v.id});v.addedItemId=id;result=item(s,id);break;
  }
  if(v.status!=='active')fail('VOTE_CLOSED','这轮投票已经结束');
  if(action==='ballot'){const ids=(p.dishIds||[]).map(String);if(new Set(ids).size!==ids.length||ids.some(id=>!v.candidates.some(c=>c.dishId===id)))fail('INVALID_CANDIDATE','请选择本轮候选菜');if(ids.length)v.ballots[actor]=ids;else delete v.ballots[actor];result=v;break;}
  if(v.initiator!==actor)fail('FORBIDDEN','只有发起人可以结束或取消投票');
  if(action==='cancelVote'){v.status='cancelled';v.closedAt=stamp(s);result=v;break;}
  const top=leaders(v);if(top.length>1&&!p.winner)fail('TIE','请选择并列候选中的一道',{leaders:top});const win=top.length===1?top[0]:p.winner;if((p.winner&&!top.includes(p.winner))||!top.includes(win))fail('INVALID_WINNER','获胜菜必须来自最高票候选');v.winner=win;v.status='finished';v.closedAt=stamp(s);result=v;break;
 }
 default:fail('UNKNOWN_ACTION','未定义的动作');
 }
 return {state:s,result:clone(result)};
}
return {seed,clone,execute,available,dependencies,average,dayAverage,counts,leaders,memberName,norm};
});
