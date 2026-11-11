#!/usr/bin/env python3
"""Собирает офлайн-галерею Bashkir Culture Kit: design/culture-kit/gallery-site/index.html.

Запуск из корня репозитория после того, как изображения лежат в design/culture-kit/0X-*/:
    python3 scripts/build-culture-gallery.py
Галерея ссылается на исходные изображения относительными путями — открывайте
index.html в браузере локально, интернет не нужен.
"""
import os, re

ROOT = os.path.join(os.path.dirname(__file__), "..")
KIT = os.path.abspath(os.path.join(ROOT, "design", "culture-kit"))
OUT_DIR = os.path.join(KIT, "gallery-site")
os.makedirs(OUT_DIR, exist_ok=True)

FOLDERS = [
    ("01-ornament-kuskar", "Орнамент кускар", "Завиток «бараньего рога» — сердце башкирского узора"),
    ("02-vyshivka", "Вышивка", "Тамбур, золотое шитьё, полотенца, галуны"),
    ("03-symbols", "Символы", "Курай, герб, знамя Салавата Юлаева"),
    ("04-kostyum-ukrasheniya", "Костюм и украшения", "Елән, камзол, кашмау, серебро и кораллы"),
    ("05-yurta-byt", "Юрта и быт", "Решётка-кереге, войлок, вышитые ленты"),
    ("06-shulgan-tash", "Шульган-Таш", "Петроглифы 16–20 тыс. лет, ЮНЕСКО-2025"),
    ("07-nature-landmarks", "Природа и памятники", "Салават Юлаев, Иремель, мёд, кони"),
    ("08-modern-branding", "Современное и эпос", "Курай-эмблемы, полосы узора, Урал-батыр, арабица"),
]

def parse_manifest(path):
    caps = {}
    if not os.path.exists(path):
        return caps
    for line in open(path, encoding="utf-8"):
        m = re.match(r"\s*\|?\s*`?([\w\-.]+\.(?:png|jpg|jpeg|webp))`?\s*\|\s*([^|]+)\|", line, re.I)
        if m:
            caps[m.group(1).strip()] = m.group(2).strip()
    return caps

CSS = """:root{--ohra:#A63A22;--gold:#D4A017;--sun:#F2C230;--kuray:#2E7D46;--felt:#26211E;--kiz:#F5EFE3}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--felt);color:var(--kiz);font-family:Georgia,serif;line-height:1.55}
header{padding:56px 6vw 30px;border-bottom:3px solid var(--ohra)}
.tag{letter-spacing:.25em;text-transform:uppercase;font-size:12px;color:var(--sun)}
h1{font-size:clamp(28px,4.5vw,52px);font-weight:400;margin:12px 0 8px}
h1 em{color:var(--gold);font-style:normal}
.sub{max-width:820px;color:#cfc4ae;font-size:17px}
.palette{display:flex;flex-wrap:wrap;gap:10px;margin-top:26px}
.sw{width:120px;border-radius:6px;overflow:hidden;font-size:11px;background:#332c27}
.sw i{display:block;height:44px}.sw span{display:block;padding:6px 8px;color:#d8cdb8}
nav{position:sticky;top:0;z-index:5;background:#1d1916;border-bottom:1px solid #4a4036;padding:10px 6vw;display:flex;gap:8px;flex-wrap:wrap}
nav a{color:var(--kiz);text-decoration:none;font-size:13px;padding:5px 12px;border:1px solid #4a4036;border-radius:20px}
nav a:hover{border-color:var(--gold);color:var(--sun)}
section{padding:44px 6vw 20px}
h2{font-weight:400;font-size:clamp(22px,3vw,34px);border-left:6px solid var(--ohra);padding-left:16px}
.lead{color:#bfb299;margin:8px 0 26px 22px;font-size:15px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:18px}
figure{background:#332c27;border:1px solid #4a4036;border-radius:8px;overflow:hidden;transition:.2s}
figure:hover{border-color:var(--gold);transform:translateY(-3px)}
figure img{width:100%;height:220px;object-fit:cover;display:block;background:#f5efe3}
figcaption{padding:10px 12px;font-size:12.5px;color:#c9bda6;min-height:52px}
figcaption b{display:block;color:var(--sun);font-weight:400;font-size:11px;margin-bottom:3px;word-break:break-all}
footer{padding:40px 6vw 60px;border-top:3px solid var(--ohra);margin-top:40px;color:#9a8e79;font-size:13px}
footer b{color:var(--gold);font-weight:400}"""

SWATCHES = [("#A63A22","Охра"),("#B91C1C","Тамбур"),("#D4A017","Золото"),("#F2C230","Солнце"),
            ("#2E7D46","Курай"),("#2F5D8A","Агидель"),("#26211E","Войлок"),("#F5EFE3","Киз")]

parts = [f"""<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bashkir Culture Kit — визуальная база Башкортостана</title>
<style>{CSS}</style></head><body>
<header>
  <div class="tag">Хакатон · Афиша культурных событий Башкортостана</div>
  <h1>Bashkir <em>Culture</em> Kit</h1>
  <p class="sub">Вся визуально-культурная база региона в одном месте: орнамент кускар, тамбурная вышивка,
  цветок курая, знамя Салавата, серебро и кораллы, юрта, петроглифы Шульган-Таш (16–20 тыс. лет, ЮНЕСКО-2025),
  Иремель и бортевой мёд.</p>
  <div class="palette">"""]
for hexv, name in SWATCHES:
    parts.append(f'<div class="sw"><i style="background:{hexv}"></i><span>{name} {hexv}</span></div>')
parts.append('</div></header><nav>')

sections = []
for folder, title, sub in FOLDERS:
    d = os.path.join(KIT, folder)
    caps = parse_manifest(os.path.join(d, "manifest.md"))
    items = []
    if os.path.isdir(d):
        for f in sorted(os.listdir(d)):
            if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                items.append((f"../{folder}/{f}", caps.get(f, ""), f"{folder}/{f}"))
    sections.append((folder, title, sub, items))

for folder, title, sub, items in sections:
    parts.append(f'<a href="#{folder}">{title} · {len(items)}</a>')
parts.append("</nav>")

for folder, title, sub, items in sections:
    parts.append(f'<section id="{folder}"><h2>{title}</h2><p class="lead">{sub}</p><div class="grid">')
    for src, cap, orig in items:
        parts.append(f'<figure><img loading="lazy" src="{src}" alt="{title}"><figcaption><b>{orig}</b>{cap}</figcaption></figure>')
    parts.append("</div></section>")

total = sum(len(s[3]) for s in sections)
parts.append(f"""<footer><b>Bashkir Culture Kit</b> · {total} референсов в 8 разделах ·
собрано из открытых источников как вдохновение для дизайна. Финальные узоры — перерисовывать вектором;
файлы с вотермарками — только референсы. Смыслы и история символов — в <b>research/culture-brief.md</b>, каталог — в <b>CATALOG.md</b>.</footer>
</body></html>""")

out = os.path.join(OUT_DIR, "index.html")
open(out, "w", encoding="utf-8").write("".join(parts))
print(f"Галерея собрана: {out} ({total} изображений)")
