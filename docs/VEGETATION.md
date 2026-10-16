# Vegetação e mobiliário urbano (rodada 5 — passada visual)

Objetivo: trocar as árvores "bolha" e o mobiliário de primitivas por um visual **semi-realista, otimizado para web**,
sem pagar com desempenho. Licenças e origens de tudo: [`docs/licenses/vegetation_props.md`](licenses/vegetation_props.md).

## 1. Espécies e distribuição

**Fonte:** monografia da UFRRJ com o censo da arborização viária do Centro do Rio (2.693 árvores, 50 espécies).
As espécies mais abundantes, em ordem: *Licania tomentosa* (oiti), *Terminalia catappa* (amendoeira),
*Senna siamea* (cássia-siamesa), *Ficus* spp., *Pachira aquatica* (munguba) e *Handroanthus* (ipê).

**Posições:** OpenStreetMap — 647 nós `natural=tree` + amostragem de `natural=tree_row` (787 árvores no mapa).
O OSM não traz espécie, então ela é atribuída **deterministicamente pela posição** (`speciesAt` em
`src/world/vegetation.ts`):

- o mapa é dividido em células de 36 m; cada célula tem uma espécie dominante (plantio viário costuma ser por trecho);
- 22% das árvores fogem da dominante e sorteiam pela tabela global;
- palmeiras e ipês raramente dominam um trecho inteiro; nós OSM com gênero/espécie de palmeira viram palmeira.

| espécie | peso aproximado | variantes | altura base | característica modelada |
|---|---|---|---|---|
| oiti | 44% | 3 | 7,5–9,5 m | copa densa, arredondada, verde-escura; tronco curto que abre em pernadas |
| amendoeira | 17% | 2 | 9,5–11 m | pernadas horizontais em andares (verticilos), folhas largas |
| cássia-siamesa | 11% | 1 | 9 m | copa arredondada mais aberta e clara, folhagem fina |
| ficus | 9% | 1 | 13 m | tronco grosso e claro, copa larga muito densa |
| munguba | 8% | 1 | 10 m | tronco reto esverdeado, galhos ascendentes, folhas grandes |
| ipê-amarelo | 6% | 1 | 9 m | copa irregular florida (amarelo) |
| palmeira-imperial | 5% | 1 | 18 m | estipe liso anelado, palmito verde, folhas pinadas arqueadas |

Os pesos são uma **aproximação da ordem de abundância** do censo (a monografia não foi transcrita número a número);
ajuste em `SPECIES_WEIGHTS`. Cada árvore ainda varia rotação, escala (±12% sobre a escala do OSM) e tom (cor por instância).
Todas as copas são **podadas** a ~2,6–3,2 m (passagem de pedestres/ônibus), como na arborização urbana real.

## 2. Pipeline

1. **Texturas** (uma vez, versionadas em `public/vegetation/`): `python3 -I tools/vegetation/make_textures.py <dir>`
   - `leaves.webp` (1024², 225 KB): atlas 2×2 com ramos de folhas pequenas, folhas largas, ipê florido e folha de palmeira;
   - `bark.jpg` / `bark_n.jpg` (1024×512, 148 + 103 KB): casca de plátano (genérica) e de palmeira, Poly Haven CC0.
2. **Geometria** — gerada **no carregamento** (`src/world/vegetationGen.ts`), nada de malha para baixar:
   - troncos/galhos/cartões de folha pelo **ez-tree** (MIT); usamos só o código-fonte (`src/lib`) via alias do Vite,
     com o módulo de texturas trocado por stub (o build publicado embute ~4 MB de imagens);
   - `TrackedTree` registra nível/parentesco de cada galho e a origem de cada folha → poda e LOD médio;
   - normal "volumétrica" nas folhas (aponta para fora do elipsoide da copa) + oclusão por vértice
     (folhas internas/baixas mais escuras) → copa com volume, sem aparência de cartões soltos;
   - palmeira: procedural próprio (Roystonea).
   - Custo medido: 0,11 s para as 10 variantes em Node (vitest), ~0,3–0,5 s a mais no carregamento no navegador
     (geração + render dos impostores), cedendo o thread entre variantes.
3. **Desenho** — `VegetationSystem` (`src/world/vegetation.ts`):
   - `BatchedMesh` (multi-draw) por LOD × material: **4 draws** para todas as espécies (casca/folhas × perto/médio);
   - impostores: **1 draw** instanciado para todas as árvores distantes.

## 3. LOD

| faixa | ALTO/ULTRA | MÉDIO | BAIXO | malha |
|---|---|---|---|---|
| LOD0 perto | < 62 m | < 45 m | < 24 m | completa: 3,8–8,1 k triângulos/árvore (palmeira 0,8 k; média ~5,4 k) |
| LOD1 médio | 62–175 m | 45–130 m | 24–75 m | tronco + pernadas (níveis 0–1) e ~28% dos cartões de folha, ampliados: 1,0–1,8 k tri (palmeira 0,2 k) |
| LOD2 longe | > 175 m | > 130 m | > 75 m | impostor: quad virado para a câmera (eixo Y), 2 tri |

- Distâncias derivadas de `vegetationDensity` do preset (`vegetationOptionsFor`).
- O LOD é reavaliado por árvore quando a câmera anda ≥ 3 m (sem custo por quadro além do culling do BatchedMesh).
- **Impostores**: no carregamento, cada variante é renderizada de 8 azimutes num atlas (células de 128 px; 96 px no BAIXO)
  com **cor** (albedo × oclusão) e **normal** (espaço local da árvore). O shader do impostor escolhe a vista pelo ângulo
  câmera→árvore menos o yaw da instância, gira a normal do atlas para o mundo e ilumina com o `MeshStandardMaterial`
  normal da cena (sol, céu, neblina, noite). Não projetam sombra.
- **Sombras**: LOD0 projeta sempre; LOD1 projeta só no ALTO/ULTRA (no BAIXO não há shadow map).
- Folhas e impostores ficam fora dos passes com `overrideMaterial` (normal/profundidade do GTAO), que os desenhariam
  como quadrados opacos e criariam manchas escuras de AO nas copas.
- Vento: oscilação por altura com fase pela posição da instância (mesmo uniforme de tempo de antes).

## 4. Mobiliário urbano (`src/world/builders/props.ts`)

Modelos procedurais com proporções reais, **chanfros** (`RoundedBoxGeometry`), sólidos de revolução (`LatheGeometry`),
tubos curvos e perfis extrudados; materiais separados: **aço pintado** (rugosidade 0,55 / metal 0,3),
**galvanizado** (0,36 / 0,85), **plástico** (0,42), **madeira/concreto** (0,86) e **vidro**.

- poste da Pres. Vargas: cônico ~11,5 m, base flangeada, dois braços curvos, luminárias LED planas com lente emissiva
  (as luzes noturnas reais seguem `LAMP_HEADS`);
- semáforo: coluna, grupo focal com chanfro, palas sobre as lentes, anteparo preto com borda branca, botoeira;
  as **lentes continuam sendo as partes 1–3 do modelo** e recebem cor por instância em `updateSignals` (ciclo intacto);
- abrigo de ônibus (cobertura curva, vidro, banco, painel MUPI iluminado), poste de parada, banco de ripas com laterais
  de ferro fundido, "laranjinha" da Comlurb (cesto afunilado + tampa + poste), frade de ferro, banca de jornal com
  letreiro, vitrine e revistas.
- **LOD do mobiliário**: os mesmos construtores geram uma versão distante (`LO`) sem chanfros/detalhes pequenos,
  usada além de 95 m da câmera (reavaliado a cada 35 m). Versões distantes pequenas não projetam sombra.

Triângulos por modelo detalhado, medidos na prévia somando passe principal + sombra: poste 1,3 k, semáforo 0,7 k,
abrigo 1,4 k, banca 1,6 k, banco 1,0 k, poste de parada 0,4 k, lixeira 0,4 k, frade 0,2 k.

## 5. Orçamento e medições

Ambiente: MacBook (Apple Silicon, Chrome headless/Metal), 1600×900, `tools/qa/fidelity_shots.mjs` 10:30.
"Antes" = commit `15566d0` rodando lado a lado (mesma máquina, em sequência) com "depois".

### Vegetação isolada (`tools/qa/veg_budget.mjs`, triângulos antes do culling, passe principal)

| pose | ALTO perto (n) | ALTO médio (n) | impostores | BAIXO perto (n) | BAIXO médio (n) |
|---|---|---|---|---|---|
| B | 109 k (19) | 125 k (80) | 291 | 8 k (2) | 41 k (27) |
| C | 77 k (14) | 131 k (83) | 293 | 12 k (2) | 38 k (24) |
| D | 75 k (15) | 137 k (87) | 288 | 5 k (1) | 40 k (26) |
| F | 64 k (11) | 43 k (28) | 603 | 25 k (4) | 13 k (8) |
| G | 34 k (6) | 21 k (13) | 720 | 17 k (3) | 8 k (5) |

ALTO: ≤ ~240 k triângulos de vegetação visíveis no pior caso (+ o mesmo no passe de sombra para perto/médio),
dentro da meta de 300–500 k; **5 draws** no passe principal + 4 no de sombra. BAIXO: ≤ 50 k.

### Cena inteira — ALTO (antes → depois)

| pose | draws | triângulos | CPU ms | GPU ms |
|---|---|---|---|---|
| A | 469 → 454 | 1,38 M → 1,35 M | 2,79 → 2,75 | 5,34 → 5,87 |
| B | 509 → 494 | 1,45 M → 1,49 M | 2,79 → 2,79 | 5,75 → 6,18 |
| C | 584 → 572 | 1,56 M → 1,58 M | 2,83 → 2,80 | 5,29 → 6,20 |
| D | 936 → 923 | 1,56 M → 1,56 M | 2,97 → 2,84 | 4,90 → 5,14 |
| E | 578 → 567 | 1,49 M → 1,39 M | 2,73 → 2,83 | 4,78 → 4,70 |
| F | 570 → 557 | 1,45 M → 1,34 M | 2,93 → 3,03 | 5,06 → 6,61 |
| G | 774 → 754 | 1,51 M → 1,24 M | 3,07 → 3,39 | 4,89 → 6,40 |

### Cena inteira — BAIXO (antes → depois)

| pose | draws | triângulos | CPU ms | GPU ms |
|---|---|---|---|---|
| A | 139 → 134 | 228 k → 199 k | 0,90 → 1,12 | 1,45 → 1,20 |
| B | 152 → 153 | 243 k → 229 k | 0,89 → 1,16 | 1,28 → 1,74 |
| C | 191 → 192 | 276 k → 269 k | 0,94 → 1,15 | 1,51 → 1,77 |
| D | 329 → 327 | 356 k → 319 k | 1,08 → 1,33 | 2,02 → 1,27 |
| E | 202 → 203 | 271 k → 243 k | 0,95 → 1,21 | 1,54 → 1,66 |
| F | 183 → 180 | 255 k → 230 k | 1,01 → 1,27 | 1,54 → 1,31 |
| G | 268 → 267 | 298 k → 295 k | 1,09 → 1,39 | 1,52 → 1,49 |

Leitura: triângulos e draws iguais ou menores; GPU +0,2 a +1,5 ms no ALTO nas poses com mais copas
(overdraw de folhas com alphaTest + sombra das folhas no mapa 4096²); CPU +0,2–0,3 ms no BAIXO
(culling por instância do BatchedMesh + reavaliação de LOD). As medições de GPU variam ±30% entre rodadas
nesta máquina compartilhada — os valores acima são da rodada mais estável (antes/depois em sequência).

### Download

- texturas: `leaves.webp` 225 KB + `bark.jpg` 148 KB + `bark_n.jpg` 101 KB ≈ **474 KB**;
- código: chunk `Game` +50 KB (+15,6 KB gzip) — ez-tree (fonte), gerador, sistema de vegetação e mobiliário;
- nenhuma malha baixada (geração no cliente).

## 6. Ferramentas

- `tools/qa/veg_preview.html?lod=0|1|2&dist=..&x=..` — todas as variantes lado a lado (e `?props=1` para o mobiliário,
  `&only=<tipo>`); captura: `node tools/qa/veg_preview_shot.mjs <saida.jpg> "<query>"`.
- `tools/qa/veg_budget.mjs [quality]` — triângulos por LOD nas poses da passada de fidelidade.
- `tests/vegetation.test.ts` — geração determinística, orçamento por variante (LOD0 < 9 k, LOD1 < 2,5 k e < 45% do LOD0),
  predominância de oiti.

## 7. Limitações conhecidas

- Os ramos de folhas são fotos do pacote ez-tree recoloridas (cinza/ash e aspen) — não são fotos das espécies cariocas;
  de perto o oiti lembra uma árvore temperada de folha pequena. Próximo passo: atlas próprio a partir de fotos CC0
  de oiti/amendoeira.
- Impostores com 8 vistas fixas e sem mistura: há um "pulo" sutil ao circular uma árvore distante; troca de LOD sem
  dithering (pequeno estalo a 62/175 m).
- Amendoeira: os andares de galhos são retos demais; falta a cor avermelhada das folhas velhas.
- Mobiliário ainda sem texturas (só cor por vértice + materiais PBR); banca sem texto.

## 8. Capturas

`docs/screenshots/r5_veg/`: `before/`, `before_low/`, `after/`, `after_low/` (poses A–G + `metrics.json`),
`especies_lod0.jpg` (as 10 variantes), `lod0_lod1_impostor.jpg` (mesmas árvores nos 3 LODs),
`mobiliario_1.jpg`, `mobiliario_2.jpg`, `poste.jpg`, `banca.jpg`, `noite_B.jpg` (luminárias e semáforo à noite).
