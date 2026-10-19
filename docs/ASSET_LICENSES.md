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

- **Rodada 10 — camisas, bandeiras e faixas das torcidas** (designs 212–223, `src/social/designs.ts`): geradas por código
  (padrão no shader `garmentShader.ts`; bandeiras/faixas em canvas por `designPainter.ts`). Só combinações de cores e
  padrões; nenhum escudo, cruz, monograma, estrela, marca de fabricante, patrocinador, selo, número ou textura oficial.
  As fotos de referência fornecidas pelo dono NÃO estão no repositório (contêm marcas) — inventário descritivo em
  `docs/SUPPORTER_GROUPS.md`.

| Asset | Origem | Uso |
|---|---|---|
| Texturas de asfalto, pedra portuguesa, concreto, grama, brita, dormentes, desgaste de pintura | `src/renderer/textures.ts` | chão |
| Fachadas dos edifícios | shader `src/world/builders/buildings.ts` | edifícios |
| Central do Brasil, Candelária, Palácio Duque de Caxias | `src/world/landmarks/*` (+ footprint OSM) | landmarks |
| Personagem procedural antigo | `src/characters/CharacterMesh.ts` | **apenas reserva** (falha de carregamento, `?avatar=classic`) |
| Emotes, danças, poses de carregar/usar itens (39 clipes: `emote_*`, `prop_*`, `carry_*`, `dance_simple/lively/arms/party`) | procedural, deste projeto — `src/characters/human/proceduralClips.ts` (funções de pose sobre o idle + IK, amostradas em quatérnios; nenhum dado de captura, de outro jogo ou do Mixamo; danças genéricas, sem coreografia de terceiros) | ações sociais da rodada 7 (`docs/EMOTES.md`) |
| Clipes de confronto (rodada 9: `cbt_punch`, `cbt_punch2`, `cbt_kick`, `cbt_kick_final`, `cbt_dodge`, `cbt_bat`, `cbt_bar`, `cbt_spray`) | procedural, deste projeto — `src/characters/human/proceduralClips.ts` (mesmo método dos emotes; estilo arcade, sem captura de movimento). Impulso/pouso do pulo e empurrão: clipes `jump_start`/`jump_land`/`push` já existentes em `public/characters/anims.glb` | confronto e pulo (`docs/COMBAT.md`) |
| Boneco de treino (poste, corpo de lona, braços em T, cabeça lisa) | geometria/materiais three.js deste projeto — `src/combat/DummyVisual.ts` | área de treino de confronto |
| Mostrador do relógio, ícone | canvas/SVG | UI e landmark |
| Itens da manifestação (mastros, bandeiras, cartazes, faixa, megafone, apito, guarda-chuva, surdo, taco), bandeiras de cenário, textura de desgaste | `src/social/props/*` (geometria e canvas deste projeto; artes via `designPainter.ts`) | itens na mão, multidão, palco/avenida |
| Itens de confronto da rodada 9: taco, barra de ferro (tubo genérico com empunhadura), spray (lata GENÉRICA laranja, sem marca/rótulo/texto) | procedural, deste projeto — `src/social/props/propGeometry.ts` (`bat`, `bar`, `spray`: lathe/cilindros/caixas, cor e PBR por vértice) | itens na mão e no chão/apoio |
| Estrado dos pontos de apoio, anel do item no chão | procedural — `src/items/GroundItemsView.ts` (caixas e anel por código) | itens no mundo (rodada 9) |
| Clipes de confronto e estados (`stagger`, `disoriented`, `carry_bar`, `carry_spray`) | procedural, deste projeto — `src/characters/human/proceduralClips.ts` (mesmo método dos emotes; sem captura de movimento, sem dados de outro jogo) | rodada 9 |
| Brilho de proteção (casca translúcida) e véu de desorientação (CSS: desfoque/dessaturação/vinheta), ícone "olho" | shader e SVG/CSS deste projeto — `src/combat/fxVisuals.ts`, `src/ui/style.css` | efeitos de estado (rodada 9) |
| Grafites (traços, símbolos coração/estrela/seta/paz/círculo/sol), textura do tapume | canvas/Path2D em `src/graffiti/raster.ts` e `GraffitiRenderer.ts` — sem arquivo de asset; texto com as fontes do sistema | pichação (rodada 7) |
| Carro de som, trio elétrico, caminhões de campanha, telão de treliça, palco (rodada 7) | `src/vehicles/eventModels.ts` (caixas/cilindros por código, cores por vértice; modelos originais, sem referência copiada) | veículos e cenário de evento |
| Grade de alto-falante, conteúdo dos telões (equalizador, letreiro, cartão de hora/pessoas) | canvas em `src/vehicles/eventModels.ts` e `src/events/screenFeed.ts` | painéis e telões |
| Artes de painéis (designs neutros e de campanha) | `src/social/designPainter.ts` a partir de DADOS (`public/designs/campaigns.json`): só nome/número/sigla/cores, marca "SIMULAÇÃO", sem logotipos ou fotos | caminhões, trio, carro de som, palco, telões |

Veículos, vegetação, mobiliário, materiais de prédios/chão e landmarks da rodada 5: ver as seções acrescentadas
pelas respectivas passadas (`docs/licenses/*.md`).

## Áudio (rodada 10)

**Todo som do jogo é gerado por código neste projeto** (licença do projeto). Não há arquivo de áudio no repositório
nem baixado em tempo de execução: nenhuma gravação, amostra, banco de sons, música comercial, canto/música de torcida
ou discurso real. As receitas ficam em `src/audio/sounds.ts` (primitivas em `src/audio/dsp.ts`: ruído
branco/rosa/marrom, osciladores, filtros biquad, envelopes, formantes de vogais genéricas) e são sintetizadas uma vez
no navegador (Worker `src/audio/synth.worker.ts`). `npx tsx tools/audio/render_sounds.ts` exporta tudo em WAV para
ouvir (saída em `screenshots/tmp/audio/`, fora do versionamento).

| Som (chave) | Gerador (`src/audio/sounds.ts`) | Origem | Licença | Uso |
|---|---|---|---|---|
| `step_asphalt`, `step_sidewalk`, `step_grass` | ruído filtrado + baque grave curto | gerado por código no projeto | do projeto | passos (superfície do CollisionWorld) |
| `jump`, `land`, `fall`, `getup`, `push` | sopro de ruído com banda varrida, baques senoidais, "roupa" (ruído em banda) | gerado por código no projeto | do projeto | corpo do jogador/remotos |
| `punch`, `kick`, `impact`, `whoosh`, `dodge`, `bat`, `bar`, `spray`, `blocked` | "pum" senoidal/quadrado que desliza + estalo; "tok" ressonante (taco); parciais inarmônicos curtos (barra); chiado (spray); bipe duplo (bloqueado) — estética arcade, sem som de ferimento | gerado por código no projeto | do projeto | confronto |
| `pickup`, `drop`, `ui_click`, `ui_open`, `ui_close`, `ui_denied`, `ui_ok` | bipes/notas curtas (triângulo/quadrada/seno) | gerado por código no projeto | do projeto | itens e interface |
| `veh_door`, `veh_mount`, `veh_brake`, `bike_brake`, `veh_horn`, `bike_bell` | baque + trinco; cliques metálicos; chiado tonal de freio; duas notas quadradas (buzina genérica); parciais de sino | gerado por código no projeto | do projeto | veículos |
| `car_engine`, `moto_engine`, `scooter_motor`, `bike_roll` (laços de 1 s) | trem de pulsos harmônicos na frequência de ignição + ruído (carro/moto); zumbido harmônico (motor elétrico); ruído de rolagem + cliques da catraca (bicicleta) | gerado por código no projeto | do projeto | motor/rolagem (taxa pela velocidade) |
| `trio_music`, `soundcar_music` (laços de 4 compassos) | batida PRÓPRIA procedural: bumbo, palma, chimbal, baixo (progressão fixa de graus) e acordes curtos/arpejo — composição gerada, sem melodia de terceiros | gerado por código no projeto | do projeto | trio elétrico e carro de som (espacial) |
| `crowd_bed` | 14 "vozes" sintéticas (pulso glotal + 3 formantes de vogais aleatórias, sem palavras) + ruído rosa | gerado por código no projeto | do projeto | murmúrio das células de multidão |
| `layer:<perfil>` (ex. `layer:manifestacao`, `layer:torcida_a`) | percussão própria (surdo senoidal, caixa de ruído, repique, palmas) com andamento/acentos tirados do HASH da chave do perfil — nenhum ritmo/canto de torcida real | gerado por código no projeto | do projeto | camada rítmica das células (perfil de `supporters.json` / evento) |
| `whistle`, `clap`, `cheer`, `shout`, `surdo`, `megaphone` | apito (seno com trilo), rajadas de palmas, "êêê/ôôô" de vozes sintéticas numa vogal, golpe de surdo; megafone = fala sintética ININTELIGÍVEL (vogais aleatórias) em banda estreita com saturação — nunca discurso | gerado por código no projeto | do projeto | reações pontuais da multidão |
| `amb_wind`, `amb_city` (laços de 12 s) | ruído rosa/marrom filtrado com modulação periódica; murmúrio distante e baques abafados | gerado por código no projeto | do projeto | ambiente da Pres. Vargas |
| `ir` | ruído decaindo com passa-baixa variável (resposta ao impulso) | gerado por código no projeto | do projeto | reverberação simples (ConvolverNode) |

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

## Rodada 11 — interface desktop, inventário e editor

Nenhum asset de terceiros novo. Ícones do inventário e do acesso rápido (`src/inventory/icons.ts`), do menu do jogo,
da tela de controles e das abas do editor/ajustes são SVG de traço **escritos no projeto** (licença do projeto), no
mesmo estilo dos ícones da barra de ações. A prévia 3D reutiliza os personagens e peças já listados acima; nenhuma
fonte, imagem ou som novo foi baixado.
