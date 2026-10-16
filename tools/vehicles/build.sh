#!/bin/sh
# Gera public/vehicles/vehicles.glb: modelagem procedural no Blender + compressão meshopt (gltf-transform).
# uso: sh tools/vehicles/build.sh [--render <pasta_png>]   (render de conferência não exporta)
set -e
cd "$(dirname "$0")/../.."
BLENDER=${BLENDER:-blender}
TMP=${TMPDIR:-/tmp}/pv_vehicles_raw.glb
if [ "$1" = "--render" ]; then
  "$BLENDER" -b --python tools/vehicles/build_vehicles.py -- "$TMP" --render "$2"
  exit 0
fi
"$BLENDER" -b --python tools/vehicles/build_vehicles.py -- "$TMP" | grep '\[veh\]'
npx -y @gltf-transform/cli@4.5.1 meshopt "$TMP" public/vehicles/vehicles.glb --level medium
ls -l public/vehicles/vehicles.glb
