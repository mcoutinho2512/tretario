"""Resumo de um GLB: imagens (bytes, tipo), malhas (triângulos), animações. uso: python3 glb_info.py arquivo.glb"""
import json, struct, sys
for f in sys.argv[1:]:
    b = open(f, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + n])
    bv = j.get('bufferViews', [])
    print(f'== {f} ({len(b)/1e6:.2f} MB)')
    for i, im in enumerate(j.get('images', [])):
        print(f"  img {im.get('name')}: {bv[im['bufferView']]['byteLength']/1e3:.0f} KB {im.get('mimeType')}")
    acc = j.get('accessors', [])
    for m in j.get('meshes', []):
        t = sum(acc[p['indices']]['count'] // 3 for p in m['primitives'] if 'indices' in p)
        print(f"  mesh {m.get('name')}: {t} tris, {len(m['primitives'])} prim")
    if j.get('animations'):
        print('  anims', [a['name'] for a in j['animations']])
