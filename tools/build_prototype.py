#!/usr/bin/env python3
"""Build one self-contained HTML file from the checked-in prototype sources."""
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'prototype/src'
css = (SRC / 'styles.css').read_text(encoding='utf-8')
domain = (SRC / 'domain.js').read_text(encoding='utf-8')
app = (SRC / 'app.js').read_text(encoding='utf-8')
html = '''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="light"><title>家庭点菜 · 交互原型</title><style>__CSS__</style></head>
<body><div class="shell"><aside class="rail"><div class="brand"><span class="brand-logo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 13h16a8 8 0 0 1-16 0Z M3 13h18 M8 4v4 M12 3v5 M16 4v4"/></svg></span>家庭点菜</div><h1 class="tagline">一起决定，<br>好好吃饭。</h1><p>一个家庭，一份公共菜谱。<br>从今晚想吃什么，到饭后的一句好评。</p><div class="railnav"><button data-action="home"><span>01</span>今日菜单</button><button data-action="catalog"><span>02</span>家庭菜品</button><button data-action="history"><span>03</span>过往记录</button><button data-action="profile"><span>04</span>我的与公共管理</button></div><div class="scene-box"><label for="scene">交互场景</label><select id="scene"><option value="normal">标准演示数据</option><option value="setup">首次连接与初始化</option><option value="empty">今日空菜单</option><option value="offline">离线 · 保留当前内容</option><option value="loading">加载状态</option><option value="unknown">下次提交 · 响应未知</option><option value="conflict">下次认领 · 已被家人认领</option><option value="version">编辑菜谱 · 版本冲突</option><option value="epoch">家庭数据代次变化</option></select><button class="secondary" data-action="applyScene">进入所选场景</button></div><div class="rail-foot">浏览器本机交互演示 · 设计 1.0<br>无需联网，无真实后端操作<br>数据可在场景中重置。</div></aside><section class="phone" aria-label="家庭点菜移动端原型"><div class="statusbar"><span>9:41</span><span class="capsule">•••　│　◉</span></div><div class="mobile-tools"><button data-action="showScenes">演示场景 · 本机数据</button></div><main id="screen" class="screen" tabindex="-1"></main><nav id="nav" class="nav" aria-label="主导航"></nav><div id="toast" class="toast" role="status" aria-live="polite"></div></section></div><dialog id="modal" aria-modal="true"></dialog><script>__DOMAIN__</script><script>__APP__</script></body></html>'''
# Escape any closing script sequence inside future string literals.
html = html.replace('__CSS__', css).replace('__DOMAIN__', domain.replace('</script', '<\\/script')).replace('__APP__', app.replace('</script', '<\\/script'))
out = ROOT / 'prototype/index.html'
out.write_text(html, encoding='utf-8')
print(f'Built {out.name}: {out.stat().st_size:,} bytes')
