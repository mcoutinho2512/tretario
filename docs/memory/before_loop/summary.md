## HIGH (carga 1.934s)

| ponto | heap bruto MB | heap pós-GC MB | ArrayBuffers MB | GPU est. MB | GPU real (livro) MB | texturas | geometrias | materiais |
|---|---|---|---|---|---|---|---|---|
| spawn | 190.3 | 69.4 | 190.3 | 380.9 | 558.7 | 90 | 895 | 313 |
| central | 69.3 | 70.7 | 191 | 381.6 | 559.2 | 90 | 898 | 314 |
| meio | 147.8 | 70.8 | 203 | 397.2 | 575 | 90 | 906 | 326 |
| candelaria | 75 | 70.9 | 195.8 | 388.3 | 571.5 | 91 | 919 | 332 |
| meio_volta | 72.9 | 71.5 | 203.5 | 397.8 | 573.6 | 91 | 925 | 332 |
| central_volta | 143.5 | 71.6 | 198.9 | 393.1 | 568.9 | 91 | 916 | 332 |
| apos_loop | 67.7 | 71.2 | 198.9 | 393.3 | 569 | 94 | 916 | 359 |

Categorias (ponto: candelaria)

| categoria | texturas | tex GPU MB | tex CPU MB | geometrias | geo MB | materiais | esqueletos | bones MB |
|---|---|---|---|---|---|---|---|---|
| vegetation | 19 | 88.3 | 8.3 | 5 | 3.6 | 3 | 0 | 0 |
| chunks/ground | 26 | 65.4 | 49.1 | 424 | 5.2 | 13 | 0 | 0 |
| chunks/buildings | 2 | 3 | 2.3 | 87 | 51.4 | 1 | 0 | 0 |
| characters/player | 16 | 46 | 40.5 | 14 | 0.9 | 14 | 14 | 0.1 |
| monuments | 2 | 43 | 32.3 | 32 | 0.4 | 9 | 0 | 0 |
| landmarks | 5 | 17.7 | 13.3 | 44 | 24.6 | 9 | 0 | 0 |
| characters/npc | 15 | 12.3 | 13.3 | 19 | 1 | 97 | 97 | 0.7 |
| events | 5 | 10.7 | 9.4 | 56 | 0 | 29 | 0 | 0 |
| other | 1 | 6 | 0 | 0 | 0 | 0 | 0 | 0 |
| vegetation/variants | 0 | 0 | 0 | 40 | 3.6 | 0 | 0 | 0 |
| vehicles/traffic | 0 | 0 | 0 | 10 | 2.3 | 1 | 0 | 0 |
| vehicles/rideables | 0 | 0 | 0 | 152 | 1 | 114 | 0 | 0 |
| props | 0 | 0 | 0 | 34 | 1 | 7 | 0 | 0 |
| environment | 0 | 0 | 0 | 2 | 0.1 | 2 | 0 | 0 |
| characters/assets | 0 | 0 | 0 | 0 | 0 | 33 | 33 | 0.1 |

Duplicatas: texturas 13 grupos (5.7 MB desperdiçados), materiais 237 cópias, geometrias 186 cópias (1.1 MB)

GPU (livro-razão): texturas 383.3 MB (196), buffers 89.1 MB, renderbuffers 99 MB, texturas sem dono na cena 90.9 MB

WASM: meshopt 0.3 MB · animação: {"clips":14,"tracks":2226,"MB":0.3}

Loop 300s: pós-GC 71.4 → 72.1 MB (min 71.2, max 72.3), tendência 0.09 MB/min; GPU 573 → 573 MB

## MEDIUM (carga 2.08s)

| ponto | heap bruto MB | heap pós-GC MB | ArrayBuffers MB | GPU est. MB | GPU real (livro) MB | texturas | geometrias | materiais |
|---|---|---|---|---|---|---|---|---|
| spawn | 99.8 | 60.2 | 177.5 | 318 | 343.2 | 90 | 880 | 286 |
| central | 81.2 | 60.3 | 182.4 | 323 | 345.9 | 90 | 887 | 286 |
| meio | 76.3 | 60.8 | 198.4 | 340.8 | 366.3 | 90 | 902 | 292 |
| candelaria | 80.2 | 62 | 186.8 | 329.2 | 360.2 | 91 | 899 | 294 |
| meio_volta | 76.2 | 60.6 | 195.6 | 341.4 | 360.8 | 92 | 912 | 294 |
| central_volta | 86.4 | 61.4 | 189.2 | 335 | 354.3 | 92 | 916 | 294 |
| apos_loop | 67.5 | 62 | 189.3 | 333.4 | 354.3 | 94 | 916 | 311 |

Categorias (ponto: candelaria)

| categoria | texturas | tex GPU MB | tex CPU MB | geometrias | geo MB | materiais | esqueletos | bones MB |
|---|---|---|---|---|---|---|---|---|
| chunks/ground | 26 | 65.4 | 49.1 | 401 | 5 | 13 | 0 | 0 |
| characters/player | 16 | 46 | 40.5 | 14 | 0.9 | 14 | 14 | 0.1 |
| chunks/buildings | 2 | 3 | 2.3 | 90 | 43.5 | 1 | 0 | 0 |
| vegetation | 19 | 40.2 | 8.2 | 5 | 3.6 | 3 | 0 | 0 |
| monuments | 2 | 43 | 32.3 | 32 | 0.4 | 9 | 0 | 0 |
| landmarks | 5 | 17.7 | 13.3 | 44 | 24.6 | 9 | 0 | 0 |
| events | 5 | 10.7 | 9.4 | 56 | 0 | 29 | 0 | 0 |
| characters/npc | 15 | 9.7 | 13.3 | 19 | 1 | 59 | 59 | 0.4 |
| other | 1 | 6 | 0 | 0 | 0 | 0 | 0 | 0 |
| vegetation/variants | 0 | 0 | 0 | 40 | 3.6 | 0 | 0 | 0 |
| vehicles/traffic | 0 | 0 | 0 | 10 | 2.3 | 1 | 0 | 0 |
| vehicles/rideables | 0 | 0 | 0 | 152 | 1 | 114 | 0 | 0 |
| props | 0 | 0 | 0 | 34 | 0.9 | 7 | 0 | 0 |
| environment | 0 | 0 | 0 | 2 | 0.1 | 2 | 0 | 0 |
| characters/assets | 0 | 0 | 0 | 0 | 0 | 33 | 33 | 0.1 |

Duplicatas: texturas 13 grupos (3 MB desperdiçados), materiais 199 cópias, geometrias 186 cópias (1.1 MB)

GPU (livro-razão): texturas 249.7 MB (144), buffers 81.6 MB, renderbuffers 29 MB, texturas sem dono na cena 8 MB

WASM: meshopt 0.3 MB · animação: {"clips":14,"tracks":2226,"MB":0.3}

Loop 300s: pós-GC 61.6 → 61.9 MB (min 61.2, max 62.1), tendência -0.05 MB/min; GPU 358.5 → 358.5 MB

## LOW (carga 1.965s)

| ponto | heap bruto MB | heap pós-GC MB | ArrayBuffers MB | GPU est. MB | GPU real (livro) MB | texturas | geometrias | materiais |
|---|---|---|---|---|---|---|---|---|
| spawn | 59.2 | 54.2 | 159.3 | 269.1 | 272.6 | 74 | 803 | 241 |
| central | 85.1 | 54.8 | 164.4 | 277 | 279.3 | 74 | 815 | 241 |
| meio | 64.1 | 56 | 186 | 296.4 | 300.1 | 74 | 874 | 248 |
| candelaria | 60.1 | 55.9 | 176.2 | 288.4 | 299.2 | 75 | 836 | 249 |
| meio_volta | 68.8 | 56.3 | 181.9 | 297.6 | 296.6 | 76 | 877 | 249 |
| central_volta | 74 | 56.4 | 174.6 | 290.3 | 292.2 | 76 | 868 | 249 |
| apos_loop | 72.8 | 56.9 | 174.6 | 288.5 | 292.2 | 77 | 868 | 251 |

Categorias (ponto: candelaria)

| categoria | texturas | tex GPU MB | tex CPU MB | geometrias | geo MB | materiais | esqueletos | bones MB |
|---|---|---|---|---|---|---|---|---|
| chunks/ground | 27 | 65.7 | 49.3 | 353 | 4.5 | 13 | 0 | 0 |
| characters/player | 16 | 46 | 40.5 | 14 | 0.9 | 14 | 14 | 0.1 |
| monuments | 2 | 43 | 32.3 | 32 | 0.4 | 9 | 0 | 0 |
| landmarks | 5 | 17.7 | 13.3 | 44 | 24.6 | 9 | 0 | 0 |
| chunks/buildings | 1 | 2.7 | 2 | 87 | 35.4 | 1 | 0 | 0 |
| vegetation | 18 | 18.3 | 8.2 | 5 | 3.6 | 3 | 0 | 0 |
| events | 5 | 10.7 | 9.4 | 56 | 0 | 29 | 0 | 0 |
| other | 1 | 6 | 0 | 0 | 0 | 0 | 0 | 0 |
| vegetation/variants | 0 | 0 | 0 | 40 | 3.6 | 0 | 0 | 0 |
| vehicles/traffic | 0 | 0 | 0 | 10 | 2.3 | 1 | 0 | 0 |
| vehicles/rideables | 0 | 0 | 0 | 152 | 1 | 114 | 0 | 0 |
| props | 0 | 0 | 0 | 34 | 0.9 | 7 | 0 | 0 |
| characters/npc | 0 | 0 | 0 | 7 | 0.7 | 26 | 26 | 0.2 |
| environment | 0 | 0 | 0 | 2 | 0.1 | 2 | 0 | 0 |
| characters/assets | 0 | 0 | 0 | 0 | 0 | 21 | 21 | 0.1 |

Duplicatas: texturas 5 grupos (1.4 MB desperdiçados), materiais 173 cópias, geometrias 186 cópias (1.1 MB)

GPU (livro-razão): texturas 218 MB (104), buffers 72.6 MB, renderbuffers 8.6 MB, texturas sem dono na cena 7.9 MB

WASM: meshopt 0.3 MB · animação: {"clips":14,"tracks":2226,"MB":0.3}

Loop 300s: pós-GC 56.5 → 56.9 MB (min 56.4, max 56.9), tendência 0.06 MB/min; GPU 295.2 → 295.2 MB
