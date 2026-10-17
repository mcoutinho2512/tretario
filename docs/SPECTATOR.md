# Modo espectador (rodada 8)

Quem só quer **assistir** entra no **mesmo mundo** (mesma sala Colyseus, mesmo estado) sem corpo. Não é outra
instância, não é vídeo: é a mesma Presidente Vargas que os jogadores veem, renderizada pelo cliente.

## Entrada
- Tela inicial: o botão **ASSISTIR GRÁTIS** chama `launch(choice, { role: 'spectator' })` (em `src/main.ts`;
  também `window.__pvLaunch({ role: 'spectator' })`; automação: `?autostart=1&spectate=1`).
- `Game` recebe `GameOptions.role = 'spectator'`: sem avatar (oculto), sem física, sem interação, sem roda de ações; o
  multiplayer conecta sempre (sem precisar de `?mp=`).
- O **servidor decide** o papel (`resolveIdentity` + `resolveRole`): visitante sem ticket é sempre espectador; um PLAYER
  pode pedir para assistir (rebaixar), nunca o contrário.

## Servidor (`server/src/spectator/SpectatorSession.ts`)
- **Sem `NetPlayer`, sem slot na grade espacial**: ninguém o vê, não colide, não conta como jogador.
- Área de interesse = **posição da câmera** (`spec_cam {x, z}`), não do corpo. Mesmo código dos jogadores
  (`PresidenteVargasRoom.interestAt`): `SpatialGrid` + `StateView` (jogadores e veículos próximos, 5 Hz fatiado),
  mensagem `crowd` (multidão distante, 2 Hz) e grafites por superfície (`GraffitiService`, posição = câmera).
- `spec_cam` é **validado** (`src/spectator/bounds.ts`): só números finitos, preso aos limites do mapa
  (`manifest.bounds` − 60 m), no máximo 1 a cada 200 ms (o excesso é descartado em silêncio).
- **Toda** mensagem de jogo passa por `gate()` → `can(estado, capacidade, 'spectator')`. O papel espectador não tem
  `world.play`, `vehicle.use`, `action.perform`, `item.hold`, `push`, `graffiti.create` qualquer que seja a conta
  (`PLAYER_ROLE_ONLY` em `src/access/policy.ts`). Resposta: `denied {cap}`.
- Espectador **não tem graça de reconexão**: caiu, sai; o cliente entra de novo (não há entidade a preservar).

### Protocolo
| mensagem | direção | conteúdo |
|---|---|---|
| join `{ role: 'spectator', specCam?: {x,z} }` | C→S | papel pedido + câmera inicial (o servidor prende aos limites) |
| `spawn {…, role: 'spectator'}` | S→C | confirma o papel; posição = câmera |
| `spec_cam {x, z, alt}` | C→S | foco da câmera + altitude da câmera acima do foco (m, 8.1); 2 Hz quando anda ≥ 6 m ou a altitude muda ≥ 8 m, e a cada 3 s (batimento). Sem `alt` = 0 (NEAR) |
| `spec_cells` (binário) | S→C | só espectador em FAR/AGGREGATE: células agregadas (ver "Espectador aéreo") |
| `denied {cap}` | S→C | qualquer mensagem de jogo do espectador |

## Espectador aéreo: camadas de representação (rodada 8.1)
Quanto mais alto, menos detalhe POR pessoa e mais dado AGREGADO por célula — nunca as 500 entidades completas para
quem está no alto. Contrato em `src/spectator/tiers.ts`; servidor em `server/src/spectator/` (`SpectatorSession`,
`CrowdCellAggregator`); codificação em `src/spectator/cellCodec.ts`; desenho em `src/spectator/CellImpostors.ts`.

| camada | altitude da câmera (sobe ≥ / desce <) | AOI de entidades | o que chega |
|---|---|---|---|
| NEAR | < 45 m | 220 m (= jogador) | `StateView` (48 mais próximos) + `crowd` 2 Hz — igual à rodada 8 |
| MID | 45 / 33 m | 140 m | idem, raio menor |
| FAR | 110 / 98 m | 60 m | entidades a ≤ 60 m + `spec_cells` das células a ≤ 260 m do foco |
| AGGREGATE | 200 / 188 m | 0 | só `spec_cells` da avenida inteira (+ veículos de evento: trio, carros de som) |

- A camada é do **servidor** (`tierForAltitude` com histerese de 12 m sobre o `alt` validado/preso a 0–300 m);
  o cliente desenha conforme a camada que chega em `spec_cells`. Câmera aérea (260 m) = AGGREGATE; Campo de
  Santana (≈ 67 m) = MID; Central/Candelária/trio = NEAR.
- Troca de camada → AOI recalculado na hora (sem esperar a fatia) e `spec_cells` `full`. Descer para NEAR/MID →
  uma mensagem `full` vazia (o cliente apaga as células) e nada mais.

### Célula (`CrowdCellSnapshot`)
Grade fixa de **40 m** alinhada à origem do mundo; `cx = floor(x/40)`, `cz = floor(z/40)`.

| campo | conteúdo |
|---|---|
| `players` | jogadores REAIS na célula (bots de carga incluídos — são entidades do mundo) |
| `env` | multidão de AMBIENTE estimada pelos dados do evento — separada dos jogadores |
| `groups` | chave do grupo do evento → jogadores (`''` = sem grupo). Só contagem: nenhum grupo ganha nada |
| `activity` | jogadores parados / andando / em ação social / em veículo |
| `density` | (players + env) / 1600 m² |
| `seed` | `cellSeed(cx, cz, época)` — época = semente da sala (`state.seed`) |
| `t` | relógio do servidor da amostra |

**Ambiente** (`environmentCells`, determinístico): `social.rallyCrowd` dividido entre as concentrações ativas
(palco e caminhões do `manifest.eventSpots` + trio/carros de som na posição ATUAL do servidor) por força × área do
anel — a mesma regra do `RallyCrowd` do cliente, mesma tabela `RALLY_SHAPE` (`src/social/rally.ts`) — e espalhado em
cada anel por 192 amostras fixas com a mesma distribuição radial de `RallyRegistry.spotFor`; pedestres
(`PEDESTRIAN_ESTIMATE × npcs.pedestrianDensity` = 56) ao longo do eixo, da Central (`CENTRAL.from`) à Candelária.
Arredondamento pelo maior resto (empate → menor chave): soma exata (360 + 56 = 416 no ato). Recalculado só quando um
veículo de evento anda ≥ 1 m.

### Agregação e entrega
- `CrowdCellAggregator.build` roda **uma vez por período** (`CROWD_CELL.hz` = 1 Hz) e só se há alguém em FAR/AGGREGATE;
  o conjunto é **compartilhado** por todos os espectadores (custo ≈ 0,06 ms para 500 jogadores; nada por espectador
  além do delta). Mesma entrada em qualquer ordem → snapshots idênticos (chaves e grupos ordenados).
- `CellFeed` (por espectador): guarda a assinatura (FNV-1a, sem `t`) do que o cliente tem; manda só células
  **alteradas** + **removidas**; `full` na entrada/troca de camada. FAR: células a ≤ 260 m do foco (sai só além de
  300 m — sem pisca-pisca). Teto `maxBytesPerSec` = 6 KB/s por balde de fichas (rajada de 1 s): o que não cabe vai no
  próximo envio, as mais perto do foco primeiro. Nada mudou → nada é enviado.

### Formato no fio (binário, `src/spectator/cellCodec.ts`)
`u8 versão · u8 camada · u8 full · u32 época · f64 t · tabela de grupos (u8 n + [u8 len + ASCII]) · u16 nCélulas ·
u16 nRemovidas`, depois por célula `i8 cx · i8 cz · u16 players · u16 env · 4×u16 atividade · u8 nG + nG×(u8 grupo,
u16 n)` (15 B + 3 B por grupo) e `i8,i8` por removida. `density` e `seed` não viajam: o cliente recalcula com a mesma
fórmula e a mesma época. Medido (500 jogadores ao longo da avenida, 3 grupos, ambiente 416): **77–95 células, `full`
AGGREGATE ≈ 1,8–2,5 KB** contra ≈ 11 KB do mesmo conteúdo em JSON (≈ 6×); deltas a 1 Hz ≈ 1,0–1,1 KB.

### Cliente
- `NetworkClient` aplica `spec_cells` em `specCells` (chave → snapshot) e expõe `specTier`.
- `CellImpostors`: cada pessoa vira uma instância de um boneco de ~20 triângulos num **único InstancedMesh** (1 draw
  call). Lugar determinístico pela `seed` (sequência estável; lugares dentro de prédio rejeitados pela colisão do
  mundo) → dois espectadores veem a mesma distribuição. Cores: jogadores pela distribuição de grupos (cor principal
  do grupo; sem grupo = roupas variadas); ambiente em tons neutros. De muito alto o boneco é ampliado (até 3,2× na
  largura, 2× na altura) para não sumir em 1 px — é símbolo de mapa, não escala real.
- **Sem duplicar**: em FAR, quem a rede desenha individualmente (AOI de 60 m, `forEachRemotePos`) é DESCONTADO da
  sua célula; em FAR/AGGREGATE os pedestres e a concentração locais param (o ambiente vem das células); em NEAR/MID
  não há células e o `RallyCrowd` volta. Transição: impostores crescem/encolhem em 0,5 s.
- Minimapa: no alto, o calor sai das células já recebidas (pontos dos impostores + remotos), sem pedir amostra ao
  `CrowdDirector` (sem amostragem dupla). Rótulo do espectador: "avenida inteira · N jogadores + M ambiente".

### Medido (`tools/qa/spectator_aerial_mp.mjs`, 500 bots da Central à Candelária, 2 navegadores) — 17/17
| | espectador no chão (Central, NEAR) | espectador no alto (AGGREGATE) |
|---|---|---|
| recebido | **8,6 KB/s** (48 detalhados + multidão) | **1,1 KB/s** (células + batimentos) |
| FPS (M-series, preset baixo, 1280×720) | 59,6 | **60** |
| draw calls | ~1 400 | ~480 |
| entidades da rede | 48 | 0 (916 impostores: 500 jogadores + 416 ambiente) |

Os dois espectadores recebem células com a **mesma assinatura** (contagens, grupos, atividades, seeds); FAR sobre a
Central, Campo de Santana e Candelária manda só ~30 células; descer na Candelária volta a NEAR com 48 entidades e 0
impostores. Resultado completo: `docs/bench/round8_1_spectator_aerial.json`; capturas A–H em
`docs/screenshots/round8_1/`.

## Caminhada vista do alto (rodada 9)
- A caminhada agendada (docs/EVENTS.md, docs/MANIFESTATION_SYSTEM.md) tem um líder virtual que anda pela rota; o
  runtime de eventos expõe a concentração como `EnvRally` com `crowd` = `npcCrowd` (120 NPCs **simulados**, fora da
  divisão de `social.rallyCrowd`). A sala soma esses pontos ao ambiente das células (`environment()`, posição
  arredondada a 4 m: recalcula só quando o líder anda) — no alto (FAR/AGGREGATE) a mancha de densidade **anda** com a
  caminhada; no chão o `RallyCrowd` do cliente faz os NPCs caminharem até o novo lugar no anel.
- Medido (`tools/qa/events_mp.mjs`, espectador em AGGREGATE sobre a Central/Campo de Santana, ~60 s de caminhada a
  3 m/s): as 120 pessoas de ambiente da concentração mudaram de célula; o centro das células que ganharam × o das que
  perderam deslocou **178 m** rumo à Candelária (líder andou 183 m); 57–59 células, 576 de ambiente no total (não muda:
  só se move). Captura: `docs/screenshots/round9/R_caminhada_aerea.jpg`.
- Teste: `tests/eventRuntime.test.ts` (células de ambiente com o líder em dois instantes: total = 100 reservados nos dois,
  centro de massa a menos de uma célula do líder, deslocamento > 250 m).
- Espectador pode acompanhar uma corrida/confronto com `evt_watch` (marcadores e resultado), sem se inscrever.

## Câmeras (`src/spectator/SpectatorCamera.ts`, `anchors.ts`)
| tecla | câmera | origem |
|---|---|---|
| 1 | CÂMERA LIVRE LIMITADA | WASD/joystick movem o foco, arrastar/mouse gira, roda/pinça muda a distância |
| 2 | CENTRAL | âncora da zona `CENTRAL` (`public/world/zones.json`) olhando o marco da Central do Brasil |
| 3 | CAMPO DE SANTANA | âncora da zona `CAMPO_DE_SANTANA`, ao longo do eixo |
| 4 | CANDELÁRIA | âncora da zona `CANDELARIA` olhando a igreja |
| 5 | TRIO/PALCO | segue o trio elétrico (`trio0`); sem trio, o palco (`manifest.eventSpots` stage) |
| 6 | CÂMERA AÉREA | altitude máxima (260 m) sobre o meio da avenida |

- Limites: foco dentro do mapa (margem 60 m), pitch 0,12–1,45 rad, distância 8–320 m, altitude ≤ 260 m e a **própria
  câmera** dentro do mapa (`clampPose`). Edifício entre foco e câmera → a câmera aproxima (raycast na colisão).
- Transições suaves (amortecimento exponencial; distância em escala logarítmica). Mover em qualquer câmera fixa vira
  câmera livre a partir dali.
- Interface: `CameraSwitcher` (componente montável, atalhos 1–6 ignorados ao digitar no chat) e `SpectatorBadge`
  ("MODO ESPECTADOR") em `src/spectator/SpectatorHud.ts`; estilos em `src/spectator/spectator.css`. O HUD geral
  (rodada 8, E) decide a posição final; hoje o `Game` monta os dois no HUD.
- O "jogador" local do `Game` vira o **foco da câmera**: chunks, NPCs, minimapa, grafites e sombras seguem a câmera.

## Tempo até assistir (`tools/qa/time_to_watch.mjs`, `tools/qa/spectator_mp.mjs`)
Clique → 1º quadro do mundo (`pv:click` → `pv:world-visible`), cache frio, M-series local, build de produção
(`vite build` + `vite preview`), servidor local:

| rede (CDP) | clique → 1º quadro | clique → 1º jogador visível | baixado após o clique |
|---|---|---|---|
| sem limite (localhost) | 3,3 s | 3,5 s | ~5 MB |
| 20 Mbit/s · 40 ms | **5,2 s** | 5,4 s | 5,1 MB |
| 10 Mbit/s · 60 ms | **6,6 s** | 6,8 s | 5,1 MB |

(2 medições por perfil, diferença < 0,1 s.) Meta "< 10 s numa conexão normal": cumprida.

No servidor de desenvolvimento do Vite (módulos soltos, cache quente): ~3,3 s.

## QA
- `tests/spectatorServer.test.ts` — servidor REAL + SDK: espectador forjado manda `move/pmove/mode/enter/exit/board/
  unboard/push/act/prop/gf_new` → 11 negações, nada muda; `spec_cam` move a área de interesse; métricas semânticas.
- `tests/spectatorBounds.test.ts` — limites da câmera, validação/taxa do `spec_cam`, âncoras, capacidades do papel.
- `tools/qa/spectator_mp.mjs` — A jogador + B, C espectadores (navegadores reais): dança, direção, mensagens forjadas,
  troca para a Candelária (a AOI acompanha) e volta, câmera aérea, métricas, tempo até assistir.
- Capturas: `screenshots/round8/B_modo_espectador.png`, `screenshots/round8/C_camera_aerea.png`.
- Rodada 8.1: `tests/crowdCells.test.ts` (histerese, agregador determinístico e independente de ordem, jogadores ×
  ambiente, grupos/atividades, codificação, delta/full/removidas, teto com 500 jogadores);
  `tests/spectatorAerialServer.test.ts` (servidor real + 500 bots: no alto só células — 0 entidades —, dois
  espectadores com as mesmas células, teto de bytes/s, descida → NEAR com entidades, FAR só perto do foco; jogador
  nunca recebe `spec_cells` e mantém o AOI); `tools/qa/spectator_aerial_mp.mjs` (navegadores reais, capturas A–H).

## Limitações
- (Resolvido na 8.1) No alto a avenida inteira chega como células agregadas; o AOI de entidades encolhe por camada.
- Dentro de uma célula a posição de cada pessoa é ilustrativa (lugar sorteado pela seed): a contagem, os grupos e a
  densidade são reais, a posição exata não. O ambiente é uma ESTIMATIVA pelos dados do evento (os pedestres de cada
  cliente continuam locais).
- A oclusão da câmera por prédios pode puxar a câmera para baixo (e a camada desce junto) quando o foco cai dentro de
  um quarteirão (ex.: o ponto do eixo na Candelária, t = 0,954).
- O espectador não escolhe seguir um jogador específico (só o trio); a interface de "seguir" é da rodada 9.
- A multidão ambiental (NPCs) é local de cada cliente (como para os jogadores).
