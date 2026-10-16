## HIGH (carga 2.379s)

| ponto | heap bruto MB | heap V8 pós-GC MB | ArrayBuffers MB | performance.memory pós-GC MB | GPU est. MB | GPU real (livro) MB | texturas | geometrias | materiais |
|---|---|---|---|---|---|---|---|---|---|
| spawn | 146.7 | 48.5 | 38.9 | 87.4 | 356 | 535.5 | 81 | 708 | 203 |
| central | 52.7 | 49 | 39.2 | 88.2 | 356.8 | 536.1 | 81 | 711 | 204 |
| meio | 140.7 | 49.7 | 39.3 | 89.1 | 372.4 | 551.7 | 81 | 719 | 216 |
| candelaria | 54.5 | 49.3 | 36.1 | 85.5 | 363.5 | 548.1 | 82 | 732 | 218 |
| meio_volta | 131.1 | 49.8 | 43.4 | 93.2 | 372.9 | 550.3 | 82 | 738 | 218 |
| central_volta | 47.8 | 50 | 43.5 | 93.5 | 368.2 | 545.5 | 82 | 729 | 218 |
| apos_loop | 70 | 50.6 | 43.6 | 94.2 | 368.5 | 545.6 | 86 | 729 | 249 |

Categorias (ponto: candelaria)

| categoria | texturas | tex GPU MB | tex CPU MB | geometrias | geo GPU MB | geo CPU MB | materiais | esqueletos | bones MB |
|---|---|---|---|---|---|---|---|---|---|
| chunks/ground | 26 | 65.4 | 0 | 424 | 5.2 | 2.5 | 13 | 0 | 0 |
| shadows | 1 | 64 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| chunks/buildings | 2 | 3 | 0 | 87 | 51.4 | 1.4 | 1 | 0 | 0 |
| characters/player | 16 | 48.7 | 40.5 | 14 | 0.9 | 0.9 | 14 | 14 | 0.1 |
| landmarks | 5 | 17.7 | 13.3 | 44 | 24.6 | 0.1 | 9 | 0 | 0 |
| vegetation | 18 | 24.3 | 8.3 | 5 | 3.6 | 3.6 | 3 | 0 | 0 |
| monuments | 2 | 24.3 | 0.3 | 32 | 0.4 | 0.4 | 9 | 0 | 0 |
| events | 5 | 10.7 | 9.4 | 56 | 0 | 0 | 29 | 0 | 0 |
| characters/npc | 6 | 8 | 6 | 19 | 1 | 1 | 93 | 93 | 0.7 |
| environment | 1 | 6 | 0 | 2 | 0.1 | 0.1 | 2 | 0 | 0 |
| vehicles/traffic | 0 | 0 | 0 | 10 | 2.3 | 2.3 | 1 | 0 | 0 |
| props | 0 | 0 | 0 | 34 | 1 | 1 | 7 | 0 | 0 |
| vehicles/rideables | 0 | 0 | 0 | 5 | 0 | 0 | 4 | 0 | 0 |
| characters/assets | 0 | 0 | 0 | 0 | 0 | 0 | 33 | 33 | 0.1 |

Duplicatas: texturas 3 grupos (0.2 MB desperdiçados), materiais 131 cópias, geometrias 39 cópias (0.1 MB)

GPU (livro-razão): texturas 363 MB (189), buffers 86.2 MB, renderbuffers 99 MB, texturas sem dono na cena 90.9 MB

WASM: meshopt 0.3 MB · animação: {"clips":14,"tracks":2226,"MB":0.3}

Heap vivo por arquivo (amostragem):

- node_modules/.vite/deps/chunk-ZUVR7Q7I.js: 20 MB
- src/physics/walls.ts: 8.3 MB
- (nativo): 7 MB
- src/core/Game.ts: 1.3 MB
- src/characters/human/HumanCharacter.ts: 0.7 MB
- node_modules/.vite/deps/three_examples_jsm_loaders_GLTFLoader__js.js: 0.6 MB
- src/debug/memProbe.ts: 0.5 MB
- src/debug/memoryReport.ts: 0.3 MB
- src/traffic/TrafficSim.ts: 0.3 MB
- src/world/vegetationGen.ts: 0.2 MB
- src/main.ts: 0.2 MB
- src/characters/human/HumanAnimator.ts: 0.2 MB
- src/core/AssetManager.ts: 0.2 MB
- src/world/builders/buildings.ts: 0.2 MB
- src/physics/CollisionWorld.ts: 0.2 MB
- src/world/vegetation.ts: 0.1 MB
- src/world/builders/props.ts: 0.1 MB
- src/world/landmarks/colliders.ts: 0.1 MB
- src/world/builders/ground.ts: 0.1 MB
- src/traffic/TrafficSystem.ts: 0.1 MB

Loop 300s: pós-GC 50.4 → 50.5 MB (min 50.2, max 51.9), tendência -0.02 MB/min; GPU 549.6 → 549.6 MB

## MEDIUM (carga 2.138s)

| ponto | heap bruto MB | heap V8 pós-GC MB | ArrayBuffers MB | performance.memory pós-GC MB | GPU est. MB | GPU real (livro) MB | texturas | geometrias | materiais |
|---|---|---|---|---|---|---|---|---|---|
| spawn | 62.6 | 38.8 | 38.2 | 77 | 293.2 | 320 | 81 | 693 | 176 |
| central | 66.3 | 39.4 | 40.5 | 79.9 | 298.1 | 322.7 | 81 | 700 | 176 |
| meio | 72.2 | 40.1 | 38 | 78.1 | 315.9 | 343.1 | 81 | 715 | 184 |
| candelaria | 53.3 | 40.2 | 34.7 | 75.2 | 304.3 | 337 | 82 | 712 | 188 |
| meio_volta | 68 | 40.2 | 44.7 | 84.9 | 316.6 | 337.5 | 83 | 725 | 188 |
| central_volta | 60.6 | 40.5 | 44.9 | 85.4 | 310.2 | 330.9 | 83 | 729 | 188 |
| apos_loop | 41.7 | 40.3 | 44.9 | 85.3 | 308.6 | 331 | 85 | 729 | 201 |

Categorias (ponto: candelaria)

| categoria | texturas | tex GPU MB | tex CPU MB | geometrias | geo GPU MB | geo CPU MB | materiais | esqueletos | bones MB |
|---|---|---|---|---|---|---|---|---|---|
| chunks/ground | 26 | 65.4 | 0 | 401 | 5 | 2 | 13 | 0 | 0 |
| characters/player | 16 | 46 | 40.5 | 14 | 0.9 | 0.9 | 14 | 14 | 0.1 |
| chunks/buildings | 2 | 3 | 0 | 90 | 43.5 | 1.3 | 1 | 0 | 0 |
| landmarks | 5 | 17.7 | 13.3 | 44 | 24.6 | 0.1 | 9 | 0 | 0 |
| vegetation | 18 | 24.2 | 8.2 | 5 | 3.6 | 3.6 | 3 | 0 | 0 |
| monuments | 2 | 24.3 | 0.3 | 32 | 0.4 | 0.4 | 9 | 0 | 0 |
| shadows | 1 | 16 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| events | 5 | 10.7 | 9.4 | 56 | 0 | 0 | 29 | 0 | 0 |
| characters/npc | 6 | 8 | 6 | 19 | 1 | 1 | 63 | 63 | 0.5 |
| environment | 1 | 6 | 0 | 2 | 0.1 | 0.1 | 2 | 0 | 0 |
| vehicles/traffic | 0 | 0 | 0 | 10 | 2.3 | 2.3 | 1 | 0 | 0 |
| props | 0 | 0 | 0 | 34 | 0.9 | 0.9 | 7 | 0 | 0 |
| vehicles/rideables | 0 | 0 | 0 | 5 | 0 | 0 | 4 | 0 | 0 |
| characters/assets | 0 | 0 | 0 | 0 | 0 | 0 | 33 | 33 | 0.1 |

Duplicatas: texturas 3 grupos (0.1 MB desperdiçados), materiais 102 cópias, geometrias 39 cópias (0.1 MB)

GPU (livro-razão): texturas 229.4 MB (147), buffers 78.6 MB, renderbuffers 29 MB, texturas sem dono na cena 8 MB

WASM: meshopt 0.3 MB · animação: {"clips":14,"tracks":2226,"MB":0.3}

Heap vivo por arquivo (amostragem):

- node_modules/.vite/deps/chunk-ZUVR7Q7I.js: 15.9 MB
- src/physics/walls.ts: 7.9 MB
- (nativo): 7.1 MB
- src/core/Game.ts: 1.3 MB
- src/characters/human/HumanCharacter.ts: 0.4 MB
- src/debug/memoryReport.ts: 0.3 MB
- src/debug/memProbe.ts: 0.3 MB
- src/world/builders/props.ts: 0.3 MB
- node_modules/.vite/deps/three_examples_jsm_loaders_GLTFLoader__js.js: 0.2 MB
- src/world/landmarks/candelaria.ts: 0.1 MB
- src/world/ChunkManager.ts: 0.1 MB
- src/traffic/TrafficSim.ts: 0.1 MB
- src/characters/human/HumanAnimator.ts: 0.1 MB
- src/world/builders/ground.ts: 0.1 MB
- src/world/vegetation.ts: 0.1 MB
- node_modules/.vite/deps/three_examples_jsm_postprocessing_GTAOPass__js.js: 0.1 MB
- src/world/builders/buildings.ts: 0.1 MB
- src/net/clock.ts: 0.1 MB
- src/world/vegetationGen.ts: 0.1 MB
- src/main.ts: 0.1 MB

Loop 300s: pós-GC 40.6 → 41 MB (min 40.2, max 41.1), tendência 0.07 MB/min; GPU 335.1 → 335.1 MB

## LOW (carga 1.875s)

| ponto | heap bruto MB | heap V8 pós-GC MB | ArrayBuffers MB | performance.memory pós-GC MB | GPU est. MB | GPU real (livro) MB | texturas | geometrias | materiais |
|---|---|---|---|---|---|---|---|---|---|
| spawn | 38.7 | 33.3 | 36.1 | 69.4 | 245.9 | 251.1 | 74 | 616 | 131 |
| central | 38.4 | 34.7 | 37.5 | 72.2 | 253.8 | 257.8 | 74 | 628 | 132 |
| meio | 60.5 | 35.2 | 38.7 | 73.9 | 273.2 | 278.4 | 74 | 687 | 134 |
| candelaria | 72.4 | 35.2 | 35.3 | 70.5 | 265.1 | 276 | 75 | 644 | 136 |
| meio_volta | 45.6 | 35.8 | 43.8 | 79.6 | 274.3 | 275 | 76 | 690 | 136 |
| central_volta | 63.6 | 35.8 | 41 | 76.8 | 266.9 | 270.4 | 76 | 678 | 136 |
| apos_loop | 61 | 35.8 | 41 | 76.8 | 265.2 | 270.4 | 76 | 678 | 141 |

Categorias (ponto: candelaria)

| categoria | texturas | tex GPU MB | tex CPU MB | geometrias | geo GPU MB | geo CPU MB | materiais | esqueletos | bones MB |
|---|---|---|---|---|---|---|---|---|---|
| chunks/ground | 27 | 65.7 | 0 | 353 | 4.5 | 1.6 | 13 | 0 | 0 |
| characters/player | 16 | 46 | 40.5 | 14 | 0.9 | 0.9 | 14 | 14 | 0.1 |
| landmarks | 5 | 17.7 | 13.3 | 44 | 24.6 | 0.1 | 9 | 0 | 0 |
| chunks/buildings | 1 | 2.7 | 0 | 82 | 35.4 | 3.4 | 1 | 0 | 0 |
| monuments | 2 | 24.3 | 0.3 | 32 | 0.4 | 0.4 | 9 | 0 | 0 |
| vegetation | 18 | 18.3 | 8.2 | 5 | 3.6 | 3.6 | 3 | 0 | 0 |
| events | 5 | 10.7 | 9.4 | 56 | 0 | 0 | 29 | 0 | 0 |
| environment | 1 | 6 | 0 | 2 | 0.1 | 0.1 | 2 | 0 | 0 |
| vehicles/traffic | 0 | 0 | 0 | 10 | 2.3 | 2.3 | 1 | 0 | 0 |
| props | 0 | 0 | 0 | 34 | 0.9 | 0.9 | 7 | 0 | 0 |
| characters/npc | 0 | 0 | 0 | 7 | 0.7 | 0.7 | 23 | 23 | 0.2 |
| vehicles/rideables | 0 | 0 | 0 | 5 | 0 | 0 | 4 | 0 | 0 |
| characters/assets | 0 | 0 | 0 | 0 | 0 | 0 | 21 | 21 | 0.1 |

Duplicatas: texturas 4 grupos (0.1 MB desperdiçados), materiais 60 cópias, geometrias 39 cópias (0.1 MB)

GPU (livro-razão): texturas 199.3 MB (101), buffers 68 MB, renderbuffers 8.6 MB, texturas sem dono na cena 7.8 MB

WASM: meshopt 0.3 MB · animação: {"clips":14,"tracks":2226,"MB":0.3}

Heap vivo por arquivo (amostragem):

- node_modules/.vite/deps/chunk-ZUVR7Q7I.js: 11.6 MB
- src/physics/walls.ts: 8.8 MB
- (nativo): 6.6 MB
- src/core/Game.ts: 1.4 MB
- src/world/builders/buildings.ts: 0.4 MB
- node_modules/.vite/deps/three_examples_jsm_loaders_GLTFLoader__js.js: 0.3 MB
- src/world/builders/props.ts: 0.2 MB
- src/world/builders/ground.ts: 0.1 MB
- src/world/ChunkManager.ts: 0.1 MB
- @vite/client: 0.1 MB
- src/debug/memProbe.ts: 0.1 MB
- node_modules/.vite/deps/three_examples_jsm_postprocessing_GTAOPass__js.js: 0.1 MB
- src/world/landmarks/arch.ts: 0.1 MB
- src/characters/human/HumanCharacter.ts: 0.1 MB
- src/events/Billboards.ts: 0.1 MB
- src/characters/human/HumanAnimator.ts: 0.1 MB
- src/traffic/TrafficSim.ts: 0.1 MB
- src/world/landmarks/palacioDuqueCaxias.ts: 0.1 MB
- src/physics/CollisionWorld.ts: 0.1 MB
- src/core/AssetManager.ts: 0.1 MB

Loop 300s: pós-GC 35.4 → 35.8 MB (min 35.4, max 35.9), tendência 0.08 MB/min; GPU 273.5 → 273.5 MB
