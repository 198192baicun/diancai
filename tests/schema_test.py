#!/usr/bin/env python3
"""Execute DDL tests only against isolated temporary SQLite databases."""
import json, sqlite3, tempfile, threading, unittest, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
MIGRATIONS=sorted((ROOT/'server/migrations').glob('[0-9][0-9][0-9]_*.sql'))
SQL='\n'.join(path.read_text(encoding='utf-8') for path in MIGRATIONS)
NOW='2026-09-10T00:00:00Z'
class SchemaTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.path=str(Path(self.tmp.name)/'test.db')
        self.db=sqlite3.connect(self.path);self.db.executescript(SQL)
        self.db.execute('PRAGMA journal_mode=WAL');self.db.execute('PRAGMA synchronous=FULL')
        for mid in ['m1','m2','m3']:
            self.db.execute('INSERT INTO member(id,name,name_key,created_at) VALUES(?,?,?,?)',(mid,mid,mid,NOW))
        self.db.execute('INSERT INTO category(id,name,name_key,created_at) VALUES(?,?,?,?)',('c1','荤菜','荤菜',NOW))
        for did in ['d1','d2','d3']:
            self.db.execute('INSERT INTO dish(id,name,name_key,category_id,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',(did,did,did,'c1','m1',NOW,NOW))
        self.add_item('i1');self.db.commit()
    def tearDown(self):
        self.db.close();self.tmp.cleanup()
    def add_item(self,iid,**kw):
        vals={'id':iid,'menu_date':'2026-09-10','dish_id':'d1','dish_name':'当时菜名','category_name':'荤菜','ordered_by':'m1','ordered_name':'当时成员','created_at':NOW,'updated_at':NOW,**kw}
        self.db.execute('INSERT INTO menu_item('+','.join(vals)+') VALUES('+','.join('?' for _ in vals)+')',tuple(vals.values()))
    def finish_item(self,iid='i1'):
        self.db.execute("UPDATE menu_item SET status='cooking',cook_id='m2',cook_name='m2',claimed_at=? WHERE id=?",(NOW,iid))
        self.db.execute("UPDATE menu_item SET status='completed',completed_at=? WHERE id=?",(NOW,iid))
    def add_review(self,rid,item_id='i1',dish_id='d1',review_date='2026-09-10',member_id='m1',rating=5):
        self.db.execute('INSERT INTO review(id,menu_item_id,dish_id,review_date,member_id,member_name,rating,comment,superseded,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',(rid,item_id,dish_id,review_date,member_id,member_id,rating,'',0,NOW,NOW))
    def vote(self,vid='v1'):
        self.db.execute('INSERT INTO vote(id,title,initiator_id,initiator_name,status,created_at) VALUES(?,?,?,?,?,?)',(vid,'今晚吃什么','m1','m1','active',NOW))
        for n,did in enumerate(['d1','d2'],1):
            self.db.execute('INSERT INTO vote_candidate(vote_id,dish_id,dish_name,position) VALUES(?,?,?,?)',(vid,did,did,n))
    def test_01_schema_and_foreign_keys(self):
        self.assertEqual(self.db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])
        self.assertEqual(self.db.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchone()[0],15)
    def test_26_completion_photo_state_and_media_fk(self):
        self.db.execute("INSERT INTO media VALUES('photo','photo','photo.png','image/png',8,?,'inline',?)",('a'*64,NOW))
        with self.assertRaises(sqlite3.IntegrityError):self.db.execute("INSERT INTO menu_completion_photo VALUES('i1',1,'photo')")
        self.finish_item()
        self.db.execute("INSERT INTO menu_completion_photo VALUES('i1',1,'photo')")
        with self.assertRaises(sqlite3.IntegrityError):self.db.execute("INSERT INTO menu_completion_photo VALUES('i1',10,'photo')")
        with self.assertRaises(sqlite3.IntegrityError):self.db.execute("DELETE FROM media WHERE id='photo'")
    def test_02_one_family(self):
        row=(1,'幸福之家','Asia/Shanghai','instance','epoch',NOW)
        self.db.execute('INSERT INTO app_meta VALUES(?,?,?,?,?,?)',row)
        with self.assertRaises(sqlite3.IntegrityError):self.db.execute('INSERT INTO app_meta VALUES(?,?,?,?,?,?)',(2,*row[1:]))
    def test_03_integer_rating(self):
        self.finish_item()
        with self.assertRaises(sqlite3.IntegrityError):self.add_review('r1',rating=1.5)
    def test_04_rating_range(self):
        self.finish_item()
        for n in [0,6]:
            with self.assertRaises(sqlite3.IntegrityError):self.add_review('r'+str(n),rating=n)
    def test_05_review_requires_completed(self):
        with self.assertRaises(sqlite3.IntegrityError):self.add_review('r1')
    def test_06_review_daily_unique_and_immutable(self):
        self.finish_item();self.add_review('r1')
        self.add_item('i2');self.finish_item('i2')
        with self.assertRaises(sqlite3.IntegrityError):self.add_review('r2',item_id='i2',rating=4)
        with self.assertRaises(sqlite3.IntegrityError):self.db.execute("UPDATE review SET rating=4 WHERE id='r1'")
    def test_07_review_allows_same_dish_on_next_date(self):
        self.finish_item();self.add_review('r1')
        self.add_item('i2',menu_date='2026-09-11');self.finish_item('i2')
        self.add_review('r2',item_id='i2',review_date='2026-09-11',rating=4)
        self.assertEqual(self.db.execute("SELECT count(*) FROM review WHERE member_id='m1' AND dish_id='d1'").fetchone()[0],2)
    def test_08_real_dates(self):
        for dt in ['2026-02-31','2026-13-01','not-a-date','2026-00-01','2026-2-01']:
            with self.assertRaises(sqlite3.IntegrityError):self.add_item('bad-'+dt,menu_date=dt)
        self.add_item('valid-leap',menu_date='2024-02-29')
    def test_09_state_shapes(self):
        for kw in [{'status':'cooking'},{'status':'cancelled'},{'status':'completed'},{'status':'pending','completed_at':NOW}]:
            with self.assertRaises(sqlite3.IntegrityError):self.add_item('bad-state',**kw)
    def test_10_terminal_no_return(self):
        self.finish_item()
        with self.assertRaises(sqlite3.IntegrityError):self.db.execute("UPDATE menu_item SET status='pending',cook_id=NULL,cook_name=NULL,claimed_at=NULL,completed_at=NULL WHERE id='i1'")
    def test_11_only_one_active_vote(self):
        self.vote()
        with self.assertRaises(sqlite3.IntegrityError):self.vote('v2')
    def test_12_ballot_candidate_must_belong(self):
        self.vote()
        with self.assertRaises(sqlite3.IntegrityError):self.db.execute('INSERT INTO vote_ballot VALUES(?,?,?,?)',('v1','m1','d3',NOW))
    def test_13_member_can_select_multiple_candidates(self):
        self.vote();self.db.execute('INSERT INTO vote_ballot VALUES(?,?,?,?)',('v1','m1','d1',NOW));self.db.execute('INSERT INTO vote_ballot VALUES(?,?,?,?)',('v1','m1','d2',NOW))
        self.assertEqual(self.db.execute("SELECT count(*) FROM vote_ballot WHERE vote_id='v1' AND member_id='m1'").fetchone()[0],2)
        with self.assertRaises(sqlite3.IntegrityError):self.db.execute('INSERT INTO vote_ballot VALUES(?,?,?,?)',('v1','m1','d1',NOW))
    def test_14_no_ballot_after_closed(self):
        self.vote();self.db.execute("UPDATE vote SET status='cancelled',closed_at=? WHERE id='v1'",(NOW,))
        with self.assertRaises(sqlite3.IntegrityError):self.db.execute('INSERT INTO vote_ballot VALUES(?,?,?,?)',('v1','m1','d1',NOW))
    def test_15_winner_candidate_fk(self):
        self.vote();self.db.commit();self.db.execute("UPDATE vote SET status='finished',closed_at=?,winner_dish_id='d3' WHERE id='v1'",(NOW,))
        with self.assertRaises(sqlite3.IntegrityError):self.db.commit()
        self.db.rollback()
    def test_16_vote_source_unique(self):
        self.vote();self.db.execute("UPDATE vote SET status='finished',closed_at=?,winner_dish_id='d1' WHERE id='v1'",(NOW,));self.add_item('winner-1',source_vote_id='v1')
        with self.assertRaises(sqlite3.IntegrityError):self.add_item('winner-2',source_vote_id='v1')
    def test_17_media_snapshot_protected(self):
        self.db.execute('INSERT INTO media VALUES(?,?,?,?,?,?,?,?)',('image1','uuid-file','原图.png','image/png',100,'a'*64,'inline',NOW))
        self.db.execute("UPDATE menu_item SET cover_media_id='image1' WHERE id='i1'")
        with self.assertRaises(sqlite3.IntegrityError):self.db.execute("DELETE FROM media WHERE id='image1'")
    def test_18_file_limit(self):
        with self.assertRaises(sqlite3.IntegrityError):self.db.execute('INSERT INTO media VALUES(?,?,?,?,?,?,?,?)',('bad','uuid-file','大图.png','image/png',52428801,'a'*64,'inline',NOW))
    def test_19_cancelled_actor_shape(self):
        with self.assertRaises(sqlite3.IntegrityError):self.db.execute("UPDATE menu_item SET status='cancelled',cancelled_by='m3',cancelled_name='m3',cancelled_at=? WHERE id='i1'",(NOW,))
    def test_20_two_connection_claim(self):
        self.db.commit();barrier=threading.Barrier(2);results=[];errors=[]
        def worker(mid):
            db=sqlite3.connect(self.path,timeout=5)
            try:
                db.execute('PRAGMA foreign_keys=ON');barrier.wait(timeout=5)
                db.execute('BEGIN IMMEDIATE')
                n=db.execute("UPDATE menu_item SET status='cooking',cook_id=?,cook_name=?,claimed_at=?,revision=revision+1 WHERE id='i1' AND status='pending' AND revision=1",(mid,mid,NOW)).rowcount
                db.commit();results.append(n)
            except Exception as exc:errors.append(str(exc))
            finally:db.close()
        ts=[threading.Thread(target=worker,args=(m,)) for m in ['m1','m2']]
        for t in ts:t.start()
        for t in ts:t.join(10)
        self.assertFalse(errors,errors);self.assertEqual(sorted(results),[0,1])
    def test_21_receipt_scope_unique(self):
        row=('epoch','m1','menu.batch','key','b'*64,'{"ids":["i1"]}',NOW)
        self.db.execute('INSERT INTO submission_receipt VALUES(?,?,?,?,?,?,?)',row)
        with self.assertRaises(sqlite3.IntegrityError):self.db.execute('INSERT INTO submission_receipt VALUES(?,?,?,?,?,?,?)',row)
    def test_22_transaction_rollback(self):
        self.db.commit();before=self.db.execute('SELECT count(*) FROM menu_item').fetchone()[0]
        try:
            self.db.execute('BEGIN IMMEDIATE');self.add_item('batch-good');self.add_item('batch-bad',dish_id='missing');self.db.commit()
        except sqlite3.IntegrityError:self.db.rollback()
        self.assertEqual(self.db.execute('SELECT count(*) FROM menu_item').fetchone()[0],before)
    def test_23_family_timezone_is_fixed(self):
        for tz in ['UTC','Asia/Tokyo','','Europe/London']:
            with self.subTest(timezone=tz):
                with self.assertRaises(sqlite3.IntegrityError):
                    self.db.execute('INSERT INTO app_meta VALUES(?,?,?,?,?,?)',(1,'幸福之家',tz,'instance','epoch',NOW))
        self.db.execute('INSERT INTO app_meta VALUES(?,?,?,?,?,?)',(1,'幸福之家','Asia/Shanghai','instance','epoch',NOW))
        self.assertEqual(self.db.execute('SELECT timezone FROM app_meta').fetchone()[0],'Asia/Shanghai')
    def test_24_family_timezone_cannot_be_null_or_changed(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute('INSERT INTO app_meta VALUES(?,?,?,?,?,?)',(1,'幸福之家',None,'instance','epoch',NOW))
        self.db.execute('INSERT INTO app_meta VALUES(?,?,?,?,?,?)',(1,'幸福之家','Asia/Shanghai','instance','epoch',NOW))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE app_meta SET timezone='UTC' WHERE singleton=1")
        self.assertEqual(self.db.execute('SELECT timezone FROM app_meta').fetchone()[0],'Asia/Shanghai')
    def test_25_v1_migration_preserves_duplicate_daily_reviews(self):
        legacy_path=str(Path(self.tmp.name)/'legacy.db')
        legacy=sqlite3.connect(legacy_path)
        try:
            legacy.executescript(MIGRATIONS[0].read_text(encoding='utf-8'))
            for mid in ['lm1','lm2']:
                legacy.execute('INSERT INTO member(id,name,name_key,created_at) VALUES(?,?,?,?)',(mid,mid,mid,NOW))
            legacy.execute('INSERT INTO category(id,name,name_key,created_at) VALUES(?,?,?,?)',('lc1','荤菜','荤菜',NOW))
            legacy.execute('INSERT INTO dish(id,name,name_key,category_id,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',('ld1','旧菜','旧菜','lc1','lm1',NOW,NOW))
            for iid,created in [('li1','2026-09-10T00:00:00Z'),('li2','2026-09-10T00:01:00Z')]:
                legacy.execute("INSERT INTO menu_item(id,menu_date,dish_id,dish_name,category_name,ordered_by,ordered_name,status,cook_id,cook_name,claimed_at,completed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'completed',?,?,?,?,?,?)",(iid,'2026-09-10','ld1','旧菜','荤菜','lm1','lm1','lm2','lm2',created,created,created,created))
            legacy.execute('INSERT INTO review VALUES(?,?,?,?,?,?,?,?)',('lr1','li1','lm1','lm1',5,'先提交',NOW,NOW))
            legacy.execute('INSERT INTO review VALUES(?,?,?,?,?,?,?,?)',('lr2','li2','lm1','lm1',3,'后提交','2026-09-10T00:02:00Z','2026-09-10T00:02:00Z'))
            legacy.commit()
            legacy.executescript(MIGRATIONS[1].read_text(encoding='utf-8'))
            rows=legacy.execute('SELECT id,dish_id,review_date,superseded FROM review ORDER BY id').fetchall()
            self.assertEqual(rows,[('lr1','ld1','2026-09-10',0),('lr2','ld1','2026-09-10',1)])
            self.assertEqual(legacy.execute('PRAGMA user_version').fetchone()[0],2)
            with self.assertRaises(sqlite3.IntegrityError):
                legacy.execute("UPDATE review SET rating=4 WHERE id='lr1'")
        finally:
            legacy.close()

class RecordedResult(unittest.TextTestResult):
    def __init__(self,*a,**kw):super().__init__(*a,**kw);self.records=[]
    def addSuccess(self,test):super().addSuccess(test);self.records.append({'id':test._testMethodName,'status':'passed'})
    def addFailure(self,test,err):super().addFailure(test,err);self.records.append({'id':test._testMethodName,'status':'failed','detail':str(err[1])})
    def addError(self,test,err):super().addError(test,err);self.records.append({'id':test._testMethodName,'status':'error','detail':str(err[1])})
if __name__=='__main__':
    res=unittest.TextTestRunner(verbosity=2,resultclass=RecordedResult).run(unittest.defaultTestLoader.loadTestsFromTestCase(SchemaTests))
    out=ROOT/'tests/results/schema.json';out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps({'sqliteVersion':sqlite3.sqlite_version,'tests':res.records,'passed':len([x for x in res.records if x['status']=='passed']),'total':res.testsRun,'scope':'Temporary database DDL and two-connection conditional update; not HTTP API.'},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    sys.exit(0 if res.wasSuccessful() else 1)
