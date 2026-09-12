'use strict';

const {
  pageFromArray,
  appError,
  assert,
  cleanText,
  randomId,
  shanghaiToday,
  exactObject,
  utcNow,
  isDate,
} = require('./core.cjs');
const { transaction, requireReadContext, requireWriteContext, requireMember, getMeta } = require('./db.cjs');
const { attachment } = require('./attachments.cjs');
const { dishAvailable } = require('./catalog.cjs');
const { voteDto, menuItemDto } = require('./dto.cjs');
const { appendMenuItem, menuItemRow } = require('./menu.cjs');

function voteRow(db, id) {
  const row = db.prepare('SELECT * FROM vote WHERE id=?').get(id);
  if (!row) throw appError(404, 'NOT_FOUND', '投票不存在');
  return row;
}

function voteEntry(db, headers) {
  requireReadContext(db, headers, { active: false });
  const active = db.prepare("SELECT * FROM vote WHERE status='active' ORDER BY created_at DESC LIMIT 1").get();
  const latest = db.prepare("SELECT * FROM vote WHERE status IN('finished','cancelled') ORDER BY closed_at DESC, created_at DESC LIMIT 1").get();
  return {
    active: active ? voteDto(db, active, headers.memberId) : null,
    latestResult: latest ? voteDto(db, latest, headers.memberId) : null,
  };
}

function getVote(db, headers, id) {
  requireReadContext(db, headers, { active: false });
  return voteDto(db, voteRow(db, id), headers.memberId);
}

function startVote(db, headers, body, clock) {
  exactObject(body, ['title', 'dishIds']);
  const title = cleanText(body.title, 50, true, '投票标题');
  assert(Array.isArray(body.dishIds) && body.dishIds.length >= 2 && body.dishIds.length <= 10, 400, 'INVALID_CANDIDATES', '请选择 2—10 道候选菜');
  const dishIds = body.dishIds.map(String);
  assert(new Set(dishIds).size === dishIds.length, 400, 'INVALID_CANDIDATES', '候选菜不能重复');
  return transaction(db, () => {
    const { member } = requireWriteContext(db, headers);
    const existing = db.prepare("SELECT id FROM vote WHERE status='active' LIMIT 1").get();
    if (existing) throw appError(409, 'ACTIVE_VOTE', '已有进行中的投票', { voteId: existing.id });
    const invalid = dishIds.filter((id) => !dishAvailable(db, id));
    if (invalid.length) throw appError(422, 'DISH_UNAVAILABLE', '候选菜品必须可点', { invalidDishIds: invalid });
    const now = utcNow(clock);
    const id = randomId('vote');
    db.prepare(`INSERT INTO vote(id,title,initiator_id,initiator_name,status,winner_dish_id,created_at,closed_at)
                VALUES(?,?,?,?,'active',NULL,?,NULL)`).run(id, title, member.id, member.name, now);
    const insert = db.prepare('INSERT INTO vote_candidate(vote_id,dish_id,dish_name,cover_media_id,position) VALUES(?,?,?,?,?)');
    dishIds.forEach((dishId, index) => {
      const dish = db.prepare('SELECT name,cover_media_id FROM dish WHERE id=?').get(dishId);
      insert.run(id, dishId, dish.name, dish.cover_media_id, index + 1);
    });
    return voteDto(db, voteRow(db, id), member.id);
  });
}

function ballot(db, headers, id, body, clock) {
  exactObject(body, ['dishIds','note','voiceMediaId']);
  assert(Array.isArray(body.dishIds) && body.dishIds.length <= 10, 400, 'INVALID_INPUT', 'dishIds 必须是最多 10 道候选菜的数组');
  const dishIds = body.dishIds.map(String);
  assert(new Set(dishIds).size === dishIds.length, 400, 'INVALID_INPUT', '同一道候选菜不能重复选择');
  return transaction(db, () => {
    const { member } = requireWriteContext(db, headers);
    const vote = voteRow(db, id);
    if (vote.status !== 'active' || vote.voting_closed_at) throw appError(409, 'VOTE_CLOSED', '本轮已停止收票');
    const invalid = dishIds.filter((dishId) => !db.prepare('SELECT 1 FROM vote_candidate WHERE vote_id=? AND dish_id=?').get(id, dishId));
    if (invalid.length) throw appError(400, 'INVALID_CANDIDATE', '请选择本轮候选菜', { invalidDishIds: invalid });
    const now = utcNow(clock);
    db.prepare('DELETE FROM vote_ballot WHERE vote_id=? AND member_id=?').run(id, member.id);
    const insert = db.prepare('INSERT INTO vote_ballot(vote_id,member_id,dish_id,updated_at) VALUES(?,?,?,?)');
    dishIds.forEach((dishId) => insert.run(id, member.id, dishId, now));
    db.prepare('INSERT INTO vote_member_note VALUES(?,?,?,?,?,?) ON CONFLICT(vote_id,member_id) DO UPDATE SET member_name=excluded.member_name,note=excluded.note,voice_media_id=excluded.voice_media_id,updated_at=excluded.updated_at').run(id,member.id,member.name,cleanText(body.note,200,false,'投票备注'),attachment(db,body.voiceMediaId,'audio'),now);
    closeIfEveryoneVoted(db,id,clock);
    return voteDto(db, voteRow(db, id), member.id);
  });
}

function leaders(db, voteId) {
  const rows = db.prepare(`SELECT vc.dish_id, COUNT(vb.member_id) AS votes
                           FROM vote_candidate vc
                           LEFT JOIN vote_ballot vb ON vb.vote_id=vc.vote_id AND vb.dish_id=vc.dish_id
                           WHERE vc.vote_id=? GROUP BY vc.dish_id`).all(voteId);
  const max = rows.length ? Math.max(...rows.map((r) => Number(r.votes))) : 0;
  return { max, dishIds: rows.filter((r) => Number(r.votes) === max).map((r) => r.dish_id) };
}

function finishVote(db, headers, id, body, clock) {
  exactObject(body, ['winnerDishId']);
  const winnerDishId = body.winnerDishId == null || body.winnerDishId === '' ? null : String(body.winnerDishId);
  return transaction(db, () => {
    const { member } = requireWriteContext(db, headers);
    const vote = voteRow(db, id);
    if (vote.status !== 'active') throw appError(409, 'VOTE_CLOSED', '这轮投票已经结束');
    if (vote.initiator_id !== member.id) throw appError(403, 'FORBIDDEN', '只有发起人可以结束投票');
    const top = leaders(db, id);
    if (winnerDishId && !top.dishIds.includes(winnerDishId)) throw appError(409, 'INVALID_WINNER', '票数已变化，请按当前最高票重新确认', { leaders: top.dishIds });
    if (top.dishIds.length > 1 && !winnerDishId) {
      const candidates = db.prepare(`SELECT dish_id,dish_name FROM vote_candidate WHERE vote_id=? AND dish_id IN (${top.dishIds.map(() => '?').join(',')}) ORDER BY position`).all(id, ...top.dishIds);
      throw appError(409, 'TIE_REQUIRES_SELECTION', '最高票并列，请从并列候选中选择一道', { candidates: candidates.map((c) => ({ dishId: c.dish_id, dishName: c.dish_name })) });
    }
    const winner = top.dishIds.length === 1 ? top.dishIds[0] : winnerDishId;
    if (!winner || !top.dishIds.includes(winner)) throw appError(409, 'INVALID_WINNER', '获胜菜必须来自当前最高票候选', { leaders: top.dishIds });
    const now = utcNow(clock);
    db.prepare("UPDATE vote SET status='finished',winner_dish_id=?,closed_at=? WHERE id=?").run(winner, now, id);
    return voteDto(db, voteRow(db, id), member.id);
  });
}

function cancelVote(db, headers, id, body, clock) {
  exactObject(body, []);
  return transaction(db, () => {
    const { member } = requireWriteContext(db, headers);
    const vote = voteRow(db, id);
    if (vote.status !== 'active') throw appError(409, 'VOTE_CLOSED', '这轮投票已经结束');
    if (vote.initiator_id !== member.id) throw appError(403, 'FORBIDDEN', '只有发起人可以取消投票');
    db.prepare("UPDATE vote SET status='cancelled',closed_at=? WHERE id=?").run(utcNow(clock), id);
    return voteDto(db, voteRow(db, id), member.id);
  });
}

function addWinnerToMenu(db, headers, id, body, clock) {
  exactObject(body, ['targetDate']);
  const targetDate = String(body.targetDate || '');
  assert(isDate(targetDate), 400, 'INVALID_INPUT', 'targetDate 不合法');
  return transaction(db, () => {
    const meta = getMeta(db);
    if (!meta) throw appError(409, 'NOT_INITIALIZED', '家庭服务尚未初始化');
    if (headers.instanceId !== meta.instance_id) throw appError(409, 'INSTANCE_CHANGED', '家庭服务实例已变化，请重新连接');
    if (headers.dataEpoch !== meta.data_epoch) throw appError(409, 'DATA_EPOCH_CHANGED', '家庭数据已重新载入，请核对菜单后重新选择');
    const member = requireMember(db, headers.memberId, { active: false });
    const vote = voteRow(db, id);
    const prior = db.prepare('SELECT * FROM menu_item WHERE source_vote_id=?').get(id);
    if (prior) return menuItemDto(db, prior, member.id);
    if (!member.active) throw appError(403, 'MEMBER_INACTIVE', '当前成员已停用，请重新选择');
    if (vote.status !== 'finished' || !vote.winner_dish_id) throw appError(409, 'STATE_CONFLICT', '这轮投票没有可加入的结果');
    const today = shanghaiToday(clock);
    if (targetDate !== today) throw appError(409, 'DATE_CHANGED', `家庭当前日期为 ${today}，请重新确认加入日期`, { today });
    if (!dishAvailable(db, vote.winner_dish_id)) throw appError(422, 'DISH_UNAVAILABLE', '获胜菜目前不可点，结果仍然保留');
    const itemId = appendMenuItem(db, member, vote.winner_dish_id, targetDate, '', { voteId: vote.id }, clock);
    return menuItemDto(db, menuItemRow(db, itemId), member.id);
  });
}

function closeIfEveryoneVoted(db,id,clock) {
  const vote=voteRow(db,id);
  if(vote.status!=='active' || vote.voting_closed_at) return;
  const missing=db.prepare('SELECT 1 FROM member m WHERE m.active=1 AND NOT EXISTS(SELECT 1 FROM vote_ballot b WHERE b.vote_id=? AND b.member_id=m.id) LIMIT 1').get(id);
  if(missing) return;
  const top=leaders(db,id), now=utcNow(clock);
  db.prepare('UPDATE vote SET voting_closed_at=? WHERE id=?').run(now,id);
  if(top.dishIds.length===1) db.prepare("UPDATE vote SET status='finished',winner_dish_id=?,closed_at=? WHERE id=?").run(top.dishIds[0],now,id);
}
function voteHistory(db,headers,query) {
  requireReadContext(db,headers,{active:false});
  const rows=db.prepare('SELECT * FROM vote ORDER BY created_at DESC,id DESC').all().map(v=>voteDto(db,v,headers.memberId));
  return pageFromArray(rows,{limit:query.limit,cursor:query.cursor,filter:{route:'voteHistory'},key:v=>[v.createdAt,v.id],descending:[true,true]});
}
module.exports = {
  closeIfEveryoneVoted, voteHistory,
  voteRow,
  voteEntry,
  getVote,
  startVote,
  ballot,
  finishVote,
  cancelVote,
  addWinnerToMenu,
  leaders,
};
