# Sistema da manifestação (rodada 7)

Contratos ÚNICOS (não duplicar):

| Módulo | O quê |
|---|---|
| `src/social/actions.ts` | registro de ações/emotes (`ActionDefinition`, ids u8 estáveis) |
| `src/social/props.ts` | itens seguráveis (`PropDefinition`, pegada, pose de carregar, slot de design) |
| `src/social/designs.ts` | designs neutros + campanhas (dados em `public/designs/campaigns.json`) + camisas de futebol (só cores) |
| `src/social/designPainter.ts` | pintor de designs (canvas) e atlas por alvo |
| `src/social/rally.ts` | pontos de concentração (trio, carro de som, palco) |
| `src/social/actionRules.ts` | regras do servidor para ações/itens (puras) |
| `src/social/types.ts` | `SocialState` — o mesmo estado para jogador local, remoto, NPC e multidão instanciada |
| `HumanCharacter.setSocial` / `AvatarVisual.setSocial` | ponto único: animador (camada de ação) + `PropAttachment` (itens na mão) |
| `CrowdAgent.act/actAt/prop/design` | vida social na multidão instanciada |

Rede: `NetPlayer.act/actAt/actVar/prop/design`; mensagens `act {a, v}` e `prop {p, d}` (servidor valida e grava).

## Veículos e cenário de evento (trio elétrico, carro de som, caminhões, telões, palco)

| Módulo | O quê |
|---|---|
| `src/vehicles/platform.ts` | **puro** (servidor + cliente): dimensões do trio (`TRIO`), polígono do piso (`TRIO_DECK`), local ↔ mundo, `canBoard`, `validatePlatformMove`, `exitPoints`, mensagem `pmove` compacta |
| `src/vehicles/eventModels.ts` | modelos procedurais com LOD: `buildSoundcar`, `buildTrio`, `buildCampaignTruck`, `buildScreenStand`, `buildStage`; `applyDesign(root, designId)` (só troca material dos painéis) |
| `src/vehicles/trioRider.ts` | jogador LOCAL em cima do trio (input → referencial do trio → polígono → mundo) |
| `src/vehicles/Rideable.ts` | tipos `soundcar` e `trio` em `RIDEABLE_DEFS` (cortejo: 3,5/4,0 e 1,2/1,5 m/s), banco da cabine (`seat`), `nearestLadder`, RallyPoints que seguem o veículo |
| `src/world/eventScenery.ts` | caminhões de campanha, telões e palco nos `manifest.eventSpots`; arte por evento; telões perto/longe |
| `src/events/screenFeed.ts` | canal ÚNICO dos telões (canvas 512×288, 2 Hz, só redesenha com algum telão perto) |
| `src/net/rules.ts` | `VEHICLE_KINDS` + `soundcar`/`trio`, `EVENT_VEHICLE_KINDS`, `BOXED_KINDS`, `pushOutOfBox`, `boxesOverlap`; `canEnter` do trio só pela porta da cabine |

**Onde ficam** (pipeline `tools/build_world.ts`, `npm run map:build`; posições estáveis, carrocerias na colisão do
servidor como os ônibus): trio `trio0` no meio do corredor (≈ 50 % Central→Candelária), carros de som `som0`
(perto do spawn, ≈ 31 %) e `som1` (≈ 69 %), caminhões `truck0..3` junto ao meio-fio, telões `screen0/1` virados para
o trio e o palco `stage0` perto da Candelária, virado para a Central. Trio e carros de som são `vehicleSpawns`
(veículos do servidor); caminhões, telões e palco são `eventSpots` (cenário sólido, não utilizável). Eventos com
lista de veículos precisam incluir `soundcar`/`trio` (`cotidiano` e `classico-exemplo` já incluem).

**Arte (designs)**: DADOS do evento — `EventDef.scenery.designs` (`{ "trio0": "ato_pv", "truck1": "<chave>" }`),
`scenery.screens` (slides: chave de design, `info`, `eq`), `scenery.screenSeconds`, `scenery.ticker`. Sem
configuração: trio/carros de som com a arte neutra `ato_pv`; caminhões recebem **todas** as campanhas cadastradas em
`public/designs/campaigns.json` em rodízio + a arte neutra (o código não conhece nenhuma candidatura; todas iguais).
A arte dos veículos vai na rede (`NetVehicle.design`, u16); a do cenário é local (vem do mesmo evento).

**Trio — subir/andar/descer**: `E — SUBIR NO TRIO` no pé da escada (atrás, `TRIO.ladderFoot`, 2,2 m);
em cima, WASD anda no piso (1,3 m/s, Shift 2,6), o guarda-corpo segura (polígono); `E` desce pelo pé da escada.
Dirigir: `E — DIRIGIR O TRIO ELÉTRICO` só na porta da cabine (lado esquerdo). Capacidade 20. Em cima: ações sociais
permitidas (`vehicle` = '' e `ActionActor.onPlatform = true`), ninguém empurra nem é empurrado, ninguém é atropelado.

**RallyPoints** (`rallyPoints`, `src/social/rally.ts`): `veh_trio0` (trio, inner 7,8 m, raio 24, força 1),
`veh_som0/1` (soundcar, 3,5 / 14 / 0,75) — atualizados quando o veículo anda > 0,5 m; `stage_stage0` (9 m à frente
do palco, 3 / 20 / 0,9); `truck_truck0..3` (`event`, 5,5 / 11 / 0,35). **Integrador**: os NPCs só precisam ler
`rallyPoints.nearestActive(x, z)` / `RallyRegistry.spotFor` — nada mais a ligar.

**Custo medido** (`tools/qa/event_vehicles_shots.mjs`, `renderer.info` com/sem o objeto no mesmo quadro, preset
high — inclui os passes de sombra e o pré-passe, por isso ~2–3× o número de malhas):

| Objeto | perto (malhas) | perto (draws / triângulos) | médio | longe |
|---|---|---|---|---|
| Carro de som | 4 (carroceria, luzes, grades, painéis) | 10 / 3,8 k | 6 / 1,4 k (≥ 45 m) | 2 / 48 (≥ 140 m) |
| Trio elétrico | 5 (+ fachos à noite) | 12 / 21 k | 8 / 2,5 k (≥ 70 m) | 2 / 168 (≥ 200 m) |
| Caminhão de campanha | 4 | 10 / 7,1 k | 6 / 1,8 k (≥ 50 m) | 2 / 24 (≥ 160 m) |
| Telão de treliça | 2 | 6 / 5,7 k | 1 malha (≥ 60 m), material liso > 160 m | — |
| Palco | 5 (+ fachos à noite) | 10 / 9,4 k | 6 / 224 a 209 m | caixa (≥ 220 m) |

Sem luzes reais (todas as luzes são emissivas/`MeshBasicMaterial`; fachos = cones aditivos que só aparecem à noite;
lonas iluminadas por trás via `emissiveMap`). Telões: 1 textura 512×288 compartilhada, ~2 uploads/s só com telão
a < 160 m. Rede: trio parado com passageiro parado = 0 B; passageiro que anda no piso manda `pmove` (6 números,
15 Hz, igual ao `move`); o x/z de mundo dos passageiros só é regravado a cada 1 m (os clientes desenham pelo local).
Medido em `trio_mp`: observador B recebia 115 B/s com trio parado e A em cima; 521 B/s com o trio andando (motorista
+ trio + passageiro).

QA: `node tools/qa/trio_mp.mjs <baseUrl>` (multiplayer, servidor de teste próprio na porta 2673) e
`node tools/qa/event_vehicles_shots.mjs <baseUrl> [pasta]` (fotos + custo). Fotos: `screenshots/round7/vehicles/`
(D carro de som, E trio, E3 trio à noite, F jogador sobre o trio, F2 visto por outro cliente, G caminhões 13/22 e
G3 arte neutra — mesma geometria, só textura, H telão, I palco); representativas em `docs/screenshots/round7/`.
