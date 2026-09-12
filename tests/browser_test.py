#!/usr/bin/env python3
"""Browser interaction checks. Load the supplied HTML deterministically.
Storage is a test-only shim; serialization/reinitialization is NOT a native-browser
persistence or WeChat storage acceptance test. No browser policy is changed.
"""
import base64,json,os,shutil,sys,traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'prototype/index.html').read_text(encoding='utf-8')
RECORDS=[];ERRORS=[]
SHIM="""<script>Object.defineProperty(window,'localStorage',{configurable:true,value:{_data:__DATA__,getItem(k){return this._data[k]??null},setItem(k,v){this._data[k]=String(v)},removeItem(k){delete this._data[k]}}});</script>"""

def main():
 with sync_playwright() as p:
  exe=os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium')
  browser=p.chromium.launch(**({'executable_path':exe} if exe else {}),headless=True,args=['--no-sandbox'])
  def new(storage=None,width=1200,height=1000):
   page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
   page.set_default_timeout(4000)
   page.on('pageerror',lambda e:ERRORS.append(str(e)))
   sh=SHIM.replace('__DATA__',json.dumps(storage or {},ensure_ascii=False).replace('</','<\\/'))
   page.set_content(HTML.replace('<head>','<head>'+sh),wait_until='load')
   return page
  def init(actor='m2'):
   page=new();page.evaluate('__demo.reset()');page.locator(f'[data-action="chooseMember"][data-id="{actor}"]').click();return page
  def check(name,fn):
   try:fn();RECORDS.append({'id':name,'status':'passed'});print('PASS',name)
   except Exception as e:
    RECORDS.append({'id':name,'status':'failed','detail':str(e)});print('FAIL',name,str(e));traceback.print_exc(limit=1)
   for pg in browser.contexts:
    pg.close()
  def click(page,action,id=None):
   selector=f'[data-action="{action}"]'+(f'[data-id="{id}"]' if id else '')
   page.locator(selector).filter(visible=True).first.click()
  def get(page):return page.evaluate('__demo.state()')
  def state_items(page):return get(page)['items']
  def route(page,page_id,param=None):page.evaluate('([p,id])=>__demo.route(p,id)',[page_id,param])
  def identity():
   page=init();click(page,'profile');assert page.locator('#screen h1').inner_text()=='妻子';click(page,'identity');click(page,'chooseMember','m1');click(page,'profile');assert page.locator('#screen h1').inner_text()=='丈夫'
  check('B01_identity_across_pages',identity)
  def duplicate():
   page=init();click(page,'catalog');click(page,'addDish','d1');click(page,'addDish','d1');click(page,'draft');xs=page.locator('[data-draft]');assert xs.count()==2;xs.nth(0).fill('少盐');xs.nth(1).fill('不加糖');before=len(state_items(page));click(page,'submit');page.wait_for_function('__demo.ui().page==="menu"');added=state_items(page)[before:];assert len(added)==2 and added[0]['id']!=added[1]['id'];assert [i['note'] for i in added]==['少盐','不加糖'];assert all(i['orderedBy']=='m2' for i in added)
  check('B02_duplicate_dishes_and_notes',duplicate)
  def unknown():
   page=init();page.evaluate('__demo.scenario("unknown")');click(page,'addDish','d1');click(page,'draft');before=len(state_items(page));click(page,'submit');page.wait_for_function('!__demo.ui().submitting');assert '提交结果尚未确认' in page.locator('#screen').inner_text();assert page.locator('[data-draft]').is_disabled();n=len(state_items(page));assert n==before+1
   data=page.evaluate('localStorage._data');saved=page.evaluate('Object.values(__demo.ui().pending)[0].key');second=new(data);assert second.evaluate('Object.values(__demo.ui().pending)[0].key')==saved;click(second,'reconcile');assert len(state_items(second))==n;assert second.evaluate('Object.keys(__demo.ui().pending).length')==0
  check('B03_unknown_serialization_reinitialization_same_intent',unknown)
  def cancel():
   page=init();route(page,'item','i1');click(page,'cancelItem','i1');page.locator('#cancelReason').fill('今晚临时不吃');click(page,'confirmCancel','i1');x=next(i for i in state_items(page) if i['id']=='i1');assert x['status']=='cancelled' and x['cancelReason']=='今晚临时不吃';assert page.locator('[data-action="claim"]').count()==0
  check('B04_pending_cancel_record',cancel)
  def cooking_permissions():
   page=init();route(page,'item','i2');assert page.locator('[data-action="complete"]').count()==0;assert '当前成员只能查看' in page.locator('#screen').inner_text();page.evaluate('__demo.actor("m1")');click(page,'complete','i2');click(page,'confirmModal');assert next(i for i in state_items(page) if i['id']=='i2')['status']=='completed'
  check('B05_cook_permissions_and_completion',cooking_permissions)
  def overdue():
   page=init('m4');click(page,'overdue');click(page,'item','i4');click(page,'complete','i4');click(page,'confirmModal');x=next(i for i in state_items(page) if i['id']=='i4');assert x['date']=='2026-09-09' and x['status']=='completed';route(page,'overdue');assert '都已经安排好了' in page.locator('#screen').inner_text()
  check('B06_overdue_keeps_date',overdue)
  def vote():
   page=init();route(page,'vote','v1');page.locator('[data-action="ballot"][data-dish="d5"]').click();page.locator('[data-action="ballot"][data-dish="d6"]').click();assert get(page)['votes'][0]['ballots']['m2']==['d5','d6'];assert len(get(page)['votes'][0]['ballots'])==3;click(page,'finishVote','v1');assert '票数并列' in page.locator('#modal').inner_text();page.locator('[data-action="selectWinner"][data-dish="d5"]').click();click(page,'addWinner','v1');xs=[i for i in state_items(page) if i['sourceVote']=='v1'];assert len(xs)==1;assert page.locator('[data-action="addWinner"]').count()==0;route(page,'home');assert '最近一轮' in page.locator('#screen').inner_text();route(page,'item',xs[0]['id']);click(page,'cancelItem',xs[0]['id']);click(page,'confirmCancel',xs[0]['id']);route(page,'vote','v1');assert '已取消' in page.locator('#screen').inner_text();assert page.locator('[data-action="addWinner"]').count()==0
  check('B07_tie_result_discovery_and_once_only_join',vote)
  def cancelled_vote():
   page=init();route(page,'vote','v1');click(page,'cancelVote','v1');click(page,'confirmModal');assert get(page)['votes'][0]['winner'] is None;click(page,'voteForm');page.locator('[data-vote-choice="d1"]').check();page.locator('[data-vote-choice="d2"]').check();page.locator('#voteTitle').fill('明天也想吃的菜');click(page,'startVote');assert len(get(page)['votes'])==2;assert get(page)['votes'][1]['status']=='active'
  check('B08_cancel_vote_and_start_new_round',cancelled_vote)
  def repeat():
   page=init();route(page,'repeat','2026-09-09');assert page.locator('[data-repeat="i5"]').is_disabled();page.locator('[data-repeat="i7"]').check();click(page,'repeatAdd');assert page.evaluate('__demo.ui().page')=='draft';assert page.locator('[data-draft]').input_value()=='不加葱';assert '妻子' in page.locator('#screen').inner_text()
  check('B09_history_repeat_unavailable_and_notes',repeat)
  def member_dependencies():
   page=init();route(page,'members');click(page,'toggleMember','m2');click(page,'confirmModal');assert '请先处理相关事项' in page.locator('#modal').inner_text();assert page.locator('[data-action="dependencyItem"][data-id="i1"]').count()==1;click(page,'dependencyItem','i1');assert page.evaluate('__demo.ui().page')=='item'
  check('B10_member_dependency_navigation',member_dependencies)
  def edit_conflict():
   page=init();page.evaluate('__demo.scenario("version")');page.locator('[data-edit="name"]').fill('保留这份输入');click(page,'saveDish');assert '资料已有新的内容' in page.locator('#modal').inner_text();click(page,'closeModal');assert page.locator('[data-edit="name"]').input_value()=='保留这份输入';assert get(page)['dishes'][0]['name']=='红烧肉'
  check('B11_dish_revision_conflict_preserves_input',edit_conflict)
  def offline():
   page=init();route(page,'dishForm','d1');page.locator('[data-edit="intro"]').fill('尚未保存的做法');page.evaluate('__demo.scenario("offline")');click(page,'saveDish');assert page.locator('[data-edit="intro"]').input_value()=='尚未保存的做法';assert get(page)['dishes'][0]['intro']!='尚未保存的做法';click(page,'online');assert page.locator('[data-edit="intro"]').input_value()=='尚未保存的做法'
  check('B12_offline_form_preserved',offline)
  def form_save():
   page=init();route(page,'dishForm',None);page.locator('[data-edit="name"]').fill('测试家常菜');click(page,'addStep');page.locator('[data-step="0"]').fill('洗净食材。');click(page,'addStep');page.locator('[data-step="1"]').fill('完成烹调。');page.locator('[data-action="stepUp"][data-index="1"]').click();assert page.locator('[data-step="0"]').input_value()=='完成烹调。';click(page,'saveDish');d=next(d for d in get(page)['dishes'] if d['name']=='测试家常菜');assert len(d['steps'])==2 and d['steps'][0]=='完成烹调。'
  check('B13_public_dish_creation_and_step_order',form_save)
  def cover():
   page=init();route(page,'dishForm','d1');page.locator('#coverFile').set_input_files({'name':'原始资料.tiff','mimeType':'image/tiff','buffer':b'II*\x00test'});assert '原始资料.tiff' in page.locator('#screen').inner_text();assert '没有可用预览' in page.locator('#screen').inner_text();assert page.evaluate('__demo.ui().edit.cover.size')==8
  check('B14_file_metadata_download_only_mock',cover)
  def setup():
   page=new();page.evaluate('__demo.reset("setup")');click(page,'testConnection');click(page,'confirmModal');assert page.evaluate('__demo.ui().page')=='setup';page.locator('#setupName').fill('小院人家');page.locator('#setupMembers').fill('小林\n小张');click(page,'setupSave');assert get(page)['family']['name']=='小院人家';assert [m['name'] for m in get(page)['members']]==['小林','小张'];click(page,'chooseMember','member-init-0');assert page.evaluate('__demo.ui().page')=='home'
  check('B15_first_use_initialization_mock',setup)
  def inflight_switch():
   page=init();click(page,'catalog');click(page,'addDish','d1');click(page,'draft');before=len(state_items(page));click(page,'submit');page.evaluate('__demo.actor("m1");__demo.route("profile")');page.wait_for_timeout(600);assert state_items(page)[before]['orderedBy']=='m2';assert page.evaluate('__demo.ui().page')=='profile';assert page.locator('#screen h1').inner_text()=='丈夫';assert page.evaluate('Object.keys(__demo.ui().pending).length')==0
  check('B16_switch_member_during_submission',inflight_switch)
  def review():
   page=init();route(page,'review','i6');before=len(get(page)['reviews']);page.locator('[data-rating="4"]').click();page.locator('#reviewComment').fill('当天的评价');click(page,'saveReview');rs=get(page)['reviews'];assert len(rs)==before+1;assert next(r for r in rs if r['dishId']=='d5' and r['date']=='2026-09-08' and r['memberId']=='m2')['rating']==4;assert page.locator('[data-action="review"]').count()==0;route(page,'review','i6');assert page.locator('[data-action="saveReview"]').count()==0;assert '提交后不能修改' in page.locator('#screen').inner_text()
  check('B17_daily_review_is_single_and_immutable',review)
  def claim_conflict():
   page=init();page.evaluate('__demo.scenario("conflict")');click(page,'claim','i1');click(page,'confirmModal');assert '已被家人认领' in page.locator('#modal').inner_text();assert next(i for i in state_items(page) if i['id']=='i1')['cook']!='m2'
  check('B18_claim_conflict_mock',claim_conflict)
  def navigation_and_width():
   page=init();routes=[('home',None),('catalog',None),('history',None),('profile',None),('draft',None),('dish','d1'),('item','i2'),('review','i3'),('menu','2026-09-09'),('repeat','2026-09-09'),('vote','v1'),('voteForm',None),('manage',None),('dishForm','d1'),('members',None),('categories',None),('settings',None),('identity',None),('connect',None),('overdue',None),('myOrders',None),('myReviews',None)]
   for width in [320,375,430]:
    page.set_viewport_size({'width':width,'height':844})
    for name,param in routes:
     route(page,name,param)
     m=page.evaluate('({body:document.documentElement.scrollWidth,w:innerWidth,screen:document.querySelector("#screen").scrollWidth,client:document.querySelector("#screen").clientWidth})')
     assert m['body']<=m['w']+1 and m['screen']<=m['client']+1,(width,name,m)
  check('B19_22_views_at_320_375_430_without_horizontal_overflow',navigation_and_width)
  def no_external_and_loading():
   page=init();assert page.locator('script[src],link[rel="stylesheet"]').count()==0;page.evaluate('__demo.scenario("loading")');assert page.locator('.spinner').count()==1;click(page,'endLoading');assert '今天，想吃点什么' in page.locator('#screen').inner_text();page.evaluate('__demo.reset("empty")');assert '今天还没有点菜' in page.locator('#screen').inner_text()
  check('B20_loading_empty_and_self_contained_resources',no_external_and_loading)
  def epoch():
   page=init();before=len(state_items(page));page.evaluate('__demo.scenario("epoch")');assert '家庭数据已重新载入' in page.locator('#modal').inner_text();assert len(state_items(page))==before
  check('B21_data_epoch_does_not_auto_submit',epoch)
  def fixed_timezone_setup():
   page=new();page.evaluate('__demo.reset("setup")');click(page,'testConnection');click(page,'confirmModal')
   assert page.locator('#setupTimezone').get_attribute('readonly') is not None
   assert page.locator('#setupTimezone').input_value()=='北京时间 · Asia/Shanghai'
   assert page.locator('#screen select').count()==0
   page.locator('#setupName').fill('平安小家');page.locator('#setupMembers').fill('小周\n小吴')
   click(page,'setupSave');assert get(page)['family']['timezone']=='Asia/Shanghai'
  check('B22_initialization_uses_read_only_beijing_time',fixed_timezone_setup)
  def settings_plan():
   page=init();route(page,'settings');text=page.locator('#screen').inner_text()
   assert '北京时间 · Asia/Shanghai' in text and '04:00' in text and '停服备份' in text
   assert page.locator('[data-action="backup"],[data-action="restore"]').count()==0
   assert page.locator('#screen select').count()==0
  check('B23_settings_shows_plan_without_maintenance_actions',settings_plan)
  # Screenshots are rendered from the same current source, after deterministic setup.
  page=init();shots=ROOT/'prototype/screenshots';shots.mkdir(exist_ok=True)
  page.screenshot(animations="disabled",path=str(shots/'00_交互总览.png'),full_page=True)
  for name,view,param in [('01_首页','home',None),('02_点菜','catalog',None),('04_做菜记录','item','i2'),('05_往日未完成','overdue',None),('06_历史','history',None),('07_投票','vote','v1'),('08_我的','profile',None),('09_菜品编辑','dishForm','d1')]:
   route(page,view,param);page.locator('.phone').screenshot(animations="disabled",path=str(shots/(name+'.png')))
  route(page,'settings');page.locator('.phone').screenshot(animations="disabled",path=str(shots/'15_家庭设置.png'))
  route(page,'catalog');click(page,'addDish','d1');click(page,'addDish','d2');click(page,'draft');page.locator('[data-draft]').nth(0).fill('少放糖，留一点汤汁');page.wait_for_function('!document.querySelector("#toast").classList.contains("show")');page.evaluate('document.activeElement.blur()');page.locator('.phone').screenshot(animations="disabled",path=str(shots/'03_已选确认.png'))
  page.evaluate('__demo.scenario("unknown");__demo.route("draft")');click(page,'submit');page.wait_for_function('!__demo.ui().submitting');page.wait_for_function('!document.querySelector("#toast").classList.contains("show")');page.evaluate('document.activeElement.blur()');page.locator('.phone').screenshot(animations="disabled",path=str(shots/'10_提交待确认.png'))
  page2=new();page2.evaluate('__demo.reset("setup")');click(page2,'testConnection');click(page2,'confirmModal');page2.locator('.phone').screenshot(animations="disabled",path=str(shots/'11_家庭初始化.png'))
  page3=init();route(page3,'item','i1');click(page3,'cancelItem','i1');page3.screenshot(animations="disabled",path=str(shots/'12_取消确认.png'),full_page=True)
  mobile=init();mobile.set_viewport_size({'width':375,'height':812});route(mobile,'home');mobile.screenshot(animations="disabled",path=str(shots/'13_窄屏首页.png'))
  browser_version=browser.version
  browser.close()
 out={'browser':'Chromium','browserVersion':browser_version,'mode':'supplied HTML via set_content; test-only localStorage shim; no policy changes','storageBoundary':'B03 checks JSON persistence payload and new-document reinitialization with same injected store, NOT native file:// storage or real browser restart.','tests':RECORDS,'passed':sum(x['status']=='passed' for x in RECORDS),'total':len(RECORDS),'pageErrors':ERRORS,'scope':'Browser prototype only; no HTTP API, actual multi-device concurrency, WeChat, Linux Docker or media-upload validation.'}
 (ROOT/'tests/results/browser.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print(json.dumps({'passed':out['passed'],'total':out['total'],'pageErrors':ERRORS},ensure_ascii=False))
 return 0 if out['passed']==out['total'] and not ERRORS else 1
if __name__=='__main__':sys.exit(main())
