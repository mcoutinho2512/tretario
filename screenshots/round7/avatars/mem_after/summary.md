## HIGH (carga 2.456s)

| ponto | heap bruto MB | heap V8 pós-GC MB | ArrayBuffers MB | performance.memory pós-GC MB | GPU est. MB | GPU real (livro) MB | texturas | geometrias | materiais |
|---|---|---|---|---|---|---|---|---|---|
| spawn | 133.3 | 52.3 | 78.7 | 131 | 383.3 | 541.3 | 105 | 844 | 300 |
| central | 61.3 | 55.4 | 83.1 | 138.5 | 420.8 | 576.4 | 127 | 908 | 480 |
| meio | 172.4 | 60.1 | 83.9 | 143.9 | 506.1 | 664.1 | 147 | 987 | 789 |
| candelaria | 70.8 | 61.9 | 80.3 | 142.3 | 511.2 | 675.6 | 151 | 1014 | 869 |
| meio_volta | 61.9 | 61.9 | 89.3 | 151.2 | 517.7 | 676.2 | 150 | 1030 | 910 |
| central_volta | 67.5 | 62.7 | 90 | 152.8 | 513.1 | 671.5 | 151 | 1020 | 931 |

Categorias (ponto: candelaria)

| categoria | texturas | tex GPU MB | tex CPU MB | geometrias | geo GPU MB | geo CPU MB | materiais | esqueletos | bones MB |
|---|---|---|---|---|---|---|---|---|---|
| characters/npc | 60 | 128 | 98 | 170 | 9.6 | 9.6 | 575 | 575 | 2.6 |
| chunks/ground | 26 | 65.4 | 0 | 424 | 5.2 | 2.5 | 13 | 0 | 0 |
| shadows | 1 | 64 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| landmarks | 5 | 17.7 | 13.3 | 99 | 38 | 1.1 | 9 | 0 | 0 |
| chunks/buildings | 2 | 3 | 0 | 87 | 50.6 | 1.4 | 1 | 0 | 0 |
| characters/player | 16 | 38 | 28.5 | 14 | 1 | 1 | 14 | 14 | 0.1 |
| vegetation | 18 | 24.3 | 8.3 | 5 | 3.6 | 3.6 | 3 | 0 | 0 |
| monuments | 2 | 24.3 | 0.3 | 32 | 0.4 | 0.4 | 9 | 0 | 0 |
| events | 6 | 14.2 | 10.7 | 56 | 0 | 0 | 29 | 0 | 0 |
| characters/assets | 5 | 6.7 | 12 | 32 | 1.9 | 1.9 | 160 | 160 | 0.5 |
| environment | 1 | 6 | 0 | 2 | 0.1 | 0.1 | 2 | 0 | 0 |
| other | 8 | 0 | 7.3 | 8 | 2.1 | 2.1 | 8 | 0 | 0 |
| vehicles/assets | 0 | 0 | 0 | 8 | 1.6 | 1.6 | 0 | 0 | 0 |
| props | 0 | 0 | 0 | 34 | 1 | 1 | 7 | 0 | 0 |
| world/closure | 1 | 0.5 | 0.4 | 7 | 0.3 | 0.3 | 5 | 0 | 0 |
| vehicles/rideables | 0 | 0 | 0 | 36 | 0.6 | 0.6 | 34 | 0 | 0 |

Duplicatas: texturas 3 grupos (0.2 MB desperdiçados), materiais 554 cópias, geometrias 72 cópias (0.3 MB)

GPU (livro-razão): texturas 476.6 MB (314), buffers 101.3 MB, renderbuffers 97.7 MB, texturas sem dono na cena 84.6 MB

WASM: meshopt 0.4 MB · animação: {"clips":14,"tracks":2226,"MB":0.3}

Erros: THREE.WebGLProgram: Shader Error 0 - VALIDATE_STATUS false

Material Name: 
Material Type: MeshStandardMaterial

Program Info Log: Too many attributes (aBottom)


