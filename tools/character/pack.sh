#!/bin/sh
# Compacta os GLBs gerados (geometria EXT_meshopt_compression) para public/characters/.
# uso: sh tools/character/pack.sh <pasta-com-glbs-gerados>
set -e
SRC=${1:-$HOME/pv3d-assets-src/out/chars}
DST=public/characters
mkdir -p $DST
for f in "$SRC"/*.glb "$SRC"/../anims.glb; do
  [ -f "$f" ] || continue
  npx -y @gltf-transform/cli@4.2.1 meshopt "$f" "$DST/$(basename "$f")" >/dev/null
done
ls -la $DST
