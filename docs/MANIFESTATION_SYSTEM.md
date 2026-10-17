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
| `src/graffiti/*` + `server/src/graffiti/*` | pichação/grafite: superfícies autorizadas, vetor compacto, regras/moderação, persistência — `docs/GRAFFITI.md` |

Rede: `NetPlayer.act/actAt/actVar/prop/design`; mensagens `act {a, v}` e `prop {p, d}` (servidor valida e grava).

## Itens, bandeiras e cartazes (`src/social/props/`)

Tudo procedural (geometria + canvas), sem modelos externos. O design nunca muda a geometria: só a textura.

| Arquivo | O quê |
|---|---|
| `props/grips.ts` | pegadas (puro, testado): modo de cada item (`bone` / `upright` / `two_hand` / `waist`), centro e eixos do punho medidos no rig, posição aproximada na multidão distante, ações que erguem/balançam, LOD do tecido |
| `props/propGeometry.ts` | modelos compartilhados por (tipo, `near`/`far`): parte rígida numa malha só (cor + rugosidade/metalicidade por vértice → 1 draw call) + partes com design (tecido, face de cartaz) com transformação e tamanho |
| `props/propMaterials.ts` | material único de corpo, shader de tecido, materiais de design com contagem de referências, vento global (`setPropWind`) |
| `PropAttachment.ts` | itens na mão de um personagem com esqueleto (via `HumanCharacter.setSocial` → `updateProps(dt)` depois da animação) |
| `props/PropInstancer.ts` | itens da multidão instanciada (tier 1) — gancho em `CrowdDirector.end` |
| `props/BigFlag.ts` | `createBigFlag` (mastro 7 m, bandeira 6 × 4,2 m) e `createStaticBanner` (faixa entre dois mastros) para palco, trio e avenida |

**Pegada.** Itens de uma mão (bandeira pequena, megafone, apito, taco) são filhos do osso `hand_r` com o quadro do
punho fechado (`HAND_GRIP`: o cabo sai pelo lado do polegar, +Z = dedos) — o balanço vem da animação. Itens de duas
mãos (cartazes, faixa, bandeira grande) têm o quadro RECALCULADO a cada quadro a partir das duas mãos (cadeia de
matrizes locais até o `root`, sem atualizar o esqueleto inteiro): servem para qualquer pose de carregar. Cartaz
pequeno = papelão pela borda de baixo; cartaz grande = placa de espuma num sarrafo; placa dupla = cavalete; faixa =
um mastro curto em cada mão, pano com a largura entre as mãos; bandeira grande = mastro passando pelas duas mãos;
percussão = surdo na cintura com alça até o ombro e baqueta na mão direita. Taco: **só visual** (nenhum golpe/dano).

**Tecido sem física.** Vertex shader: onda viajante a partir do mastro com amplitude crescendo para a ponta,
ondulação secundária e rajada lenta, queda com vento fraco, fase pela posição no mundo; normais pelas derivadas
analíticas; dupla face com o U espelhado no verso (texto legível dos dois lados). O pano gira em torno do mastro para
ficar a favor do vento relativo (vento global − velocidade do portador). LOD: perto = malha subdividida + 2 ondas;
esqueleto distante = poucos segmentos + 1 onda (`cheap`); multidão = instanciado com atlas.

**Multidão instanciada.** Uma `InstancedMesh` por tipo de peça (rígidas por tipo, tecido de bandeira, faixa, face
de cartaz, lona do guarda-chuva): ≤ 15 draw calls para qualquer número de agentes. Design pela célula do atlas por
instância (`aCell`); os atlas são refeitos quando o registro de designs cresce (campanhas chegam dos dados depois).
Ação de erguer sobe o item; de balançar, oscila. QA: `?crowdProps=0..1` dá itens a essa fração dos agentes.

**Como acrescentar um design**: nada de código — entrada em `designs.ts` (neutros) ou em
`public/designs/campaigns.json` (campanhas), com `targets` incluindo `flag`/`sign`/`banner`.
**Como acrescentar um item**: `PropDefinition` em `props.ts` (id novo) → pegada em `PROP_GRIPS` e posição em
`FAR_PLACEMENT` (o teste `tests/props.test.ts` falha se faltar) → construtor em `propGeometry.ts` (`BUILDERS`) →
pose de carregar no animador.

**Integração.** Personagem: `human.setSocial({..., prop, design})` e, depois de animar, `human.updateProps(dt)` (já
feito em `AvatarVisual` e nos pedestres). Multidão: preencher `CrowdAgent.prop/design/act`. Cenário:
`createBigFlag({ design })` → `scene.add(f.object)`, `f.update(dt, camera)` por quadro, `f.dispose()`.
Vento: `setPropWind(dirX, dirZ, força)`.

**Custo medido** (`dev/props.html` num Mac com Metal, `tools/qa/props_shot.mjs`; draw calls incluem o passe de sombra):

| Cenário | Draw calls | Triângulos | Memória |
|---|---|---|---|
| 1 bandeira grande na mão (perto) | +3 (rígida + sombra + tecido) | +2,7 k | textura do design 731 × 512 (~2 MB c/ mipmaps) |
| 1 cartaz pequeno na mão | +4 (rígida e face, + sombras) | +0,3 k | textura 384 × 512 (~1 MB) |
| 200 agentes instanciados com itens (397 instâncias) | +13 | +25 k | 3 atlas (~2,2 MB) |
| 2 bandeiras de cenário (6 × 4,2 e 4,5 × 3,1 m) + 1 faixa de 6 m | +8 | +9,5 k | uma textura 512 por design |
| no jogo (pedestres com `?crowdProps=1`) | +14 | +1,7 k | sem mudança de FPS (60) |

Página de desenvolvimento: `/dev/human.html?prop=flag_large&design=brasil&cam=wide` (com `&hold=0` desliga a pose de
segurar improvisada da página) e `/dev/props.html?n=200&held=sign_small&big=1&cam=crowd|big|held`.

Limitações: sem colisão do tecido com o corpo ou com outros itens; a faixa de UMA pessoa estica o pano entre as mãos
(entre duas pessoas: `createStaticBanner` posicionado pelo integrador); durante a queda/ragdoll os itens de duas mãos
ficam na última pose; a bandeira de cenário não projeta sombra do tecido.
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
Animações das ações e poses de itens (clipes procedurais, camada de ação, multidão instanciada, pegadas): `docs/EMOTES.md`.

## Grupos do evento e identidade (rodada 8)
- O jogador escolhe um grupo **por evento** (EventMembership; `public/events/manifestacao.json` → GRUPO 13, GRUPO 22,
  NEUTRO). A escolha não é atributo da conta e é apagada após a retenção do evento (`membershipRetentionDays`).
- O grupo só define **aparência sugerida**: `designKey` e `suggestedDesigns` (CampaignDesign / designs neutros) viram o
  padrão ao pegar bandeira, cartaz ou faixa e a opção de camiseta na escolha do grupo — nunca obrigatórios.
- **Neutralidade mecânica** (tests/groupNeutrality.test.ts): velocidade, acesso, veículos, área de interesse,
  prioridade do servidor e qualidade gráfica são idênticos para 13, 22, NEUTRO e sem grupo; nenhum código-fonte
  menciona ids de grupo ou chaves de design de campanha.
- O canal de chat GRUPO usa o grupo do evento (docs/CHAT.md); nada mais depende dele.
- Detalhes de conta, sessão e privacidade: docs/IDENTITY.md, docs/AUTH.md, docs/ACCESS_CONTROL.md,
  docs/PRIVACY_ARCHITECTURE.md.

## Caminhada coletiva, tipos de grupo e torcidas (rodada 9)
- **Caminhada** (`format: "caminhada"`, `server/src/events/WalkRunner.ts`; agenda em docs/EVENTS.md): a rota são
  checkpoints em fração do eixo (`walk.route`, ex.: Central t 0,28 → Campo de Santana 0,38 → Centro → Rio Branco 0,86 →
  Candelária 0,93 — o trecho 0,936–0,948 em frente à igreja tem obstáculo, a rota termina antes). Entre checkpoints de
  eixo o caminho **segue o eixo** (amostrado a cada 0,4 %), não uma reta que cortaria quarteirões.
- Um **líder virtual** anda pela rota a `paceMs` (1,2 m/s nos dados: ~1,4 km em ~20 min) a partir do início da
  instância — posição determinística pelo relógio do servidor. Ele é uma concentração em movimento: `RallyPoint` kind
  `event` no cliente (o `RallyCrowd` faz cada NPC **caminhar** até o novo lugar no anel — sem formação rígida) e
  `EnvRally` no servidor (o ambiente das células do espectador aéreo anda junto, docs/SPECTATOR.md).
- **NPCs simulados**: `npcCrowd` (120 na caminhada) são NPCs de ambiente RESERVADOS para o ponto (`RallyPoint.crowd` /
  `EnvRally.crowd`), fora da divisão de `social.rallyCrowd` — existem mesmo com o mundo vazio, são determinísticos e
  só do cliente; o ambiente das células continua rotulado como simulado e `AgendaEntry.count` conta só humanos.
- **Participação**: inscrito, a pé, a ≤ `followRadius` (25 m) do líder; conta a distância que o líder andou enquanto você
  estava perto; ≥ `completeFraction` (60 %) da rota → `event_complete`. Quem vai de bicicleta ou fica longe não conclui.
  O líder chega ao fim, a concentração fica 20 s (dispersão) e a instância termina.
- **Tipos de grupo** (`Group.kind`, `src/events/schedule.ts GroupKind`): `POLITICAL` (GRUPO 13, GRUPO 22), `NEUTRAL`
  (NEUTRO, "Sem torcida"), `SUPPORTERS` (torcidas), `CUSTOM` (encontro). **Só dados**: nenhum código decide por tipo
  (tests/groupNeutrality.test.ts procura comparações com os tipos e as chaves).
- **Torcidas** (`public/events/classico-exemplo.json`): nomes FICTÍCIOS e neutros — Maré Vermelha, Onda Tricolor,
  Coro da Diagonal, Brisa Azul — com camisas de futebol **sem escudo** (designs 200–207: vermelha lisa, listras verde/
  grená/branco, faixa diagonal, listras azul e branco) e cores próprias. Nenhum nome, escudo, uniforme oficial ou
  patrocinador de clube. Mesmas regras de todos os grupos: escolha por evento, só aparência.
- **Confronto entre grupos** (protótipo, `ClashRunner`): só entre inscritos das torcidas listadas em
  `groupRules.allowed`, só nas zonas do evento e só enquanto ATIVO; fogo amigo pelos dados (padrão desligado); pontos
  por segurar a área central (só um grupo dentro) e por derrubadas NO evento (mesmo grupo nunca pontua); derrubado
  volta ao ponto do seu grupo com proteção (`FX.PROTECTED`); recompensa = participação (presença ≥ 50 % do tempo).
  A troca de lados dá o mesmo resultado (teste de neutralidade).
