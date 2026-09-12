-- 家庭点菜：初始应用 schema。连接 PRAGMA 也必须由运行时为每个连接设置。
PRAGMA foreign_keys = ON;
PRAGMA application_id = 1179469132;
PRAGMA user_version = 1;
BEGIN IMMEDIATE;
CREATE TABLE schema_migration (
 version INTEGER PRIMARY KEY,
 sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 applied_at TEXT NOT NULL
) STRICT;
CREATE TABLE app_meta (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 family_name TEXT NOT NULL CHECK(length(trim(family_name)) BETWEEN 1 AND 30),
 timezone TEXT NOT NULL CHECK(timezone='Asia/Shanghai'),
 instance_id TEXT NOT NULL UNIQUE,
 data_epoch TEXT NOT NULL,
 created_at TEXT NOT NULL
) STRICT;
CREATE TABLE member (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 20),
 name_key TEXT NOT NULL UNIQUE CHECK(length(name_key)>0),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL
) STRICT;
CREATE TABLE category (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 20),
 name_key TEXT NOT NULL UNIQUE CHECK(length(name_key)>0),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL
) STRICT;
CREATE TABLE media (
 id TEXT PRIMARY KEY,
 storage_key TEXT NOT NULL UNIQUE CHECK(length(storage_key)>0 AND instr(storage_key,'/')=0 AND instr(storage_key,char(92))=0 AND storage_key NOT IN ('.','..')),
 original_name TEXT NOT NULL,
 detected_mime TEXT NOT NULL,
 byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 52428800),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 preview_policy TEXT NOT NULL CHECK(preview_policy IN ('inline','download')),
 created_at TEXT NOT NULL
) STRICT;
CREATE TABLE dish (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 50),
 name_key TEXT NOT NULL UNIQUE CHECK(length(name_key)>0),
 category_id TEXT NOT NULL REFERENCES category(id) ON DELETE RESTRICT,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 estimated_minutes INTEGER CHECK(estimated_minutes BETWEEN 1 AND 1440),
 introduction TEXT NOT NULL DEFAULT '' CHECK(length(introduction)<=1000),
 cover_media_id TEXT REFERENCES media(id) ON DELETE RESTRICT,
 created_by TEXT NOT NULL REFERENCES member(id) ON DELETE RESTRICT,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE recipe_step (
 id TEXT PRIMARY KEY,
 dish_id TEXT NOT NULL REFERENCES dish(id) ON DELETE RESTRICT,
 position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 50),
 content TEXT NOT NULL CHECK(length(trim(content)) BETWEEN 1 AND 2000),
 media_id TEXT REFERENCES media(id) ON DELETE RESTRICT,
 UNIQUE(dish_id,position)
) STRICT;
CREATE TABLE vote (
 id TEXT PRIMARY KEY,
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 50),
 initiator_id TEXT NOT NULL REFERENCES member(id) ON DELETE RESTRICT,
 initiator_name TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('active','finished','cancelled')),
 winner_dish_id TEXT,
 created_at TEXT NOT NULL,
 closed_at TEXT,
 CHECK ((status='active' AND winner_dish_id IS NULL AND closed_at IS NULL)
     OR (status='finished' AND winner_dish_id IS NOT NULL AND closed_at IS NOT NULL)
     OR (status='cancelled' AND winner_dish_id IS NULL AND closed_at IS NOT NULL)),
 FOREIGN KEY(id,winner_dish_id) REFERENCES vote_candidate(vote_id,dish_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE UNIQUE INDEX vote_one_active ON vote(status) WHERE status='active';
CREATE TABLE vote_candidate (
 vote_id TEXT NOT NULL REFERENCES vote(id) ON DELETE RESTRICT,
 dish_id TEXT NOT NULL REFERENCES dish(id) ON DELETE RESTRICT,
 dish_name TEXT NOT NULL,
 cover_media_id TEXT REFERENCES media(id) ON DELETE RESTRICT,
 position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 10),
 PRIMARY KEY(vote_id,dish_id),
 UNIQUE(vote_id,position)
) STRICT;
CREATE TABLE vote_ballot (
 vote_id TEXT NOT NULL,
 member_id TEXT NOT NULL REFERENCES member(id) ON DELETE RESTRICT,
 dish_id TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(vote_id,member_id),
 FOREIGN KEY(vote_id,dish_id) REFERENCES vote_candidate(vote_id,dish_id) ON DELETE RESTRICT
) STRICT;
CREATE TABLE menu_item (
 id TEXT PRIMARY KEY,
 menu_date TEXT NOT NULL CHECK(length(menu_date)=10 AND menu_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND coalesce(date(menu_date,'+0 days')=menu_date,0)),
 dish_id TEXT NOT NULL REFERENCES dish(id) ON DELETE RESTRICT,
 dish_name TEXT NOT NULL,
 category_name TEXT NOT NULL,
 cover_media_id TEXT REFERENCES media(id) ON DELETE RESTRICT,
 ordered_by TEXT NOT NULL REFERENCES member(id) ON DELETE RESTRICT,
 ordered_name TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=200),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','cooking','completed','cancelled')),
 cook_id TEXT REFERENCES member(id) ON DELETE RESTRICT,
 cook_name TEXT,
 claimed_at TEXT,
 completed_at TEXT,
 cancelled_by TEXT REFERENCES member(id) ON DELETE RESTRICT,
 cancelled_name TEXT,
 cancelled_at TEXT,
 cancel_reason TEXT NOT NULL DEFAULT '' CHECK(length(cancel_reason)<=200),
 source_vote_id TEXT UNIQUE REFERENCES vote(id) ON DELETE RESTRICT,
 source_item_id TEXT REFERENCES menu_item(id) ON DELETE RESTRICT,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 CHECK(NOT(source_vote_id IS NOT NULL AND source_item_id IS NOT NULL)),
 CHECK ((cook_id IS NULL AND cook_name IS NULL AND claimed_at IS NULL)
     OR (cook_id IS NOT NULL AND cook_name IS NOT NULL AND claimed_at IS NOT NULL)),
 CHECK ((status='pending' AND cook_id IS NULL AND completed_at IS NULL AND cancelled_by IS NULL AND cancelled_name IS NULL AND cancelled_at IS NULL AND cancel_reason='')
     OR (status='cooking' AND cook_id IS NOT NULL AND completed_at IS NULL AND cancelled_by IS NULL AND cancelled_name IS NULL AND cancelled_at IS NULL AND cancel_reason='')
     OR (status='completed' AND cook_id IS NOT NULL AND completed_at IS NOT NULL AND cancelled_by IS NULL AND cancelled_name IS NULL AND cancelled_at IS NULL AND cancel_reason='')
     OR (status='cancelled' AND completed_at IS NULL AND cancelled_by IS NOT NULL AND cancelled_name IS NOT NULL AND cancelled_at IS NOT NULL AND ((cook_id IS NULL AND cancelled_by=ordered_by) OR (cook_id IS NOT NULL AND cancelled_by=cook_id))))
) STRICT;
CREATE INDEX menu_date_status ON menu_item(menu_date,status);
CREATE INDEX menu_ordered_status ON menu_item(ordered_by,status);
CREATE INDEX menu_cook_status ON menu_item(cook_id,status);
CREATE INDEX menu_dish ON menu_item(dish_id);
CREATE TABLE review (
 id TEXT PRIMARY KEY,
 menu_item_id TEXT NOT NULL REFERENCES menu_item(id) ON DELETE RESTRICT,
 member_id TEXT NOT NULL REFERENCES member(id) ON DELETE RESTRICT,
 member_name TEXT NOT NULL,
 rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
 comment TEXT NOT NULL DEFAULT '' CHECK(length(comment)<=1000),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(menu_item_id,member_id)
) STRICT;
CREATE TABLE submission_receipt (
 data_epoch TEXT NOT NULL,
 member_id TEXT NOT NULL REFERENCES member(id) ON DELETE RESTRICT,
 operation TEXT NOT NULL CHECK(operation='menu.batch'),
 idempotency_key TEXT NOT NULL CHECK(length(idempotency_key)>0),
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 response_json TEXT NOT NULL CHECK(json_valid(response_json)),
 created_at TEXT NOT NULL,
 PRIMARY KEY(data_epoch,member_id,operation,idempotency_key)
) STRICT;
CREATE TRIGGER menu_valid_transition BEFORE UPDATE OF status ON menu_item
WHEN NOT(NEW.status=OLD.status OR (OLD.status='pending' AND NEW.status IN ('cooking','cancelled')) OR (OLD.status='cooking' AND NEW.status IN ('pending','completed','cancelled')))
BEGIN SELECT RAISE(ABORT,'MENU_STATE_TRANSITION'); END;
CREATE TRIGGER review_completed_insert BEFORE INSERT ON review
WHEN NOT EXISTS(SELECT 1 FROM menu_item WHERE id=NEW.menu_item_id AND status='completed')
BEGIN SELECT RAISE(ABORT,'REVIEW_REQUIRES_COMPLETED'); END;
CREATE TRIGGER review_completed_update BEFORE UPDATE ON review
WHEN NOT EXISTS(SELECT 1 FROM menu_item WHERE id=NEW.menu_item_id AND status='completed')
BEGIN SELECT RAISE(ABORT,'REVIEW_REQUIRES_COMPLETED'); END;
CREATE TRIGGER ballot_active_insert BEFORE INSERT ON vote_ballot
WHEN NOT EXISTS(SELECT 1 FROM vote WHERE id=NEW.vote_id AND status='active')
BEGIN SELECT RAISE(ABORT,'VOTE_CLOSED'); END;
CREATE TRIGGER ballot_active_update BEFORE UPDATE ON vote_ballot
WHEN NOT EXISTS(SELECT 1 FROM vote WHERE id=NEW.vote_id AND status='active')
BEGIN SELECT RAISE(ABORT,'VOTE_CLOSED'); END;
CREATE TRIGGER vote_valid_transition BEFORE UPDATE OF status ON vote
WHEN NOT(NEW.status=OLD.status OR (OLD.status='active' AND NEW.status IN ('finished','cancelled')))
BEGIN SELECT RAISE(ABORT,'VOTE_STATE_TRANSITION'); END;
COMMIT;
