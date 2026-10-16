# Landmarks — modelos dedicados (rodada 5, passada de fidelidade)

Quatro edifícios têm modelo próprio, gerado por código (TypeScript procedural) sobre o **footprint
real do OpenStreetMap**. Objetivo: reconhecíveis **sem rótulo**, com aparência semi-realista
(materiais com grão/juntas, janelas recuadas, ornamentação na escala certa).

| Landmark | Código | Como entra no jogo | Colisão |
|---|---|---|---|
| Central do Brasil (Ed. D. Pedro II) | `src/world/landmarks/central.ts` | `manifest.landmarks` (way 81100866) | `centralColliders` (cliente + servidor) |
| Igreja da Candelária | `src/world/landmarks/candelaria.ts` | `manifest.landmarks` (way 30839484) | `candelariaColliders` (cliente + servidor) |
| Palácio Duque de Caxias | `src/world/landmarks/palacioDuqueCaxias.ts` | edifício com `model: palacio_duque_caxias` | contorno OSM (paredes do edifício) |
| Centro Cultural Banco do Brasil | `src/world/landmarks/ccbb.ts` | edifício com `model: ccbb` | contorno OSM (paredes do edifício) |

- **Edifícios de reconhecimento** (rodada 6: Banco Central, blocos do PA, Kennedy, Belacap, Embratel,
  Biblioteca Parque, Paulo de Frontin…): mesmo mecanismo `model`, selecionados por id OSM (`byId`) —
  ver [`RECOGNITION_BUILDINGS.md`](RECOGNITION_BUILDINGS.md).
- Kit compartilhado: `src/world/landmarks/arch.ts` (primitivas, grade de fachada, volumes de polígono,
  materiais PBR). Despacho dos edifícios com `model`: `src/world/landmarks/models.ts`.
- `data/overrides/buildings.json` → campo `model` → `tools/process_osm.ts` grava no chunk →
  `ChunkManager` deixa de desenhar o bloco genérico e entrega o registro ao jogo (também para chunks
  carregados depois da carga inicial — antes, um modelo fora do raio de pré-carga sumia).
- Parâmetros puros (sem three.js) e colisores: `src/world/landmarks/colliders.ts`, usados também por
  `tools/build_world.ts` (arquivo `collision.*.bin` do servidor). **Mudou parâmetro de planta → `npm run map`.**
- Edifícios com `model` não recebem painéis de LED (`tools/build_world.ts`).

## Materiais

Três texturas de detalhe CC0 (Poly Haven) projetadas em **triplanar no espaço do mundo** (sem UV):
reboco (`stone`), revestimento de concreto/pó de pedra com juntas (`concrete`) e granito polido
(`granite`). A cor vem da cor por vértice (calibrada pelas fotos); a textura dá grão, juntas, relevo
(normal) e variação de rugosidade. Por cima: escorridos de sujeira por ruído e base mais escura
(umidade). Vidros com leve reflexo do ambiente e variação (persianas/cortinas). Fonte e licença das
texturas: `docs/licenses/landmarks.md`.

## LOD e orçamento

Cada landmark tem dois níveis: **tier 0** (massa, fachadas, janelas — sempre visível) e **tier 1**
(caixilhos, balaústres, almofadas de portas, antenas, nervuras finas), que é ocultado além de
~380–520 m (`updateDetailLod`). Tudo é mesclado por material: ~6–12 draw calls por landmark.

| Landmark | Triângulos tier 0 | Triângulos tier 1 | Malhas (draw calls) |
|---|---|---|---|
| Central do Brasil | ~27 k | ~23 k | 5 + 16 do relógio (4 × mostrador, aro, 2 ponteiros) |
| Candelária | ~38 k | ~15 k | 9 |
| Palácio Duque de Caxias | ~19 k | ~82 k | 6 + letreiro |
| CCBB | ~22 k | ~16 k | 7 |

(muito abaixo do teto de 150–300 k por landmark; medido em runtime, ver relatório da rodada 5).

## Medidas usadas, fonte e confiança

Confiança: **alta** = medida publicada/OSM; **média** = proporção medida em várias fotos + coerente
com fonte; **baixa** = estimativa visual.

### Central do Brasil — Edifício D. Pedro II (1943, art déco; arq. Géza Heller e equipe)

| Item | Valor no modelo | Fonte | Confiança |
|---|---|---|---|
| Implantação/contorno | OSM way 81100866 (cantos arredondados incluídos) | OSM | alta |
| Fachada principal | leste, para a Praça Cristiano Ottoni (entradas OSM nas extremidades da aresta longa) | OSM (nós `entrance`) | alta |
| Altura da torre (cobertura) | 110 m | Diário do Rio (2023): "torre de 110 m e 32 andares" | média |
| Altura total com antenas | 135 m | Diário do Rio / guias de turismo (134–135 m) | média |
| Relógio | 4 faces, Ø 10 m, entre o 21º e o 26º pavimento (centro a 86 m) | Diário do Rio (2023) | média |
| Ponteiros | minutos ~4,2 m / horas ~3,1 m (limitados ao mostrador) | fonte cita 7,5 m e 5,35 m — inconsistente com Ø 10 m; mantida a proporção | baixa |
| Posição da torre | centro da aresta longa da fachada leste, face frontal 4 m atrás do plano das alas | fotos (torre desce entre duas alas de pontas arredondadas) | média |
| Largura do fuste | 22 m, cantos reentrantes de 2 × 2 m | proporção com o mostrador de 10 m nas fotos | média |
| Estágio do relógio | 15,5 m de largura, 76–96 m | proporção nas fotos (≈ 0,67 do fuste) | média |
| Coroamento | 11,5 m (96–106) + 9 m (106–110), estriado | fotos | média |
| Alas | 7 pavimentos, 29 m, janelas em fita junto à torre e nas curvas | fotos (2015, 2021) | média |
| Gare/hall posterior | 16 m | estimativa | baixa |

### Igreja de Nossa Senhora da Candelária (1775–1898)

| Item | Valor no modelo | Fonte | Confiança |
|---|---|---|---|
| Contorno/orientação | OSM way 30839484; fachada a leste (nó `entrance=main` em 773,−195) | OSM | alta |
| Largura da fachada | 36,8 m | aresta leste do OSM | alta |
| Comprimento | ~72 m | OSM | alta |
| Cúpula | topo 62,3 m, Ø externo 16,8 m, lioz, 8 estátuas no tambor | base de dados de arquitetura citada em pesquisa + Riotur | alta |
| Transepto | braços salientes ~3 m entre s = −13 e +4 m do centro | saliências do contorno OSM | alta |
| Ordens da fachada | 1ª até 10,4 m; cornija principal a 21,6 m | proporção na foto frontal (Halley Pacheco de Oliveira, 2012) | média |
| Torres | 8,8 m de lado; cruz a ~49,5 m do chão | mesma foto (largura da fachada como escala) | média |
| Tramos | torre · óculo · janela · central · janela · óculo · torre | fotos frontais | alta |
| Cores | cantaria cinza-acastanhada sobre panos caiados; coruchéus brancos com nervuras | fotos | média |

### Palácio Duque de Caxias (antigo Ministério da Guerra, 1937–1941)

| Item | Valor no modelo | Fonte | Confiança |
|---|---|---|---|
| Contorno + pátio | OSM relação 410476 (anel externo + interno) | OSM | alta |
| Altura da torre | 82 m (corpo até 74 m + 3 degraus) | SKYDB/Emporis (82 m, 21 pav.) | média |
| Posição da torre | centro da fachada sul (161 m, duas arestas colineares fundidas) | OSM + fotos frontais; o eixo passa pelo Panteão de Caxias (OSM) | alta |
| Bloco | 44 m (~11 pav. + platibanda) | proporção com a torre nas fotos frontais | média (antes 38 m) |
| Embasamento | 8,6 m (2 pav.) em granito rosado/castanho | fotos 2022 (Estela Neto) | média |
| Ritmo da fachada | janelas em pares entre faixas verticais salientes; loggias no último pavimento | fotos 2022 | média |
| Pórtico | 2 pilones de granito ~15 m, relevo em bronze no esquerdo, letreiro dourado | fotos 2022 / panoramio | média |

### Centro Cultural Banco do Brasil (1906, eclético)

| Item | Valor no modelo | Fonte | Confiança |
|---|---|---|---|
| Contorno | OSM way 30775640 (~71 × 44 m) | OSM | alta |
| Fachada principal | oeste, Rua 1º de Março (entrada central em granito escuro: 3 arcos + 2 óculos) | OSM (ruas) + maquete do CCBB | média |
| Altura | 31 m (embasamento 9,6 + piano nobile + 5º pav. + ático) | contagem de pavimentos nas fotos | média |
| Embasamento | térreo alto + mezanino com óculos, cantaria cinza | foto 2007 (Marcus Guimarães) | média |
| Claraboia da rotunda | Ø ~10 m no centro da cobertura | fotos internas da cúpula (posição aproximada) | baixa |

## Referências (consulta — nenhuma imagem incluída no repositório)

- Wikimedia Commons: *Central do Brasil JAN 2021* (Alvoradaking, CC BY-SA 4.0); *Torre da Central do
  Brasil* (RapWiki132, 2015, CC BY-SA 4.0); *Central do Brasil e região* (Carlos Alkmin, 2011,
  CC BY-SA 4.0); *Central do Brasil station* (Thyristorchopper, 2002, CC BY-SA 3.0); *Ed. Dom Pedro II*
  (Jefferson Freires, 2013, CC BY-SA 4.0); *Central do Brasil* (Rodrigo Soldon, 2009, CC BY 2.0).
- Wikimedia Commons: *Igreja da Candelária* (Halley Pacheco de Oliveira, 2012, CC BY-SA 3.0); *Fachada
  da Igreja da Candelária* (Rodrigojordy, 2012, CC BY-SA 4.0); *Candelária* (Andrevruas, 2011, CC BY 3.0).
- Wikimedia Commons: *Palácio Duque de Caxias* 20220930133747 e 20220930133423 (Estela Neto, CC BY-SA
  4.0); *Palacio Duque de Caxias – panoramio* (rodrigodemarque, CC BY 3.0); *Ministério da Guerra*
  20220208162315 (Estela Neto, CC BY-SA 4.0).
- Wikimedia Commons: *CCBB-Rio 2017-07-10* (Mwaldeck, domínio público); *Rio-CCBB* (Marcus Guimarães,
  2007, CC BY 2.0); *Maquete do Centro Cultural do Banco do Brasil* (Al Lemos, 2007, domínio público).
- Diário do Rio, "Relógio da Central do Brasil: 80 anos…" (2023) — altura, andares, relógio.
- pt.wikipedia "Estação Central do Brasil" — Géza Heller, 32 andares, art déco, 1943.
- Riotur / reportagens sobre a Candelária — cúpula de lioz, 62–63 m.
- OpenStreetMap (ODbL) — contornos, entradas, ruas e praças (extração `data/raw/osm_corridor.json.gz`).

## Diferenças conhecidas (honestas)

- **Central**: não há planta publicada; a posição exata da torre ao longo da fachada e o recuo entre as
  alas vêm das fotos (o contorno OSM tem a aresta leste reta). O letreiro e os detalhes de ferragem do
  acesso não foram modelados; a gare posterior é uma caixa simples.
- **Candelária**: ornamentação barroca (volutas, cartelas, brasão, relevos das portas) é simplificada
  em blocos/almofadas; o interior e os vitrais não existem; os fundos (capela-mor) não têm foto de
  referência — volumetria por planta OSM.
- **Palácio**: o revestimento real é pastilha cerâmica; aqui é a textura de concreto com juntas. O
  relevo em bronze é uma placa lisa; os mastros/antenas do bloco não foram modelados.
- **CCBB**: frontões das janelas, pilastras coríntias e mansarda não modelados; a cobertura é plana
  com claraboia (a real tem telhado e lanternim mais complexos).
- Relevo do terreno continua plano em todo o mapa (limitação geral).
