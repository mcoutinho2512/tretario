# Memória (rodada 6)

Objetivo: provar que o jogo cabe na memória de um navegador comum, sem crescimento contínuo.
Ponto de partida (rodada 5): `performance.memory.usedJSHeapSize` entre 245 e 485 MB (Chrome).

## 1. Método — medir antes de otimizar

Ferramentas (todas gratuitas, só Chrome + CDP):

| peça | o que faz |
|---|---|
| `src/debug/memProbe.ts` | importado primeiro em `main.ts`. Registra a `WebAssembly.Memory` de cada módulo (Rapier, decodificador meshopt). Com `?mem=1` instala o **livro-razão da GPU**: intercepta as chamadas de *alocação* do WebGL2 (`texImage*`, `texStorage*`, `bufferData`, `renderbufferStorage*`, `generateMipmap`, `delete*`) e mantém o tamanho vivo de cada textura/buffer/renderbuffer — inclui o que não está na cena (alvos do composer, PMREM, sombra). Desligado por padrão (intercepta binds). |
| `src/debug/memoryReport.ts` → `__pv.memoryReport(dup = true)` | percorre a cena e os caches do AssetManager; agrupa por **categoria de dono** (`userData.category` no objeto ou ancestral; na falta, nome do grupo-raiz): texturas (L×A×bytes/texel ×4/3 com mip, ×6 em cubo; tamanho real do livro-razão quando disponível; cópia na CPU), geometrias (bytes de atributos; GPU e CPU separados), materiais, esqueletos/bone textures, clipes, WASM, heap. **Duplicatas**: texturas com o mesmo conteúdo (hash de amostra 24×24 ou dos dados), materiais com os mesmos parâmetros (incl. `onBeforeCompile`), geometrias com os mesmos dados. |
| `tools/qa/memory_report.mjs` | abre o jogo por preset com `?mem=1`, mede no spawn e após teleportar Central → meio → Candelária → meio → Central (7 s de streaming em cada). Em cada ponto: relatório, `performance.memory`, CDP `Runtime.getHeapUsage` (heap V8 **e** *backing stores* de ArrayBuffer) antes e depois de GC forçado. `--profile`: amostragem do heap por arquivo-fonte. `--loop=300`: **teste de vazamento**, 5 min de teleportes em ciclo, heap pós-GC por ciclo + GPU do livro-razão → `loop.json` e gráfico `loop.svg`. |
| `tools/qa/mp_memory_check.mjs` | servidor de teste próprio (porta 2693), 2 jogadores com corpos diferentes, empurrão → ragdoll (Rapier), relatório com memória WASM. |

Uso: `npx vite --port 5191` e `BASE=http://localhost:5191 node tools/qa/memory_report.mjs <saida> high,medium,low --loop=300 --profile`.
Janela 1600×900, `devicePixelRatio` 1 no headless (o preset ALTO usa pixelRatio 2 → composer em 3200×1800).

### O que a medição mostrou (antes)

`performance.memory.usedJSHeapSize` **inclui os backing stores de ArrayBuffer**. Separando via CDP:

| ALTO, Candelária | MB |
|---|---|
| heap V8 após GC | 70,9 |
| **ArrayBuffers (typed arrays)** | **195,8** |
| performance.memory após GC | 266,7 (pico bruto sem GC: 382) |

Ou seja: ~75 % do "heap" eram **cópias na CPU de dados que já estavam na GPU** — pixels das texturas procedurais do chão
(9 texturas 1024² RGBA de asfalto/pedra portuguesa/praça + grama/concreto/meio-fio/brita: ~49 MB), arrays de vértices dos
edifícios dos chunks (~51 MB), dos marcos (~25 MB), do chão (~5 MB), das variantes de árvore duplicadas no BatchedMesh (~4 MB)
e o binário inteiro dos GLBs retido pelo `parser` do GLTFLoader. O heap V8 propriamente dito (~70 MB) é dominado por
three.js, segmentos de colisão (`walls.ts`, ~8 MB) e marcos.

Outros achados:
- **Atlas das placas de rua 1024×8192** (arredondado para potência de 2 com 18 nomes): 43 MB de GPU + 32 MB de canvas.
- **Imagens idênticas decodificadas várias vezes**: acessórios (bolsa, chapéu, boné, mochila, óculos), olhos, sobrancelhas,
  cílios e sapatos têm os MESMOS bytes em homem/mulher/idoso/idosa e em LOD0/LOD1 (hash MD5 igual dentro dos GLBs);
  cada GLB virava uma textura separada (13 grupos duplicados no relatório, 5,7 MB de GPU só na cena medida; até ~8× por imagem
  quando todos os corpos/LODs estão carregados).
- **Veículos montáveis**: cada bicicleta/patinete/carro criava as próprias geometrias e materiais (152 geometrias, 114 materiais
  para 19 veículos).
- **Chunks**: a silhueta distante (`buildingsFar`) nunca era descartada — ficava oculta para sempre quando o chunk saía do
  raio (crescimento limitado ao total de chunks visitados).
- GPU (livro-razão, ALTO): 571 MB = texturas 383 (sombra 4096² = 64 MB; composer HalfFloat 2× ~46 MB em 3200×1800 + GTAO ≈ 91 MB
  sem dono na cena) + buffers 89 + renderbuffers 99 (profundidade/MSAA do composer).
- WASM: meshopt 0,3 MB; Rapier 1,3 MB (só depois do primeiro ragdoll). Clipes de animação: 14 clipes, 0,3 MB.
- **Sem vazamento contínuo já antes**: 5 min de teleportes → heap pós-GC estável (+0,09 MB/min ALTO), GPU constante.

## 2. O que mudou

### `src/core/AssetManager.ts` (novo)
- **Texturas por URL** (`loadTexture(url, categoria, {srgb, anisotropy, wrap})`): uma textura por URL+opções, contagem de
  referências (`releaseTexture`). Usado por vegetação (folhas/casca) e texturas de detalhe dos marcos.
- **GLTF por URL** (`loadGLTF`/`releaseGLTF`): um carregamento por URL, contagem de referências, e um plugin que intercepta
  `parser.loadImageSource`: **imagens embutidas deduplicadas por hash dos bytes** entre TODOS os GLBs → uma decodificação e uma
  `Source`; o three.js compartilha a textura WebGL entre texturas com a mesma Source e os mesmos parâmetros. O `parser`
  (binário inteiro do GLB) é solto após a carga. Usado por `HumanAssets` (personagens + `anims.glb`) e `vehicleModels`
  (o GLB dos veículos é liberado logo após o *bake*).
- **Materiais compartilhados por chave** (`material(key, categoria, factory)` / `releaseMaterial`).
- **Cópia na CPU solta após o upload** (só depois que o renderer do jogo existe — a prévia do avatar usa outro contexto):
  - `releaseCpuAfterUpload(tex)`: DataTexture → `data = null`; canvas → zera o canvas; ImageBitmap → `close()`.
  - `releaseGeometryCpu(geo)`: calcula bounding box/sphere e anula os arrays no `onUpload` de cada atributo.
- Registro para o relatório (`register`, `registerClips`).

### Aplicações
| onde | mudança |
|---|---|
| `renderer/materials.ts`, `builders/ground.ts` (gradil), `builders/buildings.ts` (atlas de letreiros) | pixels procedurais soltos após o upload |
| `ChunkManager` | arrays dos edifícios (perto e longe) e do chão soltos após upload; `buildingsFar` descartado quando o chunk fica oculto; categorias |
| `landmarks/arch.ts` | geometria mesclada dos marcos sem cópia na CPU; peças de origem soltas após `build()`; texturas pelo AssetManager |
| `Monuments.ts` | atlas das placas com altura exata (1024×4608, NPOT com mipmaps no WebGL2) e canvas solto |
| `vegetation.ts` | texturas pelo AssetManager; geometrias-fonte das variantes descartadas (CPU e os buffers de GPU criados no *bake* dos impostores) após cópia para o BatchedMesh |
| `vehicles/Rideable.ts` | protótipo por tipo+cor; instâncias são clones rasos (geometria/material compartilhados) |
| `HumanAssets.ts` | só o carregamento passou ao AssetManager (sem mudança de API) |
| `Game.ts` | `__pv.memoryReport()`; `__pv.pick` ignora malhas sem arrays na CPU (raycast precisa deles) |

## 3. Resultado (antes → depois)

Resumo: `performance.memory` pós-GC no ALTO **267 → 102 MB** (estado final, com o master), pico bruto observado
382 → ~229 MB (bem abaixo dos 485 MB da rodada 5); heap V8 71 → 51 MB; ArrayBuffers 196 → 51 MB; GPU real 571 → 511–546 MB
(o resto é sombra/composer do preset). Nenhum crescimento contínuo em 5 min de teleportes em ALTO/MÉDIO/BAIXO.

Ponto "Candelária" (depois de atravessar o corredor), Chrome headless, 1600×900.

| preset | heap V8 pós-GC | ArrayBuffers | **performance.memory pós-GC** | pico performance.memory (sem GC) | GPU est. (cena) | GPU real (livro-razão) |
|---|---|---|---|---|---|---|
| ALTO | 70,9 → 49,3 | 195,8 → 36,1 | **266,7 → 85,5** | 382 → 221 | 388 → 364 | 571,5 → 548,1 |
| MÉDIO | 62,0 → 40,2 | 186,8 → 34,7 | **248,8 → 75,2** | 292 → 132 | 329 → 304 | 360,2 → 337,0 |
| BAIXO | 55,9 → 35,2 | 176,2 → 35,3 | **232,1 → 70,5** | 268 → 120 | 288 → 265 | 299,2 → 276,0 |

(O "pico sem GC" é lixo de curta duração — reconstrução de props/chunks — e varia de execução para execução; o valor
pós-GC é o que de fato fica vivo.) Após o merge com master (edifícios de reconhecimento + perfil de dispositivo): ver §3.1.

Categorias (ALTO, Candelária) — MB:

| categoria | tex GPU | tex CPU | geo GPU | geo CPU | materiais |
|---|---|---|---|---|---|
| chunks/ground | 65,4 → 65,4 | **49,1 → 0** | 5,2 → 5,2 | 5,2 → 2,5 | 13 → 13 |
| chunks/buildings | 3,0 → 3,0 | 2,3 → 0 | 51,4 → 51,4 | **51,4 → 1,4** | 1 → 1 |
| landmarks | 17,7 → 17,7 | 13,3 → 13,3¹ | 24,6 → 24,6 | **24,6 → 0,1** | 9 → 9 |
| monuments (placas) | **43,0 → 24,3** | **32,3 → 0,3** | 0,4 | 0,4 | 9 → 9 |
| vegetation² | 24,3 → 24,3 | 8,3 → 8,3 | 3,6 + 3,6 variantes → 3,6 | 7,2 → 3,6 | 3 → 3 |
| characters/player | 46,0 → 48,7³ | 40,5 → 40,5¹ | 0,9 | 0,9 | 14 → 14 |
| characters/npc | 12,3 → 8,0 | 13,3 → 6,0 | 1,0 | 1,0 | 97 → 93 |
| vehicles/rideables | 0 | 0 | 1,0 → ~0 | 1,0 → ~0 | **114 → 4** |
| shadows / environment² | 64 / 6 | 0 | — | — | — |

¹ imagens decodificadas (HTMLImageElement/ImageBitmap) — memória do navegador fora do heap JS; ver riscos.
² no relatório "antes" a sombra (64 MB) aparecia somada à vegetação e o PMREM em "other"; corrigido no relatório.
³ variação de quais LODs/corpos estavam carregados no momento.

Duplicatas (ALTO, Candelária): texturas 13 grupos / 5,7 MB → 3 grupos / 0,2 MB (restam texturas internas 60×60/30×30 do
BatchedMesh, por desenho); geometrias duplicadas 186 → 39 (restantes: esferas/caixas pequenas de props); materiais
"idênticos" 237 → 131 — os restantes são materiais POR PERSONAGEM (tinta de pele/roupa clonada em `HumanCharacter`, área
de outro agente; custo só de CPU, programa compartilhado).

### 3.1 Teste de vazamento — 5 min de teleportes contínuos

Ciclo Central → 30 % → 55 % → Candelária → 55 % → 30 % a cada 2,5 s; GC forçado e amostra no fim de cada ciclo.

| preset | antes: pós-GC início → fim (tendência) | depois: pós-GC início → fim (tendência) | GPU (livro) depois |
|---|---|---|---|
| ALTO | 71,4 → 72,1 MB (+0,09 MB/min) | 50,4 → 50,5 MB (−0,02 MB/min) | 549,6 → 549,6 |
| MÉDIO | 61,6 → 61,9 MB (−0,05 MB/min) | 40,6 → 41,0 MB (+0,07 MB/min) | 335,1 → 335,1 |
| BAIXO | 56,5 → 56,9 MB (+0,06 MB/min) | 35,4 → 35,8 MB (+0,08 MB/min) | 273,5 → 273,5 |

**Depois do merge com master** (edifícios de reconhecimento, perfil de dispositivo/resolução dinâmica) — mesmo teste:

| preset | heap V8 pós-GC | ArrayBuffers | performance.memory pós-GC | laço 5 min pós-GC (tendência) | GPU (livro) no laço |
|---|---|---|---|---|---|
| ALTO | 73,4 | 50,6 | 124,0 | 74,0 → 74,0 MB (+0,02 MB/min) | 545 → 495⁴ |
| MÉDIO | 62,6 | 48,8 | 111,3 | 62,9 → 64,1 MB (+0,19 MB/min)⁵ | 338,4 → 338,5 |
| BAIXO | 59,0 | 48,2 | 107,2 | 59,1 → 59,5 MB (+0,08 MB/min) | 285,4 → 285,4 |

Os edifícios de reconhecimento trouxeram ~+23 MB de heap V8 e ~+15 MB de ArrayBuffers: cada membro de cluster guarda o
próprio `ArchBuilder` (milhares de `BufferGeometry` pequenas) para reconstruir o cluster quando outro chunk carrega.
Correção: `ArchBuilder.compact()` (chamado por `absorb`) funde as peças de cada material|tier numa geometria —
**heap V8 no ALTO 73,4 → 51,1 MB**, performance.memory pós-GC 124 → **102 MB**, visual idêntico (capturas de
`recognition_shots.mjs` comparadas com `docs/screenshots/r6_recognition/after`: diferença média < 1,5/255 fora das cenas com
trânsito em primeiro plano).

⁴ a GPU cai durante o laço no ALTO porque a resolução dinâmica (frame governor do master) reduz o composer — não é vazamento.
⁵ +1,2 MB em 5 min com mínimo 62,9 / máximo 64,3: dentro do ruído de JIT/GC observado (o mesmo preset deu −0,05 MB/min antes
do merge); vale repetir com laço mais longo se aparecer em campo.

Gráficos: `docs/memory/{before_loop,after_loop,merged_loop}/<preset>_loop.svg` (azul = heap pós-GC, cinza = sem GC, laranja = GPU). Tabelas completas:
`docs/memory/before_loop/summary.md`, `docs/memory/after_loop/summary.md`, `docs/memory/merged_loop/summary.md`.

**Sem crescimento contínuo** em nenhum preset: a inclinação fica em ±0,1 MB/min (ruído de GC/JIT) e a GPU não muda.

**Estado final** (depois do 2º merge com master: multidão com animação assada/VAT e AOI), Candelária, sem laço:

| preset | heap V8 pós-GC | ArrayBuffers | performance.memory pós-GC | pico bruto (sem GC) | GPU est. | GPU real (livro) |
|---|---|---|---|---|---|---|
| ALTO | 56,3 | 64,0 | **119,4** | 254,6 | 454,6 | 566,8 |
| MÉDIO | 43,9 | 59,6 | **103,4** | 178,9 | 356,1 | 385,4 |
| BAIXO | 36,5 | 50,5 | **87,0** | 140,9 | 283,3 | 292,9 |

A multidão nova carrega mais corpos/LODs detalhados para NPCs (`characters/npc`: 29 texturas, 64 MB de GPU, 526 malhas
com pele, 2,6 MB de bone textures no ALTO); a deduplicação de imagens mantém as duplicatas de textura em 0,2 MB.
Os 518 materiais "idênticos" são os clones por personagem da multidão (área do agente de multidão).

### 3.2 Regressão visual e jogabilidade
- `tools/qa/fidelity_shots.mjs` (ALTO, 10:30) antes/depois: poses A–G sem diferença no conteúdo estático; as diferenças de
  pixel vêm de trânsito/pedestres (dinâmicos) e de pequenas variações da câmera de terceira pessoa. Close-up de uma placa de
  rua conferido (atlas NPOT correto).
- `npm run verify` verde em todos os commits; `tools/qa/mp_memory_check.mjs`: 2 jogadores se veem (personagem remoto via
  AssetManager), empurrão derruba (ragdoll Rapier, 1,3 MB de WASM), 0 erros.

## 4. Riscos e pendências

- **Perda de contexto WebGL**: texturas procedurais e geometrias estáticas não têm mais cópia na CPU; após um
  `webglcontextlost` o jogo precisaria recarregar (já era o comportamento prático — não há tratamento de restauração).
- **Raycast em malhas estáticas** (chunks, marcos) não funciona mais (sem arrays). Nada no jogo usa; `__pv.pick` foi adaptado.
- Quem chamar `needsUpdate` numa textura/atributo liberado reenviaria dados vazios. Só são liberados recursos estáticos;
  billboards/relógios (canvas dinâmicos) não.
- Imagens decodificadas dos personagens (ImageBitmap, ~40 MB no LOD0 do jogador; 2048² do corpo) e das texturas de detalhe
  (HTMLImageElement, ~13 MB) continuam na memória do processo (fora do heap JS). Fechar o ImageBitmap é inseguro porque a
  mesma Source pode ser reenviada com outros parâmetros e `averageColor()` lê a imagem — fica para quando o
  `HumanAssets`/`HumanCharacter` (outro agente) pré-calcular as cores médias.
- GPU no ALTO é dominada por escolhas do preset: sombra 4096² (64 MB), composer HalfFloat em 3200×1800 (~92 MB) + GTAO e
  renderbuffers (99 MB). Reduzir mudaria o visual — fora do escopo.
- Texturas procedurais do chão: 65 MB de GPU (9× 1024² com mip). KTX2/Basis exigiria `toktx` (não instalado) — não feito.
- `HumanCharacter` cria um `Skeleton` por pele de origem; os GLBs LOD0/LOD1 têm 12–13 *skins* → até 13 esqueletos/bone textures
  por personagem detalhado (pouca memória, mas CPU). Sugestão para o dono da multidão: fundir skins no export.
- Edifícios de reconhecimento (master): os membros continuam com as peças (já compactadas) na CPU para reconstruir o
  cluster (~15 MB de ArrayBuffers). Dá para soltar quando todos os membros do cluster tiverem carregado (dono: agente de
  identidade dos edifícios).
- No ALTO o corredor inteiro fica dentro de `lodDistances[2]`: o caminho de descarte de chunks só é exercitado de verdade no
  BAIXO/MÉDIO (onde a GPU também ficou constante no laço).
