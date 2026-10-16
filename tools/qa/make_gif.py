"""Monta GIFs a partir dos quadros gravados pelo walkthrough (Pillow). uso: python3 tools/qa/make_gif.py"""
import glob, os
from PIL import Image
import sys
OUT = sys.argv[1] if len(sys.argv) > 1 else 'screenshots/walkthrough'
for d in sorted(glob.glob(f'{OUT}/frames_*')):
    frames = [Image.open(f).convert('RGB').resize((480, 300)) for f in sorted(glob.glob(f'{d}/*.jpg'))[::2]]
    if not frames: continue
    name = os.path.basename(d).replace('frames_', '')
    pal = [f.quantize(colors=64, method=Image.Quantize.MEDIANCUT) for f in frames]
    pal[0].save(f'docs/screenshots/vertical_slice/{name}.gif', save_all=True, append_images=pal[1:], duration=250, loop=0, optimize=True)
    print(name, len(frames), 'quadros')
