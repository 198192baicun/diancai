#!/usr/bin/env python3
"""Assemble existing prototype screenshots into an offline contact sheet/index.

Requires Pillow and an installed CJK font. This tool does not capture pages,
render new UI or distribute font files; run the browser checks first.
"""
from __future__ import annotations
import argparse
import html
import math
from pathlib import Path
import subprocess
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SHOTS = ROOT / 'prototype/screenshots'
CARDS = [
    ('01_首页.png','首页'),('02_点菜.png','点菜'),
    ('03_已选确认.png','已选确认'),('04_做菜记录.png','做菜记录'),
    ('05_往日未完成.png','往日未完成'),('06_历史.png','历史'),
    ('07_投票.png','家庭投票'),('08_我的.png','我的'),
    ('09_菜品编辑.png','公共菜品表单'),('10_提交待确认.png','提交结果待确认'),
    ('11_家庭初始化.png','家庭初始化'),('15_家庭设置.png','家庭与服务设置'),
]

def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--font', type=Path, help='Installed CJK font path; never copied into the artifact')
    args=parser.parse_args()
    font_path=args.font
    if font_path is None:
        result=subprocess.run(['fc-match','Noto Sans CJK SC','-f','%{file}'],
                              check=True,capture_output=True,text=True,timeout=10)
        font_path=Path(result.stdout.strip())
    if not font_path.is_file():
        raise SystemExit('An installed CJK font is required. Supply --font PATH.')
    for filename,_ in CARDS:
        if not (SHOTS/filename).is_file():
            raise SystemExit(f'Missing screenshot {filename}; run tests/browser_test.py first.')
    titlefont=ImageFont.truetype(str(font_path),44)
    smallfont=ImageFont.truetype(str(font_path),20)
    captionfont=ImageFont.truetype(str(font_path),23)
    width, margin, gap, cols = 1500, 42, 26, 4
    card_width=(width-margin*2-gap*(cols-1))//cols
    image_width=card_width-16
    image_height=round(image_width*900/420)
    card_height=image_height+66
    top=164; rows=math.ceil(len(CARDS)/cols)
    sheet=Image.new('RGB',(width,top+rows*(card_height+gap)+28),'#F1F4F9')
    draw=ImageDraw.Draw(sheet)
    draw.text((margin,30),'家庭点菜 · 交互原型',font=titlefont,fill='#1D2942')
    draw.text((margin,99),'项目设计 1.0  /  北京时间  /  浏览器演示数据，非微信真机截图',font=smallfont,fill='#536787')
    for i,(filename,label) in enumerate(CARDS):
        x=margin+(i%cols)*(card_width+gap);y=top+(i//cols)*(card_height+gap)
        draw.rounded_rectangle((x,y,x+card_width,y+card_height),radius=16,fill='white')
        draw.text((x+14,y+12),f'{i+1:02d}  {label}',font=captionfont,fill='#263653')
        with Image.open(SHOTS/filename) as im:
            im=im.convert('RGB');im.thumbnail((image_width,image_height),Image.Resampling.LANCZOS)
            sheet.paste(im,(x+(card_width-im.width)//2,y+53))
    sheet.save(SHOTS/'14_页面总览.png',optimize=True)
    all_cards=[('00_交互总览.png','桌面交互工作区'),*CARDS,
               ('12_取消确认.png','取消确认'),('13_窄屏首页.png','窄屏首页'),
               ('14_页面总览.png','页面总览')]
    sections=''.join(f'<a class="card" href="screenshots/{html.escape(name)}"><h2>{html.escape(label)}</h2>'
                     f'<img loading="lazy" src="screenshots/{html.escape(name)}" alt="{html.escape(label)}"></a>'
                     for name,label in all_cards)
    page='''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>家庭点菜 · 页面预览</title><style>body{margin:0;padding:32px;font-family:system-ui,sans-serif;background:#eff3f8;color:#192841}header{max-width:1300px;margin:0 auto 28px}a{color:#235bb0}.grid{max-width:1300px;margin:auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:24px}.card{text-decoration:none;padding:18px;border-radius:18px;background:white;overflow:hidden}.card h2{font-size:18px}.card img{width:100%;height:auto;display:block}p{line-height:1.8;color:#586b89}</style></head><body><header><h1>家庭点菜 · 页面预览</h1><p>截图来自同一份浏览器原型，不是微信真机验收记录。点击图片查看原尺寸。</p><a href="index.html">进入可点击原型 →</a></header><main class="grid">'''+sections+'</main></body></html>'
    (ROOT/'prototype/preview.html').write_text(page,encoding='utf-8')
    print(f'Built contact sheet and index: {len(all_cards)} linked screenshots')

if __name__=='__main__':
    main()
