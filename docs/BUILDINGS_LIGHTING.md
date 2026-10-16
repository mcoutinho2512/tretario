# Edifícios, chão e iluminação — rodada 5 (visual overhaul)

Objetivo: sair do aspecto de protótipo ("prédios só caixas", "a mesma janela repetida centenas de vezes",
"materiais de plástico", "luz cinza lavada") para um visual urbano semi-realista e leve para a web, em que quem
conhece o Centro reconheça a Presidente Vargas num screenshot. Restrições mantidas: dados reais primeiro (footprints
e alturas do OSM inalterados, pipeline não regenerado), horário real (sol calculado; noite continua noite),
presets LOW/MEDIUM/HIGH/ULTRA, nenhum asset pago, nenhum download novo de asset.

Referências visuais: fotos da Wikimedia Commons listadas em `docs/licenses/buildings_ground.md` (prédios de
escritório dos anos 40–70 em creme/gelo com pilastras e caixilhos de muitas folhas, aparelhos de ar-condicionado
de janela, térreo em pilotis com lojas escuras; asfalto liso cinza-médio; tracejado curto; céu azul saturado com
cúmulos).

## 1. Céu, sol e IBL (`src/renderer/Environment.ts`, `timeOfDay.ts`)

| Antes | Agora |
|---|---|
| Céu Preetham (`three/Sky`, turbidez 3,2) + nuvens com cobertura 0,47 → céu quase todo coberto, cinza | Shader de céu analítico próprio: zênite azul saturado, horizonte claro/úmido, faixa de pôr do sol do lado do sol, halo + disco solar, poucas estrelas à noite (poluição luminosa), brilho alaranjado da cidade no horizonte |
| IBL = o mesmo céu Preetham + chão marrom | IBL gerado (PMREM, a cada 30 s com o horário) do MESMO céu + **anel de 40 silhuetas de prédios** com faixas de "vidro" — vidros e metais refletem cidade, não céu vazio |
| Neblina azul-acinzentada fixa (escurecida à noite) | Neblina = cor do horizonte do momento (dia azul-claro úmido, crepúsculo quente, noite escura) e começa a 420 m |
| Exposição 0,82 (dia) / 1,25 (noite), hemisfério 0,12–0,42 | Exposição 0,95 / 1,35; hemisfério mais neutro (céu 0,66/0,74/0,88; rebote do chão quente 0,56/0,50/0,42); `environmentIntensity` 0,72 (dia) → 0,25 (noite) |
| Cúmulos cinza | Cúmulos esparsos (cobertura 0,60), topo branco iluminado pelo sol, base cinza-azulada, somem na névoa perto do horizonte; à noite escuros com reflexo da cidade |

- O sol continua vindo de `geo/solar.ts` (data/hora reais do Rio). `timeUniforms` agora também expõe `sunDir`
  (sol de dia, "luar" à noite) e as cores atuais do céu, usados pelo shader de fachada.
- Tone mapping: ACES Filmic mantido (testado com o restante do jogo; personagens e veículos de outras áreas foram
  calibrados com ele). Sombras: PCFSoft, mesma resolução por preset; nada mudou em `settings.ts`.
- Não usamos HDRI: um HDRI é um horário fixo; o jogo precisa de manhã/tarde/pôr do sol/noite reais (ver licenças).

## 2. Edifícios comuns (`src/world/builders/buildings.ts`, `facadeShader.ts`)

Continua UM material compartilhado para todos os prédios (poucas trocas de estado). A variedade vem de hashes
determinísticos da semente de cada prédio (do pipeline) — o mesmo prédio é sempre igual para todos os jogadores.

**Material da fachada por prédio** (escolhido pelo estilo + semente):
reboco pintado (paleta creme/gelo/bege dominante nos prédios altos, cores vivas nos sobrados), concreto aparente
(tábuas de fôrma de 15 cm + furos de tirante), placas de pedra (granito/travertino, juntas sutis), pastilhas de 5 cm
(3 tons misturados, viram cor média à distância), pele de vidro (torres de escritório > 50 m), azulejo português
(15% dos sobrados).

**Janelas por prédio**: largura do vão, proporção da janela, peitoril, profundidade do vão (0,03–0,35 m), caixilho
(alumínio, branco, bronze, ferro verde; madeira/verde/azul nos sobrados), divisões (2 folhas, bandeira, grade 2×3
de ferro, basculantes 2×5, colonial 2×4), arco pleno (sobrados/ecléticos), vidro (tonalidade e refletância).
Por janela: cortina (cores variadas), persiana, veneziana fechada (sobrados), luz acesa à noite (quente/fria).

**Profundidade sem geometria**: parallax do vão — ombreiras, verga (sombreada) e peitoril aparecem conforme o
ângulo de visão; a sombra do sol dentro do vão é calculada com a direção solar real.

**Elementos**: pilastras (art déco sempre; parte dos "clássicos"), faixas de laje, peitoris rebaixados,
molduras em relevo, frontões (ecléticos), gradis de sacada (sobrados), **ar-condicionado de janela** (22–52% das
janelas nos prédios de 1940–70, com mancha de pingadeira), **brise-soleil** (aletas verticais ou lâminas
horizontais em ~30% dos "clássicos" e ~50% dos escritórios sem pele de vidro, com oclusão e sombra projetada analíticas), escorridos de limo sob os
peitoris e sob a cornija, encardido e respingos na base, cornija/platibanda com balaustrada (sobrados).

**Relevo**: altura procedural → normal por derivadas de tela (sem textura). Desligado no LOW.

**Térreo**: lojas de 3,6–6,4 m com pilares de granito; portas de enrolar onduladas (fechadas, meio-abertas,
abertas; à noite quase todas fechadas), vitrines com caixilho de alumínio e **interior em profundidade** (parallax
de 2,5 m: prateleiras, mercadorias, piso, luz de teto), letreiros coloridos com palavras GENÉRICAS (atlas em
canvas, sem marcas), alguns luminosos à noite; portarias com moldura de granito escuro e saguão iluminado; base
rusticada com janelas gradeadas nos ecléticos/institucionais. As galerias do "PA" (geometria existente) recebem
as mesmas lojas na parede interna.

**Geometria nova (somente LOD próximo, `roofDetails`)**:
- platibanda de 1,0 m (face interna + rufo) — a laje fica 1 m abaixo do topo; **a altura OSM do prédio não muda**;
- marquises de concreto (1,4–2,3 m) sobre o térreo comercial em ~70% dos prédios (35% dos sobrados), fora das
  arestas com galeria; spots acesos embaixo à noite;
- casas de máquinas/reservatórios nos prédios > 20 m (agora com veneziana e porta);
- caixas d'água de fibra azul em ~70% dos telhados baixos;
- coberturas: telha cerâmica (sobrados), laje de concreto, manta asfáltica, manta aluminizada, com juntas e manchas.

**Anti-serrilhado**: padrões (janelas, caixilhos, pastilhas, juntas) convergem para a cor média quando o pixel cobre
vários elementos; janelas acesas distantes viram um brilho médio (sem "chuvisco" nas torres à noite).

## 3. Chão (`src/renderer/textures.ts`, `materials.ts`, `src/world/builders/ground.ts`)

- **Asfalto** (o melhor elemento anterior; preservado o tom/agregado): trincas agora só em zonas fissuradas
  (~25% da área), 2,5× mais finas e com células 2× menores (antes: rede de "trincas gigantes" em todo o tile);
  remendos discretos com borda; tom neutro-quente (antes azulado); normal 2,2 → 1,3 (× `normalScale` 0,7);
  rugosidade 0,90 ± 0,04 (manchas de óleo mais lisas); tile 9 → 11 m e variação macro por posição de mundo.
- **Pedra portuguesa**: calcário mais claro e creme, juntas de areia/terra mais claras, normal 3,5 → 2,2,
  rugosidade 0,66–0,82 (pedra polida pelo uso). Ondas preto-e-branco continuam nas praças.
- **Meio-fio**: granito cinza salpicado (biotita/quartzo/feldspato) com sujeira, rugosidade ~0,62 (antes concreto).
- **Sinalização (MBST Vol. IV)**: linha de divisão 0,12 m, tracejado 3 m / 6 m (1:2; antes 3/5); zebrada com
  faixas de 0,40 m e espaçamento de 0,60 m (antes 0,45/0,50); tinta mais fosca (rugosidade 0,70) e levemente
  encardida, desgaste por alpha mantido.
- Canteiros: mantidos (grama/pedra portuguesa dos dados); nenhuma geografia inventada.

## 4. Presets

| Preset | O que muda nesta área |
|---|---|
| LOW | mesmo céu/IBL/paleta; fachada sem parallax, relevo e brise (`uDetail = 0`); sem sombras (como antes) |
| MEDIUM | fachada completa; sombras 2048² |
| HIGH | + GTAO + SMAA (como antes) |
| ULTRA | idem HIGH, LOD próximo mais distante → mais marquises/platibandas/caixas d'água visíveis |

`settings.ts` não foi alterado; o nível ativo chega aos materiais por `src/renderer/quality.ts` (definido pelo
`GameRenderer`), sem tocar no `Game.ts`.

## 5. Medições

Ambiente: M5 Pro, Chrome headless 1600×900 com vsync, `tools/qa/fidelity_shots.mjs` (7 poses A–G, média de
6 amostras por pose), 10:30. "Antes" = commit `15566d0` servido em paralelo (porta 5185); antes/depois rodados
**intercalados** para reduzir o viés. A GPU estava compartilhada com outros processos: o tempo de GPU oscila
±2 ms entre execuções idênticas (ex.: HIGH "antes" mediu 5,5 ms numa rodada e 7,1 ms na outra).

| Preset | Versão | CPU ms | GPU ms média (máx) | Draw calls | Triângulos média (máx) | Texturas | Erros |
|---|---|---|---|---|---|---|---|
| LOW | antes | 1,25 | 3,47 (4,5) | 209 | 0,27 M (0,35 M) | 53 | 0 |
| LOW | depois | 1,00 | 2,16 (4,3) | 209 | 0,33 M (0,43 M) | 54 | 0 |
| MEDIUM | antes | 1,52 | 1,67 (1,9) | 282 | 0,55 M (0,63 M) | 72 | 0 |
| MEDIUM | depois | 1,53 | 2,56 (3,5) | 284 | 0,65 M (0,76 M) | 73 | 0 |
| HIGH | antes | 2,94 | 7,10 (9,1) | 632 | 1,49 M (1,58 M) | 108 | 0 |
| HIGH | depois | 2,89 | 7,79 (9,3) | 633 | 1,75 M (2,00 M) | 109 | 0 |
| ULTRA | antes | 3,84 | 9,79 (14,3) | 717 | 1,85 M (2,01 M) | 142 | 0 |
| ULTRA | depois | 3,34 | 8,48 (11,8) | 715 | 2,18 M (2,47 M) | 143 | 0 |

Rodada anterior (mesmo método): HIGH 5,51 → 7,41 ms GPU; MEDIUM 3,36 → 4,37; ULTRA 7,38 → 8,59; LOW 1,74 → 2,06.
Leitura honesta: **draw calls inalterados** (mesmo material único), **+15–25% de triângulos** (platibandas,
marquises, caixas d'água — também entram no passe de sombra) e **≈ +0,7 a +1,9 ms de GPU no HIGH** pelo shader de
fachada mais pesado. Todos os presets seguem bem abaixo de 16,7 ms. Horários no HIGH (GPU média das 7 poses,
depois): dia 9,7 ms, crepúsculo 11,7 ms, noite 6,8 ms (mesma ordem de grandeza do "antes": 8,8/10,4/12,4 ms).

**Download**: 0 byte de assets novos. Código: chunk `Game` 267,5 → 295,6 KB (gzip 109,3 → 118,9 KB, **+9,6 KB gzip**).
Uma textura nova em memória (atlas de letreiros 512×1024, gerado em canvas).

**Capturas** (antes/depois, mesmas poses): `docs/screenshots/r5_visual/antes/` e `docs/screenshots/r5_visual/depois/`
(dia B/D/F, crepúsculo 18:10 C, noite 22:30 G, close-ups `pa` (torres do PA e lojas), `saara` (sobrados), `aereo`
(telhados), `lojas`, e LOW/ULTRA G). Conjunto completo (não versionado): `screenshots/bg_before_*`,
`screenshots/bg_after_*`.

## 6. Problemas conhecidos / próximos passos

- **Árvores, veículos, personagens e mobiliário** (fora desta área) continuam low-poly e agora destoam mais das
  fachadas; são o maior contraste restante num screenshot.
- Fachadas ainda são 100% shader: não há recuos volumétricos de varandas/sacadas reais, nem escalonamento de
  coroamento; o parallax engana bem a 10–100 m, mas de perto num ângulo rasante o vão é "pintado".
- Estilo/material por prédio é sorteado pela semente (o OSM quase não tem `building:material`/cores): a avenida
  fica plausível, mas prédios específicos não têm a fachada real (ex.: torres de vidro escuro vs. reboco).
- Interiores das lojas (mercadorias) ainda parecem blocos coloridos de perto; letreiros usam só 16 palavras.
- Pedra portuguesa: de muito perto as juntas formam um mosaico um pouco regular demais; não há os desenhos
  pretos característicos nas calçadas (só ondas nas praças) — exigiria dado de onde eles existem.
- Faltam as áreas amarelas quadriculadas de cruzamento ("box"), setas no chão e faixas exclusivas de ônibus — é dado
  de pipeline (`build_world.ts`), não regenerado nesta rodada.
- Sombra do sol nos vãos/brises não sabe se a fachada está na sombra de outro prédio (só testa N·L).
- No LOW, sem sombras, personagens parecem "flutuar" (não há blob shadow; área de personagens).
- Medições de GPU ruidosas (GPU compartilhada): repetir `bench_presets.mjs` numa máquina dedicada e em GPU integrada.
