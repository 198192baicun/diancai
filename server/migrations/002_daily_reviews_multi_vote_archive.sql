-- 每日菜品评价只写一次；投票允许每位成员多选。
BEGIN IMMEDIATE;

DROP TRIGGER review_completed_insert;
DROP TRIGGER review_completed_update;

ALTER TABLE review RENAME TO review_v1;
CREATE TABLE review (
 id TEXT PRIMARY KEY,
 menu_item_id TEXT NOT NULL REFERENCES menu_item(id) ON DELETE RESTRICT,
 dish_id TEXT NOT NULL REFERENCES dish(id) ON DELETE RESTRICT,
 review_date TEXT NOT NULL CHECK(length(review_date)=10 AND review_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND coalesce(date(review_date,'+0 days')=review_date,0)),
 member_id TEXT NOT NULL REFERENCES member(id) ON DELETE RESTRICT,
 member_name TEXT NOT NULL,
 rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
 comment TEXT NOT NULL DEFAULT '' CHECK(length(comment)<=1000),
 superseded INTEGER NOT NULL DEFAULT 0 CHECK(superseded IN (0,1)),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
) STRICT;

INSERT INTO review(id,menu_item_id,dish_id,review_date,member_id,member_name,rating,comment,superseded,created_at,updated_at)
SELECT r.id,r.menu_item_id,mi.dish_id,mi.menu_date,r.member_id,r.member_name,r.rating,r.comment,
       CASE WHEN row_number() OVER (
         PARTITION BY r.member_id,mi.dish_id,mi.menu_date
         ORDER BY r.created_at ASC,r.id ASC
       )=1 THEN 0 ELSE 1 END,
       r.created_at,r.updated_at
FROM review_v1 r
JOIN menu_item mi ON mi.id=r.menu_item_id;
DROP TABLE review_v1;

CREATE UNIQUE INDEX review_one_daily_dish
ON review(dish_id,review_date,member_id) WHERE superseded=0;
CREATE INDEX review_item_date ON review(dish_id,review_date,superseded);

CREATE TRIGGER review_completed_insert BEFORE INSERT ON review
WHEN NOT EXISTS(
  SELECT 1 FROM menu_item
  WHERE id=NEW.menu_item_id
    AND dish_id=NEW.dish_id
    AND menu_date=NEW.review_date
    AND status='completed'
)
BEGIN SELECT RAISE(ABORT,'REVIEW_REQUIRES_MATCHING_COMPLETED_ITEM'); END;

CREATE TRIGGER review_immutable BEFORE UPDATE ON review
BEGIN SELECT RAISE(ABORT,'REVIEW_IMMUTABLE'); END;

DROP TRIGGER ballot_active_insert;
DROP TRIGGER ballot_active_update;
ALTER TABLE vote_ballot RENAME TO vote_ballot_v1;
CREATE TABLE vote_ballot (
 vote_id TEXT NOT NULL,
 member_id TEXT NOT NULL REFERENCES member(id) ON DELETE RESTRICT,
 dish_id TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(vote_id,member_id,dish_id),
 FOREIGN KEY(vote_id,dish_id) REFERENCES vote_candidate(vote_id,dish_id) ON DELETE RESTRICT
) STRICT;
INSERT INTO vote_ballot(vote_id,member_id,dish_id,updated_at)
SELECT vote_id,member_id,dish_id,updated_at FROM vote_ballot_v1;
DROP TABLE vote_ballot_v1;

CREATE INDEX vote_ballot_participant ON vote_ballot(vote_id,member_id);
CREATE TRIGGER ballot_active_insert BEFORE INSERT ON vote_ballot
WHEN NOT EXISTS(SELECT 1 FROM vote WHERE id=NEW.vote_id AND status='active')
BEGIN SELECT RAISE(ABORT,'VOTE_CLOSED'); END;
CREATE TRIGGER ballot_active_update BEFORE UPDATE ON vote_ballot
WHEN NOT EXISTS(SELECT 1 FROM vote WHERE id=NEW.vote_id AND status='active')
BEGIN SELECT RAISE(ABORT,'VOTE_CLOSED'); END;

PRAGMA user_version = 2;
COMMIT;
