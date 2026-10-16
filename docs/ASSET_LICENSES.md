# Licenças de assets e dependências

## Assets visuais

**Nenhum asset externo (modelo, textura, áudio, fonte) está incluído no projeto.** Tudo o que aparece
na tela é gerado por código original deste repositório:

| Asset | Origem | Autor | Licença | Uso |
|---|---|---|---|---|
| Texturas de asfalto, pedra portuguesa, concreto, grama, brita, dormentes, desgaste de pintura | `src/renderer/textures.ts` (procedural, runtime) | este projeto | mesma do projeto | chão |
| Fachadas dos edifícios | shader procedural `src/world/builders/buildings.ts` | este projeto | idem | edifícios |
| Central do Brasil | `src/world/landmarks/central.ts` (procedural + footprint OSM) | este projeto | idem (dados OSM: ODbL) | landmark |
| Igreja da Candelária | `src/world/landmarks/candelaria.ts` (procedural + footprint OSM) | este projeto | idem | landmark |
| Árvores, postes, semáforos, bancos, abrigos, lixeiras, bancas | `src/world/builders/props.ts` | este projeto | idem | mobiliário |
| Personagens (homem, mulher, idoso, idosa) | `src/characters/` (SkinnedMesh procedural + animação procedural) | este projeto | idem | jogador e NPCs |
| Veículos (carro, táxi, ônibus) | `src/traffic/TrafficSystem.ts` (procedural) | este projeto | idem | trânsito; cores genéricas, sem marcas reais |
| Mostrador do relógio | canvas 2D em `central.ts` | este projeto | idem | landmark |
| Ícone (favicon) | SVG inline em `index.html` | este projeto | idem | UI |

### Substituição futura do avatar

O avatar é um **placeholder** articulado com animação procedural (idle/walk/run/pulo). Ele deve ser
trocado por um personagem rigado em GLB. Candidatos com licença compatível, a verificar na hora:
pacotes CC0 de Quaternius ou Kenney, ou personagem próprio feito no Blender. Para trocar, basta uma
nova implementação de `AvatarVisual` que leia o mesmo `PlayerState` (nada mais muda).

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

## Dados

Dados do mapa © OpenStreetMap contributors, **ODbL 1.0**. Os arquivos em `public/world/` são um
"Produced Work"/"Derivative Database" do OSM: precisam manter a atribuição e, se redistribuídos como
banco de dados, a mesma licença. Detalhes em [DATA_SOURCES.md](DATA_SOURCES.md).
