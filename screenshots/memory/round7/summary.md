## HIGH (carga 2.635s)

| ponto | heap bruto MB | heap V8 pós-GC MB | ArrayBuffers MB | performance.memory pós-GC MB | GPU est. MB | GPU real (livro) MB | texturas | geometrias | materiais |
|---|---|---|---|---|---|---|---|---|---|
| spawn | 138 | 57.6 | 76.5 | 134 | 397 | 544 | 118 | 918 | 302 |
| central | 65 | 60.4 | 76.9 | 137.2 | 395 | 542.6 | 119 | 928 | 304 |
| meio | 166.5 | 67.1 | 80 | 147.1 | 525.3 | 673.3 | 159 | 1053 | 658 |
| candelaria | 79.2 | 71 | 76.9 | 146.1 | 523.9 | 663.3 | 174 | 1092 | 714 |
| meio_volta | 161.7 | 71.9 | 87.1 | 159 | 538.1 | 669.4 | 171 | 1120 | 805 |
| central_volta | 72.4 | 72.9 | 89.6 | 162.5 | 540.8 | 673.1 | 174 | 1111 | 845 |
| apos_loop | 90.7 | 89.8 | 105.5 | 195.3 | 625 | 739 | 183 | 1198 | 2058 |

Categorias (ponto: candelaria)

| categoria | texturas | tex GPU MB | tex CPU MB | geometrias | geo GPU MB | geo CPU MB | materiais | esqueletos | bones MB |
|---|---|---|---|---|---|---|---|---|---|
| characters/npc | 72 | 118.8 | 117.8 | 164 | 8.4 | 8.4 | 410 | 398 | 1.7 |
| chunks/ground | 26 | 65.4 | 0 | 424 | 5.2 | 2.5 | 13 | 0 | 0 |
| shadows | 1 | 64 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| landmarks | 5 | 17.7 | 13.3 | 99 | 38 | 1 | 9 | 0 | 0 |
| chunks/buildings | 2 | 3 | 0 | 87 | 50.6 | 1.4 | 1 | 0 | 0 |
| characters/player | 16 | 38 | 28.5 | 14 | 1 | 1 | 14 | 14 | 0.1 |
| vegetation | 18 | 24.3 | 8.3 | 5 | 3.6 | 3.6 | 3 | 0 | 0 |
| other | 13 | 22.3 | 2.3 | 22 | 2.7 | 2.7 | 14 | 0 | 0 |
| monuments | 2 | 24.3 | 0.3 | 32 | 0.4 | 0.4 | 9 | 0 | 0 |
| characters/assets | 5 | 8 | 5 | 29 | 1.6 | 1.6 | 151 | 151 | 0.5 |
| events | 4 | 9.5 | 7.1 | 56 | 0 | 0 | 29 | 0 | 0 |
| environment | 1 | 6 | 0 | 2 | 0.1 | 0.1 | 2 | 0 | 0 |
| world/event | 6 | 2.1 | 3.6 | 46 | 1.1 | 1.1 | 7 | 0 | 0 |
| vehicles/rideables | 2 | 1 | 0.7 | 53 | 1.2 | 1.2 | 40 | 0 | 0 |
| vehicles/assets | 0 | 0 | 0 | 8 | 1.6 | 1.6 | 0 | 0 | 0 |
| props | 0 | 0 | 0 | 34 | 1 | 1 | 7 | 0 | 0 |
| world/closure | 1 | 0.5 | 0.4 | 7 | 0.3 | 0.3 | 5 | 0 | 0 |
| social/props | 0 | 0 | 0 | 10 | 0.1 | 0.1 | 0 | 0 | 0 |

Duplicatas: texturas 3 grupos (0.2 MB desperdiçados), materiais 421 cópias, geometrias 97 cópias (0.5 MB)

GPU (livro-razão): texturas 469.7 MB (256), buffers 101.1 MB, renderbuffers 92.5 MB, texturas sem dono na cena 64.9 MB

WASM: meshopt 0.4 MB · animação: {"clips":14,"tracks":2226,"MB":0.3}

Loop 180s: pós-GC 76.9 → 89.8 MB (min 76.9, max 89.8), tendência 4.38 MB/min; GPU 680.9 → 729.1 MB

## LOW (carga 2.286s)

| ponto | heap bruto MB | heap V8 pós-GC MB | ArrayBuffers MB | performance.memory pós-GC MB | GPU est. MB | GPU real (livro) MB | texturas | geometrias | materiais |
|---|---|---|---|---|---|---|---|---|---|
| spawn | 50.7 | 40.5 | 69.3 | 109.9 | 257.7 | 246.7 | 93 | 793 | 186 |
| central | 58.1 | 41.1 | 70.4 | 111.5 | 265.7 | 254.1 | 92 | 809 | 188 |
| meio | 55.2 | 43.6 | 66.7 | 110.3 | 291.1 | 286.5 | 96 | 871 | 195 |
| candelaria | 58 | 43.3 | 58.9 | 102.2 | 280.7 | 285 | 94 | 832 | 193 |
| meio_volta | 53.3 | 44.1 | 69 | 113.2 | 286.4 | 280.9 | 94 | 878 | 192 |
| central_volta | 72.6 | 44.3 | 64.3 | 108.6 | 278.8 | 278.9 | 96 | 866 | 195 |
| apos_loop | 68.9 | 47.5 | 59.5 | 107 | 283.2 | 290.1 | 102 | 844 | 201 |

Categorias (ponto: candelaria)

| categoria | texturas | tex GPU MB | tex CPU MB | geometrias | geo GPU MB | geo CPU MB | materiais | esqueletos | bones MB |
|---|---|---|---|---|---|---|---|---|---|
| chunks/ground | 27 | 65.7 | 0 | 353 | 4.5 | 1.6 | 13 | 0 | 0 |
| landmarks | 5 | 17.7 | 13.3 | 99 | 38 | 1 | 9 | 0 | 0 |
| characters/player | 16 | 38 | 28.5 | 14 | 1 | 1 | 14 | 14 | 0.1 |
| chunks/buildings | 1 | 2.7 | 0 | 82 | 34.4 | 3.9 | 1 | 0 | 0 |
| monuments | 2 | 24.3 | 0.3 | 32 | 0.4 | 0.4 | 9 | 0 | 0 |
| vegetation | 18 | 18.3 | 8.2 | 5 | 3.6 | 3.6 | 3 | 0 | 0 |
| events | 4 | 9.5 | 7.1 | 56 | 0 | 0 | 29 | 0 | 0 |
| environment | 1 | 6 | 0 | 2 | 0.1 | 0.1 | 2 | 0 | 0 |
| other | 8 | 5.3 | 1.4 | 16 | 0.6 | 0.6 | 9 | 0 | 0 |
| world/event | 6 | 2.1 | 3.6 | 46 | 1.1 | 1.1 | 7 | 0 | 0 |
| vehicles/rideables | 2 | 1 | 0.7 | 53 | 1.2 | 1.2 | 40 | 0 | 0 |
| vehicles/assets | 0 | 0 | 0 | 8 | 1.6 | 1.6 | 0 | 0 | 0 |
| characters/npc | 3 | 0 | 1.5 | 15 | 1.3 | 1.3 | 24 | 21 | 0.1 |
| props | 0 | 0 | 0 | 34 | 0.9 | 0.9 | 7 | 0 | 0 |
| world/closure | 1 | 0.5 | 0.4 | 7 | 0.3 | 0.3 | 5 | 0 | 0 |
| characters/assets | 0 | 0 | 0 | 2 | 0.2 | 0.2 | 21 | 21 | 0.1 |
| social/props | 0 | 0 | 0 | 8 | 0.2 | 0.2 | 0 | 0 | 0 |

Duplicatas: texturas 4 grupos (0.1 MB desperdiçados), materiais 85 cópias, geometrias 93 cópias (0.5 MB)

GPU (livro-razão): texturas 197.2 MB (116), buffers 79.2 MB, renderbuffers 8.6 MB, texturas sem dono na cena 6.1 MB

WASM: meshopt 0.4 MB · animação: {"clips":14,"tracks":2226,"MB":0.3}

Loop 180s: pós-GC 45.2 → 48.3 MB (min 45.2, max 48.3), tendência 0.98 MB/min; GPU 283.3 → 283.3 MB
