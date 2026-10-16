## HIGH (carga 2.239s)

| ponto | heap bruto MB | heap V8 pós-GC MB | ArrayBuffers MB | performance.memory pós-GC MB | GPU est. MB | GPU real (livro) MB | texturas | geometrias | materiais |
|---|---|---|---|---|---|---|---|---|---|
| spawn | 157.6 | 71.9 | 65.1 | 137 | 369 | 519.9 | 81 | 763 | 203 |
| central | 71.4 | 73.1 | 64.7 | 136.9 | 369.8 | 521.1 | 81 | 766 | 204 |
| meio | 160.9 | 73.1 | 57 | 130.1 | 385 | 544.3 | 81 | 774 | 212 |
| candelaria | 68.6 | 73.4 | 50.6 | 124 | 379.6 | 545.6 | 83 | 787 | 216 |
| meio_volta | 79.6 | 73.3 | 57.9 | 131.1 | 385.5 | 546.1 | 82 | 793 | 216 |
| central_volta | 76.9 | 73.4 | 58 | 131.4 | 380.9 | 541.3 | 82 | 784 | 216 |
| apos_loop | 92 | 73.6 | 58.1 | 131.7 | 381.1 | 490.7 | 84 | 784 | 249 |

Categorias (ponto: candelaria)

| categoria | texturas | tex GPU MB | tex CPU MB | geometrias | geo GPU MB | geo CPU MB | materiais | esqueletos | bones MB |
|---|---|---|---|---|---|---|---|---|---|
| chunks/ground | 26 | 65.4 | 0 | 424 | 5.2 | 2.5 | 13 | 0 | 0 |
| shadows | 1 | 64 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| landmarks | 5 | 17.7 | 13.3 | 99 | 38 | 1 | 9 | 0 | 0 |
| chunks/buildings | 2 | 3 | 0 | 87 | 50.6 | 1.4 | 1 | 0 | 0 |
| characters/player | 16 | 48.7 | 40.5 | 14 | 0.9 | 0.9 | 14 | 14 | 0.1 |
| vegetation | 18 | 24.3 | 8.3 | 5 | 3.6 | 3.6 | 3 | 0 | 0 |
| monuments | 2 | 24.3 | 0.3 | 32 | 0.4 | 0.4 | 9 | 0 | 0 |
| events | 6 | 14.2 | 10.7 | 56 | 0 | 0 | 29 | 0 | 0 |
| characters/npc | 6 | 8 | 6 | 19 | 1 | 1 | 91 | 91 | 0.7 |
| environment | 1 | 6 | 0 | 2 | 0.1 | 0.1 | 2 | 0 | 0 |
| vehicles/traffic | 0 | 0 | 0 | 10 | 2.3 | 2.3 | 1 | 0 | 0 |
| props | 0 | 0 | 0 | 34 | 1 | 1 | 7 | 0 | 0 |
| vehicles/rideables | 0 | 0 | 0 | 5 | 0 | 0 | 4 | 0 | 0 |
| characters/assets | 0 | 0 | 0 | 0 | 0 | 0 | 33 | 33 | 0.1 |

Duplicatas: texturas 3 grupos (0.2 MB desperdiçados), materiais 131 cópias, geometrias 37 cópias (0.1 MB)

GPU (livro-razão): texturas 352.1 MB (189), buffers 98 MB, renderbuffers 95.6 MB, texturas sem dono na cena 76.5 MB

WASM: meshopt 0.3 MB · animação: {"clips":14,"tracks":2226,"MB":0.3}

Heap vivo por arquivo (amostragem):

- node_modules/.vite/deps/chunk-ZUVR7Q7I.js: 37.1 MB
- src/world/landmarks/arch.ts: 7.7 MB
- src/physics/walls.ts: 7.5 MB
- (nativo): 6.7 MB
- src/core/Game.ts: 1.3 MB
- node_modules/.vite/deps/three_examples_jsm_loaders_GLTFLoader__js.js: 0.7 MB
- src/characters/human/HumanCharacter.ts: 0.6 MB
- src/traffic/TrafficSim.ts: 0.4 MB
- src/debug/memProbe.ts: 0.3 MB
- src/world/builders/props.ts: 0.3 MB
- src/core/AssetManager.ts: 0.2 MB
- src/debug/memoryReport.ts: 0.1 MB
- src/geo/projection.ts: 0.1 MB
- src/world/builders/buildings.ts: 0.1 MB
- @vite/client: 0.1 MB
- src/npc/PedestrianSystem.ts: 0.1 MB
- node_modules/.vite/deps/three_examples_jsm_postprocessing_GTAOPass__js.js: 0.1 MB
- src/traffic/SignalController.ts: 0.1 MB
- src/world/landmarks/ccbb.ts: 0.1 MB
- src/world/vegetation.ts: 0.1 MB

Loop 300s: pós-GC 74 → 74 MB (min 73.8, max 74.7), tendência 0.02 MB/min; GPU 545.3 → 494.6 MB

## MEDIUM (carga 2s)

| ponto | heap bruto MB | heap V8 pós-GC MB | ArrayBuffers MB | performance.memory pós-GC MB | GPU est. MB | GPU real (livro) MB | texturas | geometrias | materiais |
|---|---|---|---|---|---|---|---|---|---|
| spawn | 104.8 | 61.7 | 63.9 | 125.7 | 294.8 | 309.3 | 75 | 736 | 152 |
| central | 77 | 62.4 | 65.5 | 128.2 | 302.7 | 315.6 | 75 | 743 | 152 |
| meio | 112.2 | 63.1 | 55.2 | 118.3 | 321.7 | 345 | 75 | 758 | 159 |
| candelaria | 79.2 | 62.6 | 48.8 | 111.3 | 311.8 | 342 | 77 | 755 | 162 |
| meio_volta | 104.5 | 63.2 | 58.8 | 122 | 318.9 | 340.8 | 76 | 768 | 162 |
| central_volta | 87.1 | 63.3 | 58.9 | 122.2 | 312.7 | 334.5 | 76 | 772 | 162 |
| apos_loop | 67.4 | 64 | 59 | 122.9 | 312.8 | 334.5 | 79 | 772 | 177 |

Categorias (ponto: candelaria)

| categoria | texturas | tex GPU MB | tex CPU MB | geometrias | geo GPU MB | geo CPU MB | materiais | esqueletos | bones MB |
|---|---|---|---|---|---|---|---|---|---|
| chunks/ground | 26 | 65.4 | 0 | 401 | 5 | 2 | 13 | 0 | 0 |
| landmarks | 5 | 17.7 | 13.3 | 99 | 38 | 1 | 9 | 0 | 0 |
| characters/player | 16 | 46 | 40.5 | 14 | 0.9 | 0.9 | 14 | 14 | 0.1 |
| chunks/buildings | 2 | 3 | 0 | 90 | 42.5 | 1.3 | 1 | 0 | 0 |
| vegetation | 18 | 24.2 | 8.2 | 5 | 3.6 | 3.6 | 3 | 0 | 0 |
| monuments | 2 | 24.3 | 0.3 | 32 | 0.4 | 0.4 | 9 | 0 | 0 |
| shadows | 1 | 16 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| events | 6 | 14.2 | 10.7 | 56 | 0 | 0 | 29 | 0 | 0 |
| environment | 1 | 6 | 0 | 2 | 0.1 | 0.1 | 2 | 0 | 0 |
| vehicles/traffic | 0 | 0 | 0 | 10 | 2.3 | 2.3 | 1 | 0 | 0 |
| props | 0 | 0 | 0 | 34 | 1 | 1 | 7 | 0 | 0 |
| characters/npc | 0 | 0 | 0 | 7 | 0.7 | 0.7 | 49 | 49 | 0.4 |
| vehicles/rideables | 0 | 0 | 0 | 5 | 0 | 0 | 4 | 0 | 0 |
| characters/assets | 0 | 0 | 0 | 0 | 0 | 0 | 21 | 21 | 0.1 |

Duplicatas: texturas 3 grupos (0.1 MB desperdiçados), materiais 86 cópias, geometrias 37 cópias (0.1 MB)

GPU (livro-razão): texturas 223.1 MB (132), buffers 89.9 MB, renderbuffers 29 MB, texturas sem dono na cena 6.2 MB

WASM: meshopt 0.3 MB · animação: {"clips":14,"tracks":2226,"MB":0.3}

Heap vivo por arquivo (amostragem):

- node_modules/.vite/deps/chunk-ZUVR7Q7I.js: 30.2 MB
- src/world/landmarks/arch.ts: 8.3 MB
- src/physics/walls.ts: 7.2 MB
- (nativo): 7 MB
- src/core/Game.ts: 1.5 MB
- src/traffic/TrafficSim.ts: 0.4 MB
- src/characters/human/HumanCharacter.ts: 0.3 MB
- src/world/vegetation.ts: 0.1 MB
- node_modules/.vite/deps/chunk-XNKHOY2D.js: 0.1 MB
- src/world/landmarks/central.ts: 0.1 MB
- src/debug/memProbe.ts: 0.1 MB
- src/core/AssetManager.ts: 0.1 MB
- node_modules/.vite/deps/three_examples_jsm_loaders_GLTFLoader__js.js: 0.1 MB
- @vite/client: 0.1 MB
- src/main.ts: 0.1 MB
- src/npc/PedestrianSystem.ts: 0.1 MB
- src/world/builders/buildings.ts: 0.1 MB
- src/world/arcades.ts: 0.1 MB
- src/world/landmarks/paBlocks.ts: 0.1 MB
- src/traffic/TrafficSystem.ts: 0.1 MB

Loop 300s: pós-GC 62.9 → 64.1 MB (min 62.9, max 64.3), tendência 0.19 MB/min; GPU 338.4 → 338.5 MB

## LOW (carga 1.98s)

| ponto | heap bruto MB | heap V8 pós-GC MB | ArrayBuffers MB | performance.memory pós-GC MB | GPU est. MB | GPU real (livro) MB | texturas | geometrias | materiais |
|---|---|---|---|---|---|---|---|---|---|
| spawn | 83.8 | 56.6 | 62.3 | 118.9 | 255.9 | 248.6 | 74 | 671 | 131 |
| central | 85.3 | 58.1 | 63 | 121.1 | 263.9 | 256.1 | 74 | 683 | 132 |
| meio | 83.4 | 58.6 | 56.3 | 114.9 | 287.5 | 288.7 | 74 | 742 | 137 |
| candelaria | 87.1 | 59 | 48.2 | 107.2 | 281.1 | 290.9 | 76 | 699 | 138 |
| meio_volta | 62.9 | 59.1 | 58.2 | 117.2 | 286.9 | 286.6 | 76 | 745 | 138 |
| central_volta | 78.7 | 59.2 | 55.4 | 114.6 | 279.9 | 282.4 | 76 | 733 | 138 |
| apos_loop | 69.2 | 59.5 | 55.4 | 114.9 | 278.2 | 282.6 | 76 | 733 | 141 |

Categorias (ponto: candelaria)

| categoria | texturas | tex GPU MB | tex CPU MB | geometrias | geo GPU MB | geo CPU MB | materiais | esqueletos | bones MB |
|---|---|---|---|---|---|---|---|---|---|
| chunks/ground | 27 | 65.7 | 0 | 353 | 4.5 | 1.6 | 13 | 0 | 0 |
| landmarks | 5 | 17.7 | 13.3 | 99 | 38 | 1 | 9 | 0 | 0 |
| characters/player | 16 | 46 | 40.5 | 14 | 0.9 | 0.9 | 14 | 14 | 0.1 |
| chunks/buildings | 1 | 2.7 | 0 | 82 | 34.4 | 1.7 | 1 | 0 | 0 |
| monuments | 2 | 24.3 | 0.3 | 32 | 0.4 | 0.4 | 9 | 0 | 0 |
| vegetation | 18 | 18.3 | 8.2 | 5 | 3.6 | 3.6 | 3 | 0 | 0 |
| events | 6 | 14.2 | 10.7 | 56 | 0 | 0 | 29 | 0 | 0 |
| environment | 1 | 6 | 0 | 2 | 0.1 | 0.1 | 2 | 0 | 0 |
| vehicles/traffic | 0 | 0 | 0 | 10 | 2.3 | 2.3 | 1 | 0 | 0 |
| props | 0 | 0 | 0 | 34 | 0.9 | 0.9 | 7 | 0 | 0 |
| characters/npc | 0 | 0 | 0 | 6 | 0.6 | 0.6 | 25 | 25 | 0.2 |
| characters/assets | 0 | 0 | 0 | 1 | 0.1 | 0.1 | 21 | 21 | 0.1 |
| vehicles/rideables | 0 | 0 | 0 | 5 | 0 | 0 | 4 | 0 | 0 |

Duplicatas: texturas 4 grupos (0.1 MB desperdiçados), materiais 62 cópias, geometrias 37 cópias (0.1 MB)

GPU (livro-razão): texturas 201.1 MB (107), buffers 81.2 MB, renderbuffers 8.6 MB, texturas sem dono na cena 6.1 MB

WASM: meshopt 0.3 MB · animação: {"clips":14,"tracks":2226,"MB":0.3}

Heap vivo por arquivo (amostragem):

- node_modules/.vite/deps/chunk-ZUVR7Q7I.js: 26.7 MB
- src/physics/walls.ts: 7.4 MB
- src/world/landmarks/arch.ts: 6.9 MB
- (nativo): 6.5 MB
- src/core/Game.ts: 1.5 MB
- node_modules/.vite/deps/three_examples_jsm_loaders_GLTFLoader__js.js: 0.6 MB
- src/debug/memProbe.ts: 0.3 MB
- src/npc/PedestrianSystem.ts: 0.1 MB
- src/world/builders/props.ts: 0.1 MB
- src/characters/human/HumanAnimator.ts: 0.1 MB
- src/characters/human/HumanCharacter.ts: 0.1 MB
- node_modules/.vite/deps/three_examples_jsm_libs_meshopt_decoder__module__js.js: 0.1 MB
- src/world/ChunkManager.ts: 0.1 MB
- src/traffic/TrafficSim.ts: 0.1 MB
- src/physics/CollisionWorld.ts: 0.1 MB
- node_modules/.vite/deps/three_examples_jsm_postprocessing_GTAOPass__js.js: 0.1 MB
- src/renderer/Renderer.ts: 0.1 MB
- src/debug/memoryReport.ts: 0.1 MB
- src/core/AssetManager.ts: 0.1 MB
- src/player/AvatarVisual.ts: 0.1 MB

Loop 300s: pós-GC 59.1 → 59.5 MB (min 59, max 59.5), tendência 0.08 MB/min; GPU 285.4 → 285.4 MB
