# Licenças de assets e dependências

## Assets visuais

Desde a rodada 5 o projeto inclui **assets externos com licença compatível com uso comercial** (CC0 ou CC-BY).
Regra: nenhum asset entra sem origem, autor, licença e URL registrados aqui. CC-BY exige crédito visível:
ver `public/CREDITS.txt` (servido junto com o jogo) e a seção abaixo.

### Personagens humanos (`public/characters/*.glb`) — rodada 5
Gerados por `tools/character/build_character.py` (Blender 5.2 + extensão **MPFB2**, GPL-3 — só a ferramenta;
os modelos gerados seguem a licença dos assets usados) a partir dos pacotes da **MakeHuman Community**
(https://static.makehumancommunity.org/assets/assetpacks.html). Corpo, rig "game_engine", olhos, sobrancelhas,
cílios e peles do pacote de sistema são **CC0**.

| Asset | Autor | Licença | Pacote | Origem | Usado em |
|---|---|---|---|---|---|
| `bob02` | makehuman_system | CC0 | makehuman_system_assets | http://www.makehumancommunity.org | idosa |
| `toigo_basic_tucked_t-shirt` | MargaretToigo | CC0 | shirts01 | http://www.makehumancommunity.org | homem |
| `elvs_male_trouser` | Elvaerwyn | CC-BY | pants02 | http://www.makehumancommunity.org/node/1796 | idoso |
| `elvs_sling_purse1` | Elvaerwyn | CC-BY | equipment03 | http://www.makehumancommunity.org/node/1459 | homem, idosa, idoso, mulher |
| `eyebrow001` | makehuman_system | CC0 | makehuman_system_assets | http://www.makehumancommunity.org | homem, idosa, idoso, mulher |
| `eyelashes01` | makehuman_system | CC0 | makehuman_system_assets | http://www.makehumancommunity.org | homem, idosa, idoso, mulher |
| `fedora01` | makehuman_system | CC0 | makehuman_system_assets | http://www.makehumancommunity.org | homem, idosa, idoso, mulher |
| `joepal_crude_t-shirt_female` | Joel Palmius | CC0 | shirts01 | http://www.makehumancommunity.org/node/894 | idosa, mulher |
| `low-poly` | makehuman_system | CC0 | makehuman_system_assets | http://www.makehumancommunity.org | homem, idosa, idoso, mulher |
| `mindfront_female_trousers_1` | Mindfront | CC-BY | pants02 | http://www.makehumancommunity.org/node/790 | idosa |
| `mindfront_patrol_cap` | Mindfront | CC-BY | hats03 | http://www.makehumancommunity.org/node/841 | homem, idosa, idoso, mulher |
| `mindfront_shoes_oxford_male` | Mindfront | CC-BY | shoes02 | http://www.makehumancommunity.org/node/620 | idoso |
| `namuhekam_male_polo_shirt` | namuhekam | CC0 | shirts01 | http://www.makehumancommunity.org/node/2909 | idoso |
| `old_caucasian_female` | makehuman_system | CC0 | makehuman_system_assets | http://www.makehumancommunity.org | idosa |
| `old_caucasian_male` | makehuman_system | CC0 | makehuman_system_assets | http://www.makehumancommunity.org | idoso |
| `ponytail01` | makehuman_system | CC0 | makehuman_system_assets | http://www.makehumancommunity.org | mulher |
| `punkduck_comfortable_sneakers` | punkduck | CC-BY | shoes02 | http://www.makehumancommunity.org/node/438 | mulher |
| `punkduck_female_tight_jeans` | punkduck | CC-BY | pants02 | http://www.makehumancommunity.org/node/391 | mulher |
| `punkduck_male_classic_jeans` | punkduck | CC-BY | pants02 | http://www.makehumancommunity.org/node/1655 | homem |
| `punkduck_running_shoes_01` | punkduck | CC-BY | shoes02 | http://www.makehumancommunity.org/node/570 | homem |
| `punkduck_shopping_bag01` | punkduck | CC-BY | equipment03 | http://www.makehumancommunity.org/node/967 | homem, idosa, idoso, mulher |
| `short01` (+ base clara derivada por `tools/character/make_light_hair.py`) | makehuman_system | CC0 | makehuman_system_assets | http://www.makehumancommunity.org | homem, idoso |
| `spamrakuen_sagerfrogs_glasses_01` | spamrakuen | CC0 | glasses01 | http://www.makehumancommunity.org/node/3331 | homem, idosa, idoso, mulher |
| `toigo_flats` | MargaretToigo | CC0 | shoes01 | http://www.makehumancommunity.org/node/1117 | idosa |
| `young_caucasian_female` | makehuman_system | CC0 | makehuman_system_assets | http://www.makehumancommunity.org | mulher |
| `young_caucasian_male` | makehuman_system | CC0 | makehuman_system_assets | http://www.makehumancommunity.org | homem |
| `bogdan666_short_02_gray` (textura de cabelo) | bogdan666 | CC0 | system_hair_materials01 | http://www.makehumancommunity.org/node/1941 | homem, idoso |
| `dariush086_ponytail01_platinum` (textura de cabelo) | dariush086 | CC0 | system_hair_materials01 | http://www.makehumancommunity.org/node/2680 | mulher |

**Animações** (`public/characters/anims.glb`): *Universal Animation Library [Standard]*, **Quaternius**, **CC0**
(https://quaternius.com/packs/universalanimationlibrary.html · https://opengameart.org/node/174563),
retargetadas para o rig do MakeHuman por `tools/character/retarget.py`.

#### Peças variantes (rodada 7 — `public/characters/<corpo>-<camada>-<estilo>[_lod1].glb`)
Mesmo pipeline (configs `tools/character/variants/*.json`, campo `"variants"`). Licença conferida no PRÓPRIO `.mhclo`
e no `.mhmat` de cada peça (não só no rótulo do pacote). Alterações (indicadas conforme CC BY): ajuste ao corpo pelo
MPFB, decimação (LOD1), textura das roupas convertida para base neutra em tons de cinza (tingida no jogo), texturas de
cabelo clareadas por `tools/character/make_light_hair.py`.

| Asset | Autor | Licença | Pacote | Origem | Usado em (estilo) |
|---|---|---|---|---|---|
| `elvs_male_shirt_untucked_bd1` | Elvaerwyn | CC-BY | shirts02 | http://www.makehumancommunity.org/node/1800 | homem, idoso (camisa) |
| `punkduck_lace_up_blouse` | punkduck | CC BY 4.0 | shirts02 | http://www.makehumancommunity.org/node/1775 | mulher, idosa (camisa/blusa) |
| `toigo_camisole_top` | MargaretToigo | CC0 | shirts01 | http://www.makehumancommunity.org/node/1726 | mulher, idosa (regata) |
| regata derivada de `toigo_basic_tucked_t-shirt` (mangas cortadas no build) | MargaretToigo | CC0 | shirts01 | http://www.makehumancommunity.org | homem (regata) |
| `toigo_basic_tucked_t-shirt` | MargaretToigo | CC0 | shirts01 | http://www.makehumancommunity.org | idoso (camiseta) |
| `namuhekam_male_polo_shirt` | namuhekam | CC0 | shirts01 | http://www.makehumancommunity.org/node/2909 | homem (polo) |
| `elvs_male_trouser_short_2` | Elvaerwyn | CC-BY | pants03 | http://www.makehumancommunity.org/node/1806 | homem, idoso (bermuda) |
| `punkduck_female_short_jeans` | punkduck | CC BY 4.0 | pants03 | http://www.makehumancommunity.org/node/392 | mulher, idosa (bermuda/short) |
| `elvs_male_trouser` | Elvaerwyn | CC-BY | pants02 | http://www.makehumancommunity.org/node/1796 | homem (calça social) |
| `mindfront_female_trousers_1` | Mindfront | CC BY 4.0 | pants02 | http://www.makehumancommunity.org/node/790 | mulher (calça social) |
| `punkduck_male_classic_jeans` | punkduck | CC BY 4.0 | pants02 | http://www.makehumancommunity.org/node/1655 | idoso (jeans) |
| `punkduck_female_tight_jeans` | punkduck | CC BY 3.0 | pants02 | http://www.makehumancommunity.org/node/391 | idosa (jeans) |
| `elvs_male_flip_flop_sandals1` | Elvaerwyn | CC-BY | shoes02 | http://www.makehumancommunity.org/node/1453 | todos (chinelo) |
| `mindfront_shoes_oxford_male` | Mindfront | CC BY 4.0 | shoes02 | http://www.makehumancommunity.org/node/620 | homem (sapato) |
| `toigo_flats` | MargaretToigo | CC0 | shoes01 | http://www.makehumancommunity.org/node/1117 | mulher (sapatilha) |
| `punkduck_running_shoes_01` | punkduck | CC BY 3.0 | shoes02 | http://www.makehumancommunity.org/node/570 | idoso (tênis) |
| `punkduck_comfortable_sneakers` | punkduck | CC BY 3.0 | shoes02 | http://www.makehumancommunity.org/node/438 | idosa (tênis) |
| `afro01` (+ base clara) | makehuman_system | CC0 | makehuman_system_assets | http://www.makehumancommunity.org | homem, mulher (crespo) |
| `short02` (+ base clara) | makehuman_system | CC0 | makehuman_system_assets | http://www.makehumancommunity.org | homem (curto 2) |
| `bob01` (+ base clara) | makehuman_system | CC0 | makehuman_system_assets | http://www.makehumancommunity.org | mulher (chanel) |
| `long01` (+ base clara) | makehuman_system | CC0 | makehuman_system_assets | http://www.makehumancommunity.org | mulher (longo) |
| `short04` (+ base clara) | makehuman_system | CC0 | makehuman_system_assets | http://www.makehumancommunity.org | idosa (curto) |

Avaliados e NÃO usados (rodada 7): `ews_striped_shirt`, `dressupdoc_*`, `callharvey3d_*`, `skalldyrssuppe_tube_top_*`,
`culturalibre_hair_01/02`, `littleright_bobcut_hair`, `elvs_witchy_lil_bob` e outros que declaram **AGPL-3** no
arquivo; `punkduck_diver_scuba_rig` (CC-BY-NC-SA, não comercial); `toigo_maga_hat` (político); `punkduck_deathnote_t-shirt`
(estampa de obra de terceiros). **Barba:** nenhum pacote disponível (shirts/pants/shoes/hats/hair/eyebrows/equipment,
system assets) traz barba ou bigode com licença compatível — não incluída. Camisas de futebol: **nenhuma textura** —
padrões e cores calculados no shader a partir de `src/social/designs.ts` (sem escudos, marcas, textos ou uniformes).

Rejeitados por licença: `kwnet_at_optical_glasses` e `frankyaye_glasses_library_male` (o arquivo declara AGPL-3,
apesar de estarem num pacote rotulado CC0) e `toigo_maga_hat` (conteúdo político, fora do escopo).

### Gerados por código (procedurais, deste projeto)

| Asset | Origem | Uso |
|---|---|---|
| Texturas de asfalto, pedra portuguesa, concreto, grama, brita, dormentes, desgaste de pintura | `src/renderer/textures.ts` | chão |
| Fachadas dos edifícios | shader `src/world/builders/buildings.ts` | edifícios |
| Central do Brasil, Candelária, Palácio Duque de Caxias | `src/world/landmarks/*` (+ footprint OSM) | landmarks |
| Personagem procedural antigo | `src/characters/CharacterMesh.ts` | **apenas reserva** (falha de carregamento, `?avatar=classic`) |
| Emotes, danças, poses de carregar/usar itens (39 clipes: `emote_*`, `prop_*`, `carry_*`, `dance_simple/lively/arms/party`) | procedural, deste projeto — `src/characters/human/proceduralClips.ts` (funções de pose sobre o idle + IK, amostradas em quatérnios; nenhum dado de captura, de outro jogo ou do Mixamo; danças genéricas, sem coreografia de terceiros) | ações sociais da rodada 7 (`docs/EMOTES.md`) |
| Clipes de confronto (rodada 9: `cbt_punch`, `cbt_punch2`, `cbt_kick`, `cbt_kick_final`, `cbt_dodge`, `cbt_bat`, `cbt_bar`, `cbt_spray`, `cbt_stagger`) | procedural, deste projeto — `src/characters/human/proceduralClips.ts` (mesmo método dos emotes; estilo arcade, sem captura de movimento). Impulso/pouso do pulo e empurrão: clipes `jump_start`/`jump_land`/`push` já existentes em `public/characters/anims.glb` | confronto e pulo (`docs/COMBAT.md`) |
| Boneco de treino (poste, corpo de lona, braços em T, cabeça lisa) | geometria/materiais three.js deste projeto — `src/combat/DummyVisual.ts` | área de treino de confronto |
| Mostrador do relógio, ícone | canvas/SVG | UI e landmark |
| Itens da manifestação (mastros, bandeiras, cartazes, faixa, megafone, apito, guarda-chuva, surdo, taco), bandeiras de cenário, textura de desgaste | `src/social/props/*` (geometria e canvas deste projeto; artes via `designPainter.ts`) | itens na mão, multidão, palco/avenida |
| Grafites (traços, símbolos coração/estrela/seta/paz/círculo/sol), textura do tapume | canvas/Path2D em `src/graffiti/raster.ts` e `GraffitiRenderer.ts` — sem arquivo de asset; texto com as fontes do sistema | pichação (rodada 7) |
| Carro de som, trio elétrico, caminhões de campanha, telão de treliça, palco (rodada 7) | `src/vehicles/eventModels.ts` (caixas/cilindros por código, cores por vértice; modelos originais, sem referência copiada) | veículos e cenário de evento |
| Grade de alto-falante, conteúdo dos telões (equalizador, letreiro, cartão de hora/pessoas) | canvas em `src/vehicles/eventModels.ts` e `src/events/screenFeed.ts` | painéis e telões |
| Artes de painéis (designs neutros e de campanha) | `src/social/designPainter.ts` a partir de DADOS (`public/designs/campaigns.json`): só nome/número/sigla/cores, marca "SIMULAÇÃO", sem logotipos ou fotos | caminhões, trio, carro de som, palco, telões |

Veículos, vegetação, mobiliário, materiais de prédios/chão e landmarks da rodada 5: ver as seções acrescentadas
pelas respectivas passadas (`docs/licenses/*.md`).

## Dependências de software

| Pacote | Uso | Licença |
|---|---|---|
| three (0.170) | renderização WebGL2, addons Sky, GTAO, SMAA, EffectComposer, BufferGeometryUtils | MIT |
| vite | dev server e bundler | MIT |
| typescript | linguagem | Apache-2.0 |
| vitest | testes | MIT |
| tsx | executar o pipeline em TS | MIT |
| clipper-lib (6.4.2) | operações booleanas e offset de polígonos (só no build) | Boost Software License 1.0 |
| puppeteer-core | QA: screenshots e testes de fumaça (dev) | Apache-2.0 |
| @gltf-transform/cli (4.2.1, via npx no build de assets) | compressão meshopt dos GLBs | MIT |
| meshopt_decoder (incluído no three) | decodificar geometria comprimida | MIT |

## Dados

Dados do mapa © OpenStreetMap contributors, **ODbL 1.0**. Os arquivos em `public/world/` são um
"Produced Work"/"Derivative Database" do OSM: precisam manter a atribuição e, se redistribuídos como
banco de dados, a mesma licença. Detalhes em [DATA_SOURCES.md](DATA_SOURCES.md).

## Texturas CC0 dos landmarks (rodada 5)

Os landmarks usam três texturas de detalhe CC0 da Poly Haven (reboco, concreto, granito) em
`public/landmarks/tex/`. Fonte, autores e URLs: [`docs/licenses/landmarks.md`](licenses/landmarks.md).
