BEGIN IMMEDIATE;
ALTER TABLE member ADD COLUMN avatar_media_id TEXT REFERENCES media(id);
ALTER TABLE dish ADD COLUMN voice_media_id TEXT REFERENCES media(id);
ALTER TABLE menu_item ADD COLUMN note_voice_media_id TEXT REFERENCES media(id);
ALTER TABLE menu_item ADD COLUMN claim_voice_media_id TEXT REFERENCES media(id);
ALTER TABLE menu_item ADD COLUMN completion_voice_media_id TEXT REFERENCES media(id);
ALTER TABLE menu_item ADD COLUMN completion_note TEXT NOT NULL DEFAULT '' CHECK(length(completion_note)<=200);
ALTER TABLE review ADD COLUMN voice_media_id TEXT REFERENCES media(id);
ALTER TABLE vote ADD COLUMN voting_closed_at TEXT;
CREATE TABLE menu_completion_photo (
 menu_item_id TEXT NOT NULL REFERENCES menu_item(id),
 position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 9),
 media_id TEXT NOT NULL REFERENCES media(id),
 PRIMARY KEY(menu_item_id,position)
);
CREATE TABLE vote_member_note (
 vote_id TEXT NOT NULL REFERENCES vote(id),
 member_id TEXT NOT NULL REFERENCES member(id),
 member_name TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=200),
 voice_media_id TEXT REFERENCES media(id),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(vote_id,member_id)
);
INSERT INTO vote_member_note(vote_id,member_id,member_name,note,voice_media_id,updated_at)
SELECT b.vote_id,b.member_id,m.name,'',NULL,MAX(b.updated_at) FROM vote_ballot b JOIN member m ON m.id=b.member_id GROUP BY b.vote_id,b.member_id;
CREATE TRIGGER ballot_collection_closed_insert BEFORE INSERT ON vote_ballot
WHEN EXISTS(SELECT 1 FROM vote WHERE id=NEW.vote_id AND voting_closed_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'VOTE_CLOSED'); END;
CREATE TRIGGER ballot_collection_closed_update BEFORE UPDATE ON vote_ballot
WHEN EXISTS(SELECT 1 FROM vote WHERE id=NEW.vote_id AND voting_closed_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'VOTE_CLOSED'); END;
CREATE TRIGGER ballot_closed_delete BEFORE DELETE ON vote_ballot
WHEN EXISTS(SELECT 1 FROM vote WHERE id=OLD.vote_id AND (status<>'active' OR voting_closed_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'VOTE_CLOSED'); END;
CREATE TRIGGER completion_photo_state BEFORE INSERT ON menu_completion_photo
WHEN NOT EXISTS(SELECT 1 FROM menu_item WHERE id=NEW.menu_item_id AND status='completed')
BEGIN SELECT RAISE(ABORT,'PHOTO_REQUIRES_COMPLETED_ITEM'); END;
PRAGMA user_version=3;
COMMIT;
