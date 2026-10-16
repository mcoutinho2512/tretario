#!/bin/sh
# Compacta os GLBs gerados para public/characters/: texturas limitadas a 1024 px (uma 2048² levava 30–75 ms para
# subir à GPU num único quadro — travada visível ao correr perto de pedestres) e geometria EXT_meshopt_compression.
# uso: sh tools/character/pack.sh <pasta-com-glbs-gerados>
set -e
SRC=${1:-$HOME/pv3d-assets-src/out/chars}
DST=public/characters
mkdir -p $DST
for f in "$SRC"/*.glb "$SRC"/../anims.glb; do
  [ -f "$f" ] || continue
  tmp="$DST/.resized_$(basename "$f")"
  npx -y @gltf-transform/cli@4.2.1 resize "$f" "$tmp" --width 1024 --height 1024 >/dev/null
  npx -y @gltf-transform/cli@4.2.1 meshopt "$tmp" "$DST/$(basename "$f")" >/dev/null
  rm -f "$tmp"
done
ls -la $DST
