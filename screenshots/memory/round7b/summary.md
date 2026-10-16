## HIGH (carga 2.63s)

| ponto | heap bruto MB | heap V8 pós-GC MB | ArrayBuffers MB | performance.memory pós-GC MB | GPU est. MB | GPU real (livro) MB | texturas | geometrias | materiais |
|---|---|---|---|---|---|---|---|---|---|
| spawn | 131.8 | 57.5 | 76.5 | 134 | 397 | 544 | 118 | 918 | 302 |
| central | 63.9 | 60 | 77.1 | 137.1 | 395.1 | 542.3 | 121 | 929 | 307 |
| meio | 158.7 | 66.6 | 78.2 | 144.7 | 488.1 | 637.7 | 151 | 1036 | 572 |
| candelaria | 82.7 | 69.6 | 76.4 | 146 | 519.9 | 674 | 166 | 1086 | 712 |
| meio_volta | 69.6 | 72.1 | 85.8 | 157.2 | 536.8 | 682.5 | 173 | 1121 | 795 |
| central_volta | 75.3 | 72.6 | 86.3 | 158.9 | 541.8 | 689.2 | 172 | 1115 | 830 |
| apos_loop | 104.9 | 91.2 | 97.2 | 188.4 | 612.6 | 757.1 | 187 | 1196 | 2054 |

Categorias (ponto: candelaria)

| categoria | texturas | tex GPU MB | tex CPU MB | geometrias | geo GPU MB | geo CPU MB | materiais | esqueletos | bones MB |
|---|---|---|---|---|---|---|---|---|---|
| characters/npc | 66 | 114.7 | 107.1 | 150 | 8.1 | 8.1 | 408 | 399 | 1.8 |
| chunks/ground | 26 | 65.4 | 0 | 424 | 5.2 | 2.5 | 13 | 0 | 0 |
| shadows | 1 | 64 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| landmarks | 5 | 17.7 | 13.3 | 99 | 38 | 1.1 | 9 | 0 | 0 |
| chunks/buildings | 2 | 3 | 0 | 87 | 50.6 | 1.4 | 1 | 0 | 0 |
| characters/player | 16 | 38 | 28.5 | 14 | 1 | 1 | 14 | 14 | 0.1 |
| vegetation | 18 | 24.3 | 8.3 | 5 | 3.6 | 3.6 | 3 | 0 | 0 |
| other | 13 | 22.3 | 2.3 | 22 | 2.7 | 2.7 | 14 | 0 | 0 |
| monuments | 2 | 24.3 | 0.3 | 32 | 0.4 | 0.4 | 9 | 0 | 0 |
| characters/assets | 4 | 8 | 1 | 32 | 1.9 | 1.9 | 151 | 151 | 0.5 |
| events | 4 | 9.5 | 7.1 | 56 | 0 | 0 | 29 | 0 | 0 |
| environment | 1 | 6 | 0 | 2 | 0.1 | 0.1 | 2 | 0 | 0 |
| world/event | 5 | 2.1 | 3.2 | 46 | 1.1 | 1.1 | 7 | 0 | 0 |
| vehicles/rideables | 2 | 1 | 0.7 | 53 | 1.2 | 1.2 | 40 | 0 | 0 |
| vehicles/assets | 0 | 0 | 0 | 8 | 1.6 | 1.6 | 0 | 0 | 0 |
| props | 0 | 0 | 0 | 34 | 1 | 1 | 7 | 0 | 0 |
| world/closure | 1 | 0.5 | 0.4 | 7 | 0.3 | 0.3 | 5 | 0 | 0 |
| social/props | 0 | 0 | 0 | 15 | 0.2 | 0.2 | 0 | 0 | 0 |

Duplicatas: texturas 3 grupos (0.2 MB desperdiçados), materiais 416 cópias, geometrias 97 cópias (0.5 MB)

GPU (livro-razão): texturas 477.2 MB (270), buffers 101.2 MB, renderbuffers 95.6 MB, texturas sem dono na cena 76.6 MB

WASM: meshopt 0.4 MB · animação: {"clips":14,"tracks":2226,"MB":0.3}

Loop 300s: pós-GC 76.4 → 91.2 MB (min 76.4, max 91.2), tendência 2.64 MB/min; GPU 712.3 → 763 MB
