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
| `elvs_crude_t-shirt_male` | Elvaerwyn | CC0 | shirts01 | http://www.makehumancommunity.org/node/1416 | homem |
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
| `short02` | makehuman_system | CC0 | makehuman_system_assets | http://www.makehumancommunity.org | homem, idoso |
| `spamrakuen_sagerfrogs_glasses_01` | spamrakuen | CC0 | glasses01 | http://www.makehumancommunity.org/node/3331 | homem, idosa, idoso, mulher |
| `toigo_flats` | MargaretToigo | CC0 | shoes01 | http://www.makehumancommunity.org/node/1117 | idosa |
| `young_caucasian_female` | makehuman_system | CC0 | makehuman_system_assets | http://www.makehumancommunity.org | mulher |
| `young_caucasian_male` | makehuman_system | CC0 | makehuman_system_assets | http://www.makehumancommunity.org | homem |
| `bogdan666_short_02_gray` (textura de cabelo) | bogdan666 | CC0 | system_hair_materials01 | http://www.makehumancommunity.org/node/1941 | homem, idoso |
| `dariush086_ponytail01_platinum` (textura de cabelo) | dariush086 | CC0 | system_hair_materials01 | http://www.makehumancommunity.org/node/2680 | mulher |

**Animações** (`public/characters/anims.glb`): *Universal Animation Library [Standard]*, **Quaternius**, **CC0**
(https://quaternius.com/packs/universalanimationlibrary.html · https://opengameart.org/node/174563),
retargetadas para o rig do MakeHuman por `tools/character/retarget.py`.

Rejeitados por licença: `kwnet_at_optical_glasses` e `frankyaye_glasses_library_male` (o arquivo declara AGPL-3,
apesar de estarem num pacote rotulado CC0) e `toigo_maga_hat` (conteúdo político, fora do escopo).

### Gerados por código (procedurais, deste projeto)

| Asset | Origem | Uso |
|---|---|---|
| Texturas de asfalto, pedra portuguesa, concreto, grama, brita, dormentes, desgaste de pintura | `src/renderer/textures.ts` | chão |
| Fachadas dos edifícios | shader `src/world/builders/buildings.ts` | edifícios |
| Central do Brasil, Candelária, Palácio Duque de Caxias | `src/world/landmarks/*` (+ footprint OSM) | landmarks |
| Personagem procedural antigo | `src/characters/CharacterMesh.ts` | **apenas reserva** (falha de carregamento, `?avatar=classic`) |
| Mostrador do relógio, ícone | canvas/SVG | UI e landmark |

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
