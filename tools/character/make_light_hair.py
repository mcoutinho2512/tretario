"""
Gera a base clara e neutra de uma textura de cabelo (derivada de asset CC0): tons de cinza, contraste preservado,
média ~0,72, alfa intacto. O jogo tinge essa base com a cor escolhida (preto, castanho, grisalho, loiro...).
uso: python3 make_light_hair.py <entrada.png> <saida.png>   (Pillow)
"""
import sys
from PIL import Image, ImageOps

src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGBA")
r, g, b, a = im.split()
lum = ImageOps.autocontrast(Image.merge("RGB", (r, g, b)).convert("L"), cutoff=1)
# leva para a faixa clara mantendo o detalhe dos fios
lum = lum.point(lambda v: int(95 + v * 0.62))
Image.merge("RGBA", (lum, lum, lum, a)).save(dst)
