# Edifícios de reconhecimento (rodada 6)

Critério do produto: quem conhece o Centro precisa **reconhecer a Presidente Vargas por um screenshot**,
trecho a trecho. Os quatro landmarks heróis (Central, Duque de Caxias, Candelária, CCBB — ver
[`LANDMARKS.md`](LANDMARKS.md)) não bastam: no meio da avenida o que identifica o lugar é a sequência de
prédios. Esta rodada dá **geometria e fachada próprias (simplificadas)** a 41 contornos OSM escolhidos
por aparecerem nas fotos que definem a avenida. O resto continua com as fachadas procedurais (shader).

## Como funciona

| Peça | Arquivo |
|---|---|
| Seleção (id OSM → modelo, com `source` e `confidence`) | `data/overrides/buildings.json` → `byId` (novo; `byName` continua valendo) |
| Aplicação no pipeline (+ `arcade: true` recalcula a galeria) | `tools/process_osm.ts` (erro se um id não existir mais no OSM) |
| Despacho | `src/world/landmarks/models.ts` |
| Kit (janelas em placas, galeria coerente com a colisão, LOD, lotes) | `src/world/landmarks/recognition.ts` |
| Banco Central | `src/world/landmarks/bancoCentral.ts` |
| Blocos do PA (6 variantes) | `src/world/landmarks/paBlocks.ts` |
| Kennedy, Belacap, Embratel, Av. PV 1111, Biblioteca Parque, Paulo de Frontin | `src/world/landmarks/recognitionModels.ts` |
| Teste (override chega ao chunk, construtor existe, orçamento) | `tests/recognitionBuildings.test.ts` |
| Capturas comparáveis | `tools/qa/recognition_shots.mjs` · candidatos por posição/lado: `tools/qa/recognition_candidates.mjs` |

- **Colisão**: continua sendo o contorno OSM (cliente e servidor, `collision.*.bin` gerado por
  `npm run map`). A galeria do térreo usa a **mesma** função `arcadeSpans` da colisão para recuar a parede
  e posicionar as colunas — o que se vê é o que bloqueia. Exceção honesta: os pilotis do Banco Central são
  visuais (a colisão é o contorno inteiro, ~3 m além do saguão).
- **Materiais**: os 6 materiais compartilhados dos landmarks (`createLandmarkMaterials`), cor por vértice;
  **nenhuma textura nova** e nenhuma textura por edifício.
- **LOD**: corpo (≤ 460 m), detalhe (ar-condicionado, montantes, aletas — ≤ 170 m) e LOD distante
  (massa + uma faixa de janela por pavimento). Banco Central: detalhe ≤ 220 m, corpo ≤ 700 m (é visto de
  longe ao longo da avenida).
- **Lotes**: edifícios da mesma célula de 220 m são mesclados por material num só grupo
  (`RecogCluster`) → 2–4 malhas por lote em vez de por prédio. Sem isso eram **+200–280 draw calls** por
  quadro; com lotes, +0–60.
- **Painéis de LED** (eventos): continuam nos blocos `pa:*` (28 locais, como antes), afastados 0,75 m da
  fachada; não vão para os demais edifícios de reconhecimento.

Triângulos por edifício (corpo + detalhe; LOD distante entre parênteses): Banco Central 7,7 k (0,1 k);
Belacap 6,1 k (0,4 k); Kennedy 6,3 k (0,4 k); PV 1111 4,8 k; Embratel 4,1 k; Paulo de Frontin 3,9 k + 3,7 k;
Biblioteca 0,9 k; blocos PA 0,5–5,4 k. Total dos 41: ~121 k (LOD distante ~9 k) — bem abaixo do teto de
15–40 k por edifício.

## Lista, fontes e confiança

Confiança: **alta** = dado publicado/OSM; **média** = forma conferida em foto + coerente com o OSM;
**baixa** = tipologia correta, mas a fachada daquele lote específico não foi verificada (atribuição pela
ordem dos prédios nas fotos).

Fotos (Wikimedia Commons, **só referência**, nenhuma incluída no repositório):
[F1] Fulviusbsas, *AvPresVargas1* (2017, CC BY-SA 4.0) — do lado sul, junto ao BC, olhando para a Candelária;
[F2] Fulviusbsas, *AvPresVargas2* (2017, CC BY-SA 4.0) — da Rio Branco olhando para oeste;
[F3] IMS, *Avenida Presidente Vargas; ao fundo, a Igreja da Candelária* (anos 1950, domínio público);
[F4] Andrevruas, *Avenida Presidente Vargas … (2011-02-04)* (CC BY 3.0) — do Campo de Santana para leste;
[F5] Thomaz Silva/Agência Brasil, *Biblioteca Parque Estadual 01* (2015, CC BY 3.0 BR);
[F6] Eduardo P, *Edifício Presidente Kennedy* (2012, CC BY-SA 3.0);
[F7] Antonio Schubert, *Avenida Presidente Vargas (6592261671)* (2011, CC BY-SA 2.0) — Embratel;
[F8] Eduardo P, *Avenida Presidente Vargas (2)* (2011, CC BY-SA 3.0) — galeria do nº 1012;
[F9] Валерий Дед, *Centro, Rio de Janeiro … panoramio (63)* (CC BY 3.0) e dfmarx, *AvenidaPresidenteVargas* (2007, CC BY-SA 2.0) — Paulo de Frontin;
[F10] Marinha do Brasil, *GLO … G20 2024* (CC BY-SA 2.0) — lado norte perto da Candelária.

### Ponta oeste / Central (Rua de Santana)

| Edifício | OSM | Modelo | O que o torna reconhecível | Fonte | Conf. |
|---|---|---|---|---|---|
| **Ed. Paulo de Frontin — "Balança Mas Não Cai"** (1945–48) | way 326571730 (+ 930538349) | `paulo_frontin:0/1` | lâmina de 22 pav. **perpendicular** à avenida, ponta vermelha voltada para a PV, corpo creme, bloco sul cinza-esverdeado, painel na cobertura | OSM (`name`, `loc_name=Balança Mas Não Cai`, `building:levels=22`); F9 | média (cores: baixa — mudaram entre 2007 e ~2015) |

> **Conferido**: o "Balança Mas Não Cai" **está** na Presidente Vargas — é o Ed. Paulo de Frontin, na
> esquina com a Rua de Santana (OSM). A suspeita inicial de que não estaria na avenida não se confirmou.

### Trecho do Campo de Santana

| Edifício | OSM | Modelo | Reconhecível por | Fonte | Conf. |
|---|---|---|---|---|---|
| **Biblioteca Parque Estadual** (Av. PV 1261; Glauco Campello, retrofit 2014) | way 30842768 | `biblioteca_parque` (altura 15 m) | pilares brancos **afunilados**, 2 níveis de vidro escuro com faixa cinza, beiral em balanço, **pórtico vermelho** | F5, F4 | média (altura por proporção — OSM sem altura) |
| **Av. PV 1111** (torre de vidro) | way 1001914831 | `pv1111` | pele de vidro azulado com aletas verticais brancas, ao lado da Biblioteca | F5 (ao fundo) | média |

### Meio (Passos → Uruguaiana)

| Edifício | OSM | Modelo | Reconhecível por | Fonte | Conf. |
|---|---|---|---|---|---|
| **Embratel** (Av. PV 1012) | way 330383010 | `embratel` | lâmina de faixas horizontais claras, colunata de granito escuro de pé-direito duplo, letreiro na cobertura (sem texto — marca mudou) | OSM (55 m); F7, F8 | média |
| **Banco Central do Brasil** (Av. PV 730, 1984) | way 270244540 | `banco_central` (129,7 m) | o prédio **mais alto da avenida**: caixas de vidro escuro empilhadas e **defasadas** sobre núcleo branco em cruz, vazios com colunas brancas, pilotis | SKYDB/Structurae 129,67 m/25 pav.; Diário do Rio 130 m/26 pav.; F1, F4 | **alta** (altura); média (forma) |
| **Ed. Belacap / Universidade Estácio** (Av. PV 642) | way 433273588 | `belacap:letreiro` | grelha profunda de concreto bege + **letreiro azul** horizontal | OSM (`official_name=Edifício Belacap`, 75 m); F1 | média |
| vizinho do Belacap | way 433274237 | `belacap` | mesma grelha bege entre o BC e o Belacap | F1 | baixa |
| **Ed. Presidente Kennedy** (Av. PV 633, esquina da Uruguaiana) | way 1052032450 | `presidente_kennedy` | "streamline": **faixas de pastilha azul** em todos os pavimentos, ponta curva, pilotis redondos | F6; nº 633 por cadastro comercial | média |

### O "paredão" do PA (Uruguaiana → Rio Branco) e o fim da avenida

Tipologia (F3, F1, F2, F10): torres de 22–24 pavimentos alinhadas, **galeria de dois pés-direitos** no
térreo (colunas), cornija sobre a galeria, empenas laterais **cegas**, reboco claro com janelas pontuais e
**ar-condicionado** de janela, coroamento escalonado nas mais antigas.

| Lado / trecho | OSM (ways) | Modelo | Fonte | Conf. |
|---|---|---|---|---|
| Norte, esquina da Uruguaiana | 433273654 | `pa:pilares:esquina` (bege de pilastras) | F1 | baixa |
| Norte | 433273538 | `pa:faixas` (lâmina de faixas brancas) | F1 | baixa |
| Norte, até a Rio Branco | 433274872, 433275194, 433275011, 433273364, 433273485, 433274377, 433274597, 433273594, 433274392, 433273546, 433275108, 433274998 | `pa:creme` (tom por hash: creme/branco/cinza/bege) | F1, F3 | baixa |
| Sul, esquina da Rio Branco ("Santander") | 1052039664 | `pa:varandas:esquina` (loggias + pilotis afunilados) | F2 | média |
| Sul, vizinho | 1052039681 | `pa:tijolo` (marrom de pilastras, coroamento) | F2 | média |
| Sul, até a Uruguaiana | 1052039676, 1052039647, 1052039660, 1052039694, 1052039673, 1052039635, 1052039658, 1052039666 (esquina) | `pa:creme` | F2 | baixa |
| Sul, antes da Candelária | 432943578, 432943760 | `pa:coroa` (brancas, coroamento escalonado, pilares quadrados) | F3 | média |
| Sul, junto à Candelária (44 m) | 432943573, 432943877, 432943742, 432943746, 432943525 (esquina) | `pa:coroa` | F3 (fachadas individuais não verificadas) | baixa |

### Avaliados e **não** modelados (e por quê)

- **Centro Administrativo São Sebastião ("Piranhão")**, **Teleporto**, **Sambódromo/Praça Onze**: fora do
  recorte do mapa (bbox oeste −43,1965; ficam mais a oeste, na Cidade Nova).
- **Sede da Transpetro** (Av. PV 328, 77,5 m) e os blocos de 44–50 m do lado **norte** junto à Candelária:
  sem foto atribuível com segurança — ficaram no procedural (F10 mostra um prédio de vidro/aço ali, mas não
  consegui casar com um contorno).
- **Escola Municipal Rivadávia Corrêa** (Av. PV 1314): não achei descrição/foto confiável do prédio.
- **Rio Imagem** (Av. PV 1733): sem altura no OSM nem foto de referência.
- **Igrejas de São Gonçalo Garcia/São Jorge e Santa Rita**: não estão na fachada da avenida (Rua da
  Alfândega / Largo de Santa Rita) — fora do critério "visível da PV".
- **Edise (Petrobras)**: fica na Av. República do Chile, não na Presidente Vargas.

## Capturas antes/depois

`docs/screenshots/r6_recognition/before/` × `after/` — mesmas poses (`tools/qa/recognition_shots.mjs`,
qualidade high, 10:30). "Antes" = commit 5d78798 (só o shader procedural nesses lotes).

| Pose | O que mostra |
|---|---|
| `p1_santana`, `c6_paulo_frontin` | ponta oeste: Paulo de Frontin (no "antes" era uma torre genérica cinza) |
| `p2_central_leste` | da Central para leste |
| `p3_campo_santana`, `c4_biblioteca` | Biblioteca Parque + torre de vidro do nº 1111 (enquadramento de F4/F5) |
| `p4_meio`, `c2_embratel` | Embratel e o Kennedy ao fundo |
| `c1_banco_central` | enquadramento de **F1**: BC + Belacap + paredão + Candelária (no "antes" o BC tinha **9 m**) |
| `p5_portal_candelaria`, `c5_rio_branco` | paredão PA dos dois lados (enquadramento de F2) |
| `p6_oeste` | da Candelária olhando para oeste |
| `a1_meio`, `a2_oeste`, `a3_candelaria` | aéreas |

## Métricas (high, 1600×900, `tools/qa/fidelity_shots.mjs`, `BASE=http://localhost:5193`)

| Captura | draw calls antes → depois | triângulos antes → depois |
|---|---|---|
| C (Central) | 583 → 577 | 1,99 M → 1,93 M |
| D (avenida) | 952 → 987 | 2,51 M → 2,38 M |
| F (Candelária) | 525 → 557 | 1,49 M → 1,61 M |
| G (meio) | 697 → 757 | 1,78 M → 2,07 M |

(Triângulos incluem as passadas de sombra. Tempos de GPU nesta máquina variaram 2–3× entre execuções
idênticas por causa de outros processos — não usei como métrica.)

## Avaliação honesta — dá para reconhecer trecho a trecho?

- **Ponta da Candelária (Rio Branco → Candelária)**: **sim, com boa margem.** O corredor de lâminas claras
  com galeria e ar-condicionado, a Candelária fechando a perspectiva e o BC escuro atrás (vista para
  oeste) formam a imagem clássica. O que falta: o lado norte junto à Candelária (Transpetro e blocos de
  44–50 m) ainda é procedural; não há letreiros/lojas reais nas galerias.
- **Meio (Passos → Uruguaiana)**: **sim, a partir desta rodada.** O Banco Central passou de 9 m (sem altura
  no OSM) para a torre de 130 m de caixas escuras — é *a* referência do meio da avenida em qualquer foto;
  junto com o Belacap (grelha bege + letreiro azul) e o Kennedy (faixas azuis), o enquadramento de F1 é
  reconhecível. Ressalva: entre a Passos e o BC (lado norte, 55–78 m) os prédios continuam genéricos.
- **Trecho do Campo de Santana**: **provável, não garantido.** A Biblioteca Parque (pilares afunilados +
  pórtico vermelho) e a torre de vidro do 1111 ajudam, e o Duque de Caxias já era herói; mas o lado norte
  (Escola Rivadávia Corrêa, prédios de 55 m com empenas publicitárias de F4) segue genérico e o relevo/
  vegetação do Campo de Santana não muda. Quem conhece reconhece pelo conjunto Duque de Caxias + parque +
  BC ao fundo, não por um prédio isolado.
- **Ponta da Central / Rua de Santana**: **sim pela Central**, e agora o "Balança Mas Não Cai" dá a
  referência do lado oeste (vista do Mangue, F9). O resto da ponta oeste (galpões, Rio Imagem) é genérico.

Limitações gerais: fachadas são simplificadas (sem caixilhos individuais, sem lojas/letreiros reais,
sem a variedade de cores e reformas de cada prédio); a atribuição de variante PA a cada lote é baixa
confiança; a pele de vidro não reflete a vizinhança (só o céu/ambiente).
