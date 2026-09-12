'use strict';

const { shanghaiToday } = require('./core.cjs');

function memberDto(row) {
  return { id: row.id, name: row.name, active: !!row.active, avatarMediaId: row.avatar_media_id || null };
}

function categoryDto(row) {
  return { id: row.id, name: row.name, active: !!row.active };
}

function mediaDto(row, basePath = '/api/media') {
  const prefix = `${basePath}/${encodeURIComponent(row.id)}`;
  return {
    id: row.id,
    originalName: row.original_name,
    detectedMime: row.detected_mime,
    byteSize: Number(row.byte_size),
    sha256: row.sha256,
    previewPolicy: row.preview_policy,
    contentUrl: row.preview_policy === 'inline' ? `${prefix}/content` : null,
    downloadUrl: `${prefix}/download`,
    createdAt: row.created_at,
  };
}

function ratingForDish(db, dishId) {
  const row = db.prepare(`
    SELECT AVG(r.rating) AS average, COUNT(r.id) AS count
    FROM review r
    WHERE r.dish_id=? AND r.superseded=0
  `).get(dishId);
  return { average: row.average == null ? null : Number(row.average), count: Number(row.count || 0) };
}

function dishDto(db, row) {
  const steps = db.prepare('SELECT * FROM recipe_step WHERE dish_id=? ORDER BY position ASC').all(row.id).map((step) => ({
    id: step.id,
    position: Number(step.position),
    content: step.content,
    mediaId: step.media_id || null,
  }));
  return {
    id: row.id,
    name: row.name,
    categoryId: row.category_id,
    active: !!row.active,
    estimatedMinutes: row.estimated_minutes == null ? null : Number(row.estimated_minutes),
    introduction: row.introduction,
    voiceMediaId: row.voice_media_id || null,
    coverMediaId: row.cover_media_id || null,
    steps,
    revision: Number(row.revision),
    rating: ratingForDish(db, row.id),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function allowedActions(db, row, actorId) {
  const member = db.prepare('SELECT active FROM member WHERE id=?').get(actorId);
  const active = !!member?.active;
  const actions = [];
  if (row.status === 'pending') {
    if (active) actions.push('claim');
    if (row.ordered_by === actorId && active) actions.push('note', 'cancel');
  } else if (row.status === 'cooking') {
    if (row.cook_id === actorId && active) actions.push('unclaim', 'complete', 'cancel');
  } else if (row.status === 'completed') {
    const reviewed = db.prepare(`SELECT 1 FROM review
      WHERE dish_id=? AND review_date=? AND member_id=? AND superseded=0`).get(row.dish_id, row.menu_date, actorId);
    if (active && !reviewed) actions.push('review');
  } else if (row.status === 'cancelled') {
    const available = db.prepare(`
      SELECT 1 FROM dish d JOIN category c ON c.id=d.category_id
      WHERE d.id=? AND d.active=1 AND c.active=1
    `).get(row.dish_id);
    if (active && available) actions.push('repeat');
  }
  return actions;
}

function menuItemDto(db, row, actorId) {
  return {
    id: row.id,
    menuDate: row.menu_date,
    dishId: row.dish_id,
    dishName: row.dish_name,
    categoryName: row.category_name,
    coverMediaId: row.cover_media_id || null,
    orderedBy: row.ordered_by,
    orderedName: row.ordered_name,
    note: row.note,
    noteVoiceMediaId: row.note_voice_media_id || null,
    claimVoiceMediaId: row.claim_voice_media_id || null,
    completionVoiceMediaId: row.completion_voice_media_id || null,
    completionNote: row.completion_note,
    photoMediaIds: db.prepare('SELECT media_id FROM menu_completion_photo WHERE menu_item_id=? ORDER BY position').all(row.id).map(x=>x.media_id),
    status: row.status,
    cookId: row.cook_id || null,
    cookName: row.cook_name || null,
    claimedAt: row.claimed_at || null,
    completedAt: row.completed_at || null,
    cancelledBy: row.cancelled_by || null,
    cancelledName: row.cancelled_name || null,
    cancelledAt: row.cancelled_at || null,
    cancelReason: row.cancel_reason,
    sourceVoteId: row.source_vote_id || null,
    sourceItemId: row.source_item_id || null,
    revision: Number(row.revision),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    allowedActions: allowedActions(db, row, actorId),
  };
}

function reviewDto(row) {
  return {
    id: row.id,
    menuItemId: row.menu_item_id,
    dishId: row.dish_id,
    reviewDate: row.review_date,
    memberId: row.member_id,
    memberName: row.member_name,
    rating: Number(row.rating),
    comment: row.comment,
    voiceMediaId: row.voice_media_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function voteDto(db, vote, actorId) {
  const candidates = db.prepare(`
    SELECT vc.*, COALESCE(COUNT(vb.member_id),0) AS votes
    FROM vote_candidate vc
    LEFT JOIN vote_ballot vb ON vb.vote_id=vc.vote_id AND vb.dish_id=vc.dish_id
    WHERE vc.vote_id=?
    GROUP BY vc.vote_id, vc.dish_id
    ORDER BY vc.position ASC
  `).all(vote.id).map((row) => ({
    dishId: row.dish_id,
    dishName: row.dish_name,
    coverMediaId: row.cover_media_id || null,
    votes: Number(row.votes),
  }));
  const ballot = actorId ? db.prepare('SELECT dish_id FROM vote_ballot WHERE vote_id=? AND member_id=? ORDER BY dish_id').all(vote.id, actorId) : [];
  const participantCount = Number(db.prepare('SELECT COUNT(DISTINCT member_id) AS n FROM vote_ballot WHERE vote_id=?').get(vote.id).n);
  const added = db.prepare('SELECT id, menu_date, status FROM menu_item WHERE source_vote_id=?').get(vote.id);
  return {
    id: vote.id,
    title: vote.title,
    initiatorId: vote.initiator_id,
    initiatorName: vote.initiator_name,
    status: vote.status,
    createdAt: vote.created_at,
    closedAt: vote.closed_at || null,
    winnerDishId: vote.winner_dish_id || null,
    candidates,
    votingClosedAt: vote.voting_closed_at || null,
    enabledMemberCount: Number(db.prepare('SELECT COUNT(*) n FROM member WHERE active=1').get().n),
    myNote: db.prepare('SELECT note,voice_media_id AS voiceMediaId FROM vote_member_note WHERE vote_id=? AND member_id=?').get(vote.id,actorId) || {note:'',voiceMediaId:null},
    ballots: vote.status !== 'active' || vote.voting_closed_at ? db.prepare('SELECT member_id AS memberId,member_name AS memberName,note,voice_media_id AS voiceMediaId,updated_at AS updatedAt FROM vote_member_note WHERE vote_id=? ORDER BY updated_at,member_id').all(vote.id).map(n=>({...n,dishIds:db.prepare('SELECT dish_id FROM vote_ballot WHERE vote_id=? AND member_id=? ORDER BY dish_id').all(vote.id,n.memberId).map(x=>x.dish_id)})) : [],
    myDishIds: ballot.map((row) => row.dish_id),
    participantCount,
    addedItem: added ? { id: added.id, menuDate: added.menu_date, status: added.status } : null,
  };
}

function menuDaySummary(db, date) {
  const counts = { pending: 0, cooking: 0, completed: 0, cancelled: 0 };
  for (const row of db.prepare('SELECT status, COUNT(*) AS n FROM menu_item WHERE menu_date=? GROUP BY status').all(date)) {
    counts[row.status] = Number(row.n);
  }
  const rating = db.prepare(`SELECT AVG(rating) AS average, COUNT(*) AS count
    FROM review WHERE review_date=? AND superseded=0`).get(date);
  const effective = counts.pending + counts.cooking + counts.completed;
  return {
    date,
    counts,
    effectiveCount: effective,
    progress: effective ? counts.completed / effective : null,
    rating: { average: rating.average == null ? null : Number(rating.average), count: Number(rating.count || 0) },
  };
}

function historySummary(db, date) {
  const rows = db.prepare(`SELECT dish_name, status FROM menu_item
    WHERE menu_date=? AND status IN('completed','cancelled')
    ORDER BY created_at ASC, id ASC`).all(date);
  const day = menuDaySummary(db, date);
  return {
    menuDate: date,
    itemNames: rows.map((r) => r.dish_name),
    itemCount: rows.length,
    cancelledCount: day.counts.cancelled,
    cooks: db.prepare("SELECT DISTINCT cook_name FROM menu_item WHERE menu_date=? AND status='completed'").all(date).map(x=>x.cook_name),
    photoMediaIds: db.prepare("SELECT p.media_id FROM menu_completion_photo p JOIN menu_item m ON m.id=p.menu_item_id WHERE m.menu_date=? AND m.status='completed' ORDER BY m.created_at,p.position LIMIT 9").all(date).map(x=>x.media_id),
    completedCount: day.counts.completed,
    hasUnfinished: false,
    rating: day.rating,
  };
}

module.exports = {
  memberDto,
  categoryDto,
  mediaDto,
  ratingForDish,
  dishDto,
  menuItemDto,
  reviewDto,
  voteDto,
  menuDaySummary,
  historySummary,
};
