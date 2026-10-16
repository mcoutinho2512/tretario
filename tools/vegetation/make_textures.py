#!/usr/bin/env python3
"""
Gera as texturas da vegetação (rodada 5) em public/vegetation/:
  leaves.webp  — atlas 1024² (RGBA) com 4 células de 512²:
                 [0] ramo de folhas pequenas elípticas (oiti/cássia/ficus/munguba) — base: ash_color.png do ez-tree
                 [1] ramo de folhas largas obovadas (amendoeira)                     — base: aspen_color.png recolorido p/ verde
                 [2] ramo florido amarelo (ipê-amarelo)                              — base: aspen_color.png original
                 [3] folha de palmeira (pinada)                                      — desenhada proceduralmente aqui
  bark.jpg     — atlas 1024×512: [esq] Bark Platanus (Poly Haven, CC0) [dir] Palm Tree Bark (Poly Haven, CC0)
  bark_n.jpg   — normal maps (convenção OpenGL) no mesmo arranjo

uso: python3 -I tools/vegetation/make_textures.py <dir-com-downloads-poly-haven>
(os JPGs 1k da Poly Haven são baixados para esse diretório se não existirem)
Licenças/origens: docs/licenses/vegetation_props.md
"""
import math
import os
import random
import sys
import urllib.request

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'vegetation')
EZ = os.path.join(ROOT, 'node_modules', '@dgreenheck', 'ez-tree', 'src', 'lib', 'assets', 'leaves')
DL = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '.cache', 'polyhaven')
PH = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k'
FILES = {
    'bark_platanus_diff_1k.jpg': f'{PH}/bark_platanus/bark_platanus_diff_1k.jpg',
    'bark_platanus_nor_gl_1k.jpg': f'{PH}/bark_platanus/bark_platanus_nor_gl_1k.jpg',
    'palm_tree_bark_diff_1k.jpg': f'{PH}/palm_tree_bark/palm_tree_bark_diff_1k.jpg',
    'palm_tree_bark_nor_gl_1k.jpg': f'{PH}/palm_tree_bark/palm_tree_bark_nor_gl_1k.jpg',
}
CELL = 512


def fetch():
    os.makedirs(DL, exist_ok=True)
    for name, url in FILES.items():
        p = os.path.join(DL, name)
        if not os.path.exists(p):
            print('baixando', url)
            urllib.request.urlretrieve(url, p)


def dilate_rgb(im: Image.Image) -> Image.Image:
    """Espalha a cor das folhas para os pixels transparentes (evita halo escuro nos mipmaps)."""
    rgb = im.convert('RGB')
    a = im.getchannel('A')
    acc = Image.new('RGB', im.size, (40, 60, 30))
    for radius in (24, 8, 2):
        blurred = rgb.filter(ImageFilter.GaussianBlur(radius))
        wa = a.filter(ImageFilter.GaussianBlur(radius))
        # normaliza pela cobertura (média ponderada pela alfa)
        bp, wp = blurred.load(), wa.load()
        ap = acc.load()
        for y in range(im.size[1]):
            for x in range(im.size[0]):
                w = wp[x, y]
                if w > 3:
                    r, g, b = bp[x, y]
                    k = 255.0 / w
                    ap[x, y] = (min(255, int(r * k)), min(255, int(g * k)), min(255, int(b * k)))
    out = Image.composite(rgb, acc, a.point(lambda v: 255 if v > 8 else 0))
    out.putalpha(a)
    return out


def recolor(im: Image.Image, hue_deg: float, sat_mul: float, val_mul: float) -> Image.Image:
    hsv = im.convert('RGB').convert('HSV')
    h, s, v = hsv.split()
    h = h.point(lambda _: int(hue_deg / 360 * 255))
    s = s.point(lambda x: min(255, int(x * sat_mul)))
    v = v.point(lambda x: min(255, int(x * val_mul)))
    out = Image.merge('HSV', (h, s, v)).convert('RGB')
    out.putalpha(im.getchannel('A'))
    return out


def load_leaf(name: str) -> Image.Image:
    return Image.open(os.path.join(EZ, f'{name}_color.png')).convert('RGBA')


def palm_frond(size: int) -> Image.Image:
    """Folha pinada (Roystonea/Syagrus): ráquis central e folíolos arqueados, ponta no topo (v=1)."""
    s = size * 2  # supersampling
    im = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    rnd = random.Random(7)
    cx = s / 2
    # ráquis
    d.line([(cx, s * 0.99), (cx, s * 0.02)], fill=(110, 112, 60, 255), width=int(s * 0.012))
    n = 46
    for i in range(n):
        t = i / (n - 1)  # 0 base → 1 ponta
        y = s * (0.96 - 0.92 * t)
        ln = s * 0.47 * math.sin(math.pi * (0.12 + 0.88 * t)) ** 0.7 * (0.85 + 0.15 * rnd.random())
        for side in (-1, 1):
            ang = math.radians(28 + 22 * t + rnd.uniform(-6, 6))
            ex = cx + side * ln * math.cos(ang)
            ey = y - ln * math.sin(ang) * 0.55
            # folíolo afilado: polígono ao longo de uma curva que cai na ponta
            w = s * 0.011 * (1.25 - 0.5 * t)
            pts_l, pts_r = [], []
            for k in range(9):
                u = k / 8
                px = cx + side * 4 + (ex - cx) * u
                py = y + (ey - y) * u + ln * 0.10 * u * u
                hw = w * math.sin(math.pi * min(1.0, 0.15 + u)) * (1 - 0.85 * u)
                pts_l.append((px, py - hw))
                pts_r.append((px, py + hw))
            g = 70 + rnd.randint(-14, 14)
            col = (int(g * 0.55), g + 26, int(g * 0.33), 255)
            d.polygon(pts_l + pts_r[::-1], fill=col)
    im = im.resize((size, size), Image.LANCZOS)
    return im


def main():
    os.makedirs(OUT, exist_ok=True)
    fetch()
    # ---------------- folhas ----------------
    atlas = Image.new('RGBA', (CELL * 2, CELL * 2), (0, 0, 0, 0))
    small = load_leaf('ash').resize((CELL, CELL), Image.LANCZOS)
    small = recolor(small, 100, 1.05, 0.9)  # verde mais "tropical" e um pouco mais escuro
    broad = recolor(load_leaf('aspen').resize((CELL, CELL), Image.LANCZOS), 96, 0.78, 0.62)
    ipe = load_leaf('aspen').resize((CELL, CELL), Image.LANCZOS)
    ipe = recolor(ipe, 48, 1.25, 1.12)  # amarelo-ouro do ipê
    frond = palm_frond(CELL)
    for i, im in enumerate((small, broad, ipe, frond)):
        atlas.paste(dilate_rgb(im), ((i % 2) * CELL, (i // 2) * CELL))
    atlas.save(os.path.join(OUT, 'leaves.webp'), 'WEBP', quality=88, method=6)
    # ---------------- casca ----------------
    for suffix, out in (('diff', 'bark.jpg'), ('nor_gl', 'bark_n.jpg')):
        a = Image.open(os.path.join(DL, f'bark_platanus_{suffix}_1k.jpg')).convert('RGB').resize((512, 512), Image.LANCZOS)
        if suffix == 'diff':  # casca mais clara/acinzentada (oiti, amendoeira e ficus têm casca cinza-amarronzada)
            a = ImageEnhance.Brightness(ImageEnhance.Color(a).enhance(0.7)).enhance(1.45)
        b = Image.open(os.path.join(DL, f'palm_tree_bark_{suffix}_1k.jpg')).convert('RGB').resize((512, 512), Image.LANCZOS)
        img = Image.new('RGB', (1024, 512))
        img.paste(a, (0, 0))
        img.paste(b, (512, 0))
        img.save(os.path.join(OUT, out), 'JPEG', quality=82, optimize=True, progressive=True)
    for f in sorted(os.listdir(OUT)):
        print(f, os.path.getsize(os.path.join(OUT, f)) // 1024, 'KB')


if __name__ == '__main__':
    main()
