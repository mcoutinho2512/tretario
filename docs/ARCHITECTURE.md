# Arquitetura

## Visão geral

```
                 BUILD TIME (Node / tsx)                                  RUNTIME (navegador)
OSM Overpass ─► tools/fetch_map_data ─► data/raw/*.json.gz
                tools/process_osm    ─► data/processed/features.json (local, metros)
                tools/build_world    ─► public/world/manifest.json + chunk_X_Z.<hash>.json
                                                   │
index.html + main.ts (4 KB) ── tela inicial ───────┤  import() sob demanda
                                                   ▼
                                     core/Game ─── renderer/ (WebGL2, Environment: sol real, céu, nuvens, IBL)
                                       │      ├── world/ChunkManager (streaming + LOD) ── builders/ (chão, edifícios, props)
                                       │      ├── world/landmarks/ (Central, Candelária)
                                       │      ├── physics/CollisionWorld (segmentos + mapa de alturas)
                                       │      ├── player/ (State · Controller · AvatarVisual)
                                       │      ├── camera/ThirdPersonCamera · input/InputManager · ui/TouchControls
                                       │      └── debug/ (DebugPanel F3, Minimap, pontos de validação)
```

## Sistema de coordenadas (`src/geo/projection.ts`)

- WGS84 → ECEF → **ENU** tangente à origem: **lat −22.9025, lon −43.1850** (canteiro da Pres. Vargas,
  entre a Central e a Candelária). Essa constante não deve mudar sem migrar os dados.
- Three.js: **x = leste, y = cima, z = sul (−norte)**, **1 unidade = 1 metro**.
- `GeoProjection.toWorld(lat, lon)` e `toLatLon(x, z)`: ida e volta com erro < 1 mm (testado).
- Terreno plano (y = 0 é o nível da pista). O Centro é quase plano no corredor; os morros (Providência,
  São Bento, Conceição) ainda não têm relevo (ver STATUS).

Uso futuro: posição de jogadores (multiplayer), GPS → mundo, eventos e manifestações com coordenadas reais, distâncias.

## Mundo e chunks (`src/world`)

- Grade de chunks de **250 m** alinhada à origem. Chave `cx_cz`. 70 chunks no MVP.
- Cada chunk traz: edifícios (footprint, altura, classe A/B/C/D, estilo de fachada, flags),
  superfícies pré-calculadas (asfalto, calçada, praça, gramado, plataforma, brita, água, meio-fios),
  sinalização (tracejadas, contínuas, travessias), props (árvores, postes, semáforos…) e linhas (trilhos, VLT, gradis).
- `ChunkManager`: baixa os chunks em ordem de distância (6 conexões), constrói malhas com
  **orçamento por frame** (~5 ms) e aplica LOD com histerese:
  - **FULL**: edifícios com volumes de cobertura, chão detalhado, sinalização, mobiliário e trilhos
  - **MEDIUM**: edifícios e chão, árvores simplificadas
  - **FAR**: só silhuetas (edifícios ≥ 12 m) e chão
  - fora do alcance: oculto, com geometria liberada
- Para ampliar o Rio basta gerar mais chunks: o cliente só carrega os que estão no alcance do LOD.

### Classes de edifícios

| Classe | Critério | Tratamento |
|---|---|---|
| A | landmarks (Central, Candelária) | modelo dedicado |
| B | nomeados/históricos ou ≥ 40 m, a < 160 m do eixo da Pres. Vargas | fachada procedural completa, galerias |
| C | demais edifícios urbanos | fachada procedural modular |
| D | pequenos (< 50 m²), baixos (< 4 m) ou distantes (> 520 m do eixo) | sem volumes de cobertura; somem no LOD FAR se < 12 m |

### Edifícios procedurais

Base + corpo + cobertura + fachada modular. A geometria é extrudada dos footprints reais. Um **único
material** (MeshStandardMaterial com shader injetado) gera toda a variedade a partir de atributos por vértice:
estilo (escritório moderno, janelas recortadas, art déco, sobrado, institucional), altura do pavimento,
cor (paletas do Centro), semente, galeria no térreo, lojas com portas de aço e letreiros, cornija, sujeira escorrida,
persianas, janelas acesas à noite e **anti-moiré** (o padrão vira média à distância). Resultado:
1 draw call de edifícios por chunk.

## Renderização (`src/renderer`)

- WebGL2 obrigatório (WebGPU fica para depois, sem ser requisito). ACES tone mapping, sRGB, PBR.
- `Environment`: **posição solar real** (algoritmo NOAA, `geo/solar.ts`) pela data/hora reais do
  Rio. Céu Preetham (`Sky`), nuvens procedurais (fBm), IBL via PMREM do céu, neblina atmosférica e luz
  direcional com sombra que acompanha o jogador, com *snap* ao texel (sem tremor). À noite: luar,
  janelas acesas, luminárias emissivas e um pool fixo de 8 luzes pontuais nos postes mais próximos.
  Uniform global `night` em `renderer/timeOfDay.ts`.
- Pós-processamento (só no ALTO): GTAO (oclusão ambiente) + SMAA. MÉDIO usa MSAA nativo.
- Texturas 100% procedurais (canvas/DataTexture) com UV em metros e variação macro em espaço de mundo (sem repetição visível).

## Jogador: separado para multiplayer (`src/player`)

| Camada | Arquivo | Responsabilidade |
|---|---|---|
| Estado | `PlayerState.ts` | dado puro, serializável (posição, velocidade, rumo, locomoção) |
| Intenção | `MoveIntent` | o que o jogador quer (direção, correr, pular): vem do input, da rede ou de IA |
| Simulação | `PlayerController.stepPlayer` | física determinística (passo fixo de 120 Hz) contra `CollisionWorld` |
| Visual | `AvatarVisual.ts` | lê o estado e anima; não altera o estado |

Para um `RemotePlayer`, basta preencher o `PlayerState` com snapshots da rede e reutilizar o
`AvatarVisual`. Um `NPC` usa o mesmo `stepPlayer` com uma intenção gerada por IA.

## Colisão (`src/physics/CollisionWorld.ts`)

Sem engine de física pesada:
- **Paredes:** segmentos 2D dos footprints com faixa de altura, numa grade espacial de 16 m.
  O círculo do jogador é empurrado para fora; o raycast da câmera usa a mesma grade.
- **Chão:** mapa de códigos por chunk (0,5 m/px, rasterizado com canvas 2D): pista (0 m),
  calçada (0,15 m, sobe meio-fio), plataforma (1 m, bloqueia degrau), água (bloqueia), fora do mundo (bloqueia).

## Câmera e input

- Terceira pessoa com suavização, órbita (yaw/pitch), zoom limitado (2–16 m), ombro deslocado,
  colisão com prédios (aproxima rápido, afasta devagar) e com o chão.
- Intro: no spawn a câmera enquadra a torre da Central e depois gira para a avenida (interrompe com qualquer input).
- `InputManager` abstrai teclado, pointer lock e toque (`TouchControls`: joystick, arrasto, pinça e botões).

## UI e bundle

- `index.html` + `main.ts` + CSS ≈ 9 KB: a tela inicial aparece na hora. O motor (three ≈ 131 KB gz,
  jogo ≈ 88 KB gz) começa a ser baixado em segundo plano e é importado sob demanda.
- Loading real em etapas: manifesto → texturas → chunks (n/total) → landmarks → malhas → shaders.

## Debug e validação

- **F3**: FPS, frame time, draw calls, triângulos, texturas, geometrias, programas, XYZ, lat/lon, rumo, chunk/LOD e ponto de validação próximo.
- Minimapa norte-para-cima com ruas OSM, Pres. Vargas em vermelho, footprints dos landmarks e pontos de validação.
- Pontos de validação (`LANDMARK_*`, `INTERSECTION_*`, `METRO_*`…) gerados no pipeline: o nome aparece no topo da tela quando o jogador está perto.
- `window.__pv` (debug): `setShot`, `teleport`, `camera`, `metrics`, `pick`, `env`.
