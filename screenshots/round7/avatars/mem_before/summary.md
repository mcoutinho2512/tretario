## HIGH (carga 2.19s)

| ponto | heap bruto MB | heap V8 pós-GC MB | ArrayBuffers MB | performance.memory pós-GC MB | GPU est. MB | GPU real (livro) MB | texturas | geometrias | materiais |
|---|---|---|---|---|---|---|---|---|---|
| spawn | 133.3 | 51 | 75.5 | 126.5 | 391.9 | 540.8 | 110 | 831 | 290 |
| central | 59.6 | 54.4 | 77.7 | 132.1 | 441.7 | 589.1 | 120 | 860 | 477 |
| meio | 164.7 | 56.7 | 72.1 | 128.7 | 487 | 641.7 | 129 | 893 | 701 |
| candelaria | 62.4 | 56.7 | 66 | 122.8 | 481.8 | 642.9 | 131 | 906 | 781 |
| meio_volta | 130.8 | 57.5 | 73.3 | 130.9 | 488 | 629 | 130 | 912 | 810 |
| central_volta | 60.2 | 57.9 | 73.5 | 131.3 | 483.4 | 624.3 | 130 | 903 | 810 |

Categorias (ponto: candelaria)

| categoria | texturas | tex GPU MB | tex CPU MB | geometrias | geo GPU MB | geo CPU MB | materiais | esqueletos | bones MB |
|---|---|---|---|---|---|---|---|---|---|
| characters/npc | 45 | 105.7 | 79.3 | 94 | 4.5 | 4.5 | 539 | 539 | 2.7 |
| chunks/ground | 26 | 65.4 | 0 | 424 | 5.2 | 2.5 | 13 | 0 | 0 |
| shadows | 1 | 64 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| landmarks | 5 | 17.7 | 13.3 | 99 | 38 | 1.1 | 9 | 0 | 0 |
| chunks/buildings | 2 | 3 | 0 | 87 | 50.6 | 1.4 | 1 | 0 | 0 |
| characters/player | 16 | 38 | 28.5 | 14 | 0.9 | 0.9 | 14 | 14 | 0.1 |
| vegetation | 18 | 24.3 | 8.3 | 5 | 3.6 | 3.6 | 3 | 0 | 0 |
| monuments | 2 | 24.3 | 0.3 | 32 | 0.4 | 0.4 | 9 | 0 | 0 |
| events | 6 | 14.2 | 10.7 | 56 | 0 | 0 | 29 | 0 | 0 |
| other | 8 | 7.3 | 7.3 | 8 | 1.5 | 1.5 | 8 | 0 | 0 |
| environment | 1 | 6 | 0 | 2 | 0.1 | 0.1 | 2 | 0 | 0 |
| vehicles/assets | 0 | 0 | 0 | 8 | 1.6 | 1.6 | 0 | 0 | 0 |
| props | 0 | 0 | 0 | 34 | 1 | 1 | 7 | 0 | 0 |
| world/closure | 1 | 0.5 | 0.4 | 7 | 0.3 | 0.3 | 5 | 0 | 0 |
| vehicles/rideables | 0 | 0 | 0 | 36 | 0.6 | 0.6 | 34 | 0 | 0 |
| characters/assets | 0 | 0 | 0 | 0 | 0 | 0 | 108 | 108 | 0.3 |

Duplicatas: texturas 3 grupos (0.2 MB desperdiçados), materiais 537 cópias, geometrias 64 cópias (0.3 MB)

GPU (livro-razão): texturas 447.4 MB (368), buffers 100 MB, renderbuffers 95.6 MB, texturas sem dono na cena 77 MB

WASM: meshopt 0.4 MB · animação: {"clips":14,"tracks":2226,"MB":0.3}
