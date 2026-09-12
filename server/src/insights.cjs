'use strict';
const {requireReadContext,requireWriteContext,transaction}=require('./db.cjs');
const {assert,exactObject,shanghaiToday}=require('./core.cjs');
const {dishDto,memberDto}=require('./dto.cjs');
const {attachment}=require('./attachments.cjs');
function randomDishes(db,headers,query) {
 requireReadContext(db,headers,{active:true});
 const count=Number(query.count);
 assert(Number.isInteger(count)&&count>=1&&count<=50,400,'INVALID_INPUT','请输入 1—50 道菜');
 const rows=db.prepare('SELECT d.* FROM dish d JOIN category c ON c.id=d.category_id WHERE d.active=1 AND c.active=1 ORDER BY random() LIMIT ?').all(count);
 assert(rows.length===count,422,'NOT_ENOUGH_DISHES',`可点菜不足 ${count} 道，请减少数量`);
 return {items:rows.map(r=>dishDto(db,r))};
}
function avatar(db,headers,body) {
 exactObject(body,['avatarMediaId']);
 return transaction(db,()=>{const {member}=requireWriteContext(db,headers);db.prepare('UPDATE member SET avatar_media_id=? WHERE id=?').run(attachment(db,body.avatarMediaId,'image'),member.id);return memberDto(db.prepare('SELECT * FROM member WHERE id=?').get(member.id));});
}
function dashboard(db,headers,clock) {
 requireReadContext(db,headers,{active:false});
 const totals=db.prepare("SELECT COUNT(*) total,SUM(status='pending') pending,SUM(status='cooking') cooking,SUM(status='completed') completed,SUM(status='cancelled') cancelled,COUNT(DISTINCT menu_date) days FROM menu_item").get();
 for(const key of Object.keys(totals)) totals[key]=Number(totals[key]||0);
 const rating=db.prepare('SELECT COUNT(*) count,AVG(rating) average FROM review WHERE superseded=0').get();
 const popular=db.prepare("SELECT dish_id dishId,MAX(dish_name) dishName,COUNT(*) count FROM menu_item WHERE status<>'cancelled' GROUP BY dish_id ORDER BY count DESC,dish_id LIMIT 10").all();
 const cooks=db.prepare("SELECT cook_id memberId,MAX(cook_name) memberName,COUNT(*) count FROM menu_item WHERE status='completed' GROUP BY cook_id ORDER BY count DESC,cook_id LIMIT 10").all();
 const trend=db.prepare("SELECT menu_date date,COUNT(*) count,SUM(status='completed') completed FROM menu_item WHERE status<>'cancelled' GROUP BY menu_date ORDER BY menu_date DESC LIMIT 10").all();
 return {today:shanghaiToday(clock),totals,rating,popular,cooks,trend,activeMembers:db.prepare('SELECT COUNT(*) n FROM member WHERE active=1').get().n,dishCount:db.prepare('SELECT COUNT(*) n FROM dish WHERE active=1').get().n,voteCount:db.prepare('SELECT COUNT(*) n FROM vote').get().n};
}
module.exports={randomDishes,avatar,dashboard};
