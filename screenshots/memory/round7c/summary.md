## HIGH (carga 2.744s)

| ponto | heap bruto MB | heap V8 pós-GC MB | ArrayBuffers MB | performance.memory pós-GC MB | GPU est. MB | GPU real (livro) MB | texturas | geometrias | materiais |
|---|---|---|---|---|---|---|---|---|---|
| spawn | 136.9 | 57.5 | 76.5 | 134 | 397 | 544 | 118 | 918 | 302 |
| central | 63.8 | 60.5 | 79.1 | 139.6 | 419.5 | 565 | 128 | 955 | 385 |
| meio | 168.2 | 66.4 | 78.4 | 144.8 | 481.7 | 630.8 | 154 | 1042 | 662 |
| candelaria | 73 | 68.6 | 74.2 | 142.9 | 477.5 | 632.4 | 163 | 1069 | 687 |
| meio_volta | 157.5 | 69.8 | 82.2 | 152.1 | 500.7 | 648.6 | 160 | 1078 | 780 |
| central_volta | 80.5 | 70.5 | 81.9 | 152.4 | 492.4 | 641.6 | 155 | 1062 | 644 |
| apos_loop | 88.7 | 75.4 | 87.6 | 162.9 | 601.2 | 703.2 | 176 | 1103 | 684 |

Categorias (ponto: candelaria)

| categoria | texturas | tex GPU MB | tex CPU MB | geometrias | geo GPU MB | geo CPU MB | materiais | esqueletos | bones MB |
|---|---|---|---|---|---|---|---|---|---|
| characters/npc | 61 | 81.5 | 101.1 | 143 | 7.8 | 7.8 | 407 | 394 | 1.6 |
| chunks/ground | 26 | 65.4 | 0 | 424 | 5.2 | 2.5 | 13 | 0 | 0 |
| shadows | 1 | 64 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| landmarks | 5 | 17.7 | 13.3 | 99 | 38 | 1 | 9 | 0 | 0 |
| chunks/buildings | 2 | 3 | 0 | 87 | 50.6 | 1.4 | 1 | 0 | 0 |
| characters/player | 16 | 38 | 28.5 | 14 | 1 | 1 | 14 | 14 | 0.1 |
| vegetation | 18 | 24.3 | 8.3 | 5 | 3.6 | 3.6 | 3 | 0 | 0 |
| other | 13 | 22.3 | 2.3 | 22 | 2.7 | 2.7 | 14 | 0 | 0 |
| monuments | 2 | 24.3 | 0.3 | 32 | 0.4 | 0.4 | 9 | 0 | 0 |
| events | 4 | 9.5 | 7.1 | 56 | 0 | 0 | 29 | 0 | 0 |
| environment | 1 | 6 | 0 | 2 | 0.1 | 0.1 | 2 | 0 | 0 |
| world/event | 6 | 2.1 | 3.6 | 46 | 1.1 | 1.1 | 7 | 0 | 0 |
| vehicles/rideables | 2 | 1 | 0.7 | 53 | 1.2 | 1.2 | 40 | 0 | 0 |
| vehicles/assets | 0 | 0 | 0 | 8 | 1.6 | 1.6 | 0 | 0 | 0 |
| characters/assets | 5 | 0 | 11 | 25 | 1.3 | 1.3 | 127 | 127 | 0.4 |
| props | 0 | 0 | 0 | 34 | 1 | 1 | 7 | 0 | 0 |
| world/closure | 1 | 0.5 | 0.4 | 7 | 0.3 | 0.3 | 5 | 0 | 0 |
| social/props | 0 | 0 | 0 | 12 | 0.2 | 0.2 | 0 | 0 | 0 |

Duplicatas: texturas 3 grupos (0.2 MB desperdiçados), materiais 403 cópias, geometrias 97 cópias (0.5 MB)

GPU (livro-razão): texturas 435.9 MB (224), buffers 100.9 MB, renderbuffers 95.6 MB, texturas sem dono na cena 76.4 MB

WASM: meshopt 0.4 MB · animação: {"clips":14,"tracks":2226,"MB":0.3}

Loop 300s: pós-GC 72.2 → 76.1 MB (min 72.2, max 77.4), tendência 0.49 MB/min; GPU 669.7 → 706 MB

## LOW (carga 2.263s)

| ponto | heap bruto MB | heap V8 pós-GC MB | ArrayBuffers MB | performance.memory pós-GC MB | GPU est. MB | GPU real (livro) MB | texturas | geometrias | materiais |
|---|---|---|---|---|---|---|---|---|---|
| spawn | 59.3 | 40.5 | 69.4 | 109.9 | 257.7 | 246.7 | 93 | 793 | 186 |
| central | 49.9 | 41.7 | 70.6 | 112.3 | 265.8 | 254.2 | 94 | 809 | 191 |
| meio | 76.6 | 42.4 | 66.8 | 109.2 | 290.2 | 285.5 | 95 | 871 | 193 |
| candelaria | 63 | 43.2 | 60.6 | 103.7 | 280.7 | 283.4 | 98 | 828 | 199 |
| meio_volta | 59.1 | 43.9 | 69.2 | 113.1 | 286.4 | 280.9 | 94 | 876 | 193 |
| central_volta | 70.2 | 44.5 | 64.6 | 109.1 | 278.7 | 278.9 | 92 | 865 | 192 |
| apos_loop | 62 | 48.1 | 67 | 115.1 | 280.3 | 280.6 | 100 | 878 | 200 |

Categorias (ponto: candelaria)

| categoria | texturas | tex GPU MB | tex CPU MB | geometrias | geo GPU MB | geo CPU MB | materiais | esqueletos | bones MB |
|---|---|---|---|---|---|---|---|---|---|
| chunks/ground | 27 | 65.7 | 0 | 353 | 4.5 | 1.6 | 13 | 0 | 0 |
| landmarks | 5 | 17.7 | 13.3 | 99 | 38 | 1 | 9 | 0 | 0 |
| characters/player | 16 | 38 | 28.5 | 14 | 1 | 1 | 14 | 14 | 0.1 |
| chunks/buildings | 1 | 2.7 | 0 | 82 | 34.4 | 5.5 | 1 | 0 | 0 |
| monuments | 2 | 24.3 | 0.3 | 32 | 0.4 | 0.4 | 9 | 0 | 0 |
| vegetation | 18 | 18.3 | 8.2 | 5 | 3.6 | 3.6 | 3 | 0 | 0 |
| events | 4 | 9.5 | 7.1 | 56 | 0 | 0 | 29 | 0 | 0 |
| environment | 1 | 6 | 0 | 2 | 0.1 | 0.1 | 2 | 0 | 0 |
| other | 8 | 5.3 | 1.4 | 16 | 0.6 | 0.6 | 9 | 0 | 0 |
| world/event | 6 | 2.1 | 3.6 | 46 | 1.1 | 1.1 | 7 | 0 | 0 |
| vehicles/rideables | 2 | 1 | 0.7 | 53 | 1.2 | 1.2 | 40 | 0 | 0 |
| vehicles/assets | 0 | 0 | 0 | 8 | 1.6 | 1.6 | 0 | 0 | 0 |
| characters/npc | 7 | 0 | 6.2 | 15 | 1.3 | 1.3 | 30 | 22 | 0.1 |
| props | 0 | 0 | 0 | 34 | 0.9 | 0.9 | 7 | 0 | 0 |
| world/closure | 1 | 0.5 | 0.4 | 7 | 0.3 | 0.3 | 5 | 0 | 0 |
| characters/assets | 0 | 0 | 0 | 2 | 0.2 | 0.2 | 21 | 21 | 0.1 |
| social/props | 0 | 0 | 0 | 4 | 0.1 | 0.1 | 0 | 0 | 0 |

Duplicatas: texturas 4 grupos (0.1 MB desperdiçados), materiais 87 cópias, geometrias 93 cópias (0.5 MB)

GPU (livro-razão): texturas 197.2 MB (117), buffers 77.6 MB, renderbuffers 8.6 MB, texturas sem dono na cena 6.1 MB

WASM: meshopt 0.4 MB · animação: {"clips":14,"tracks":2226,"MB":0.3}

Loop 300s: pós-GC 45.1 → 48.2 MB (min 45.1, max 49.4), tendência 0.61 MB/min; GPU 283.2 → 283.4 MB
