"""Folha de contato: python3 tools/qa/contact_sheet.py saida.jpg cols largura img1.png img2.png ..."""
import sys
from PIL import Image, ImageDraw

out, cols, w = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
paths = sys.argv[4:]
ims = [Image.open(p).convert('RGB') for p in paths]
h = int(w * ims[0].height / ims[0].width)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * w, rows * h), (30, 30, 30))
d = ImageDraw.Draw(sheet)
for i, (im, p) in enumerate(zip(ims, paths)):
    x, y = (i % cols) * w, (i // cols) * h
    sheet.paste(im.resize((w, h)), (x, y))
    d.text((x + 6, y + 4), p.split('/')[-1].rsplit('.', 1)[0], fill=(255, 255, 0))
sheet.save(out, quality=88)
