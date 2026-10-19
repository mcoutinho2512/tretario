# Mundo compartilhado: todos veem a mesma Presidente Vargas

Objetivo: dois jogadores olhando o mesmo cruzamento veem **essencialmente a mesma situação**.

> **Rodada 7 — avenida fechada ao trânsito convencional.** Não há mais trânsito NPC (nem simulação no servidor, nem
> snapshot, nem `TrafficSim`/`TrafficSystem`). Os únicos veículos que se movem são os **dos jogadores**: carros, motos,
> bicicletas e patinetes elétricos estacionados junto ao meio-fio, nos bolsões e nas transversais. Ônibus ficam
> **estacionados como cenário** (não utilizáveis). Os semáforos continuam visuais (e para os pedestres NPC).

## O que é autoritativo, o que é determinístico, o que é local

| Elemento | Quem decide | Como chega ao cliente | Custo de rede |
|---|---|---|---|
| **Relógio do mundo** | servidor (`Date.now()`) | ping/pong estilo NTP (`src/net/clock.ts`), filtrando pelo menor RTT | ~20 B a cada 2 s |
| **Semente do mundo** | servidor (`state.seed`) | estado da sala (uma vez) | — |
| **Semáforos** (135 cruzamentos) | **função pura do relógio** (`lightAt(t + offset)`) | nada é transmitido: cada cliente calcula a fase com o relógio sincronizado | **0** |
| ~~Trânsito NPC~~ | **removido** na rodada 7 (avenida fechada) | — | 0 |
| **Veículos utilizáveis** (89: 14 carros, 12 motos, 38 bicicletas, 25 patinetes) | servidor: estado, ocupante, posição validada do motorista | estado da sala filtrado por AOI (`StateView` + grade espacial própria `vgrid`) | delta-encoded |
| **Veículos de evento** (1 trio elétrico, 2 carros de som) | servidor, como os demais veículos (+ `NetVehicle.design`) | idem (AOI pela `vgrid`) | delta-encoded |
| **Passageiros em cima do trio** | servidor: posição LOCAL validada contra o polígono do piso | `NetPlayer.platform/plx/plz/plh` (20 Hz, só quando mudam) | ver abaixo |
| Ônibus estacionados (4), gradis, placas "via interditada" | pipeline (`manifest.parkedBuses`) + cliente (`ClosureDressing`) | estáticos | 0 |
| Caminhões de campanha, telões, palco | pipeline (`manifest.eventSpots`, carrocerias na colisão) + arte do evento | estáticos; telões desenhados localmente | 0 |
| **Jogadores** | servidor (posição validada) | estado da sala filtrado por AOI, 20 Hz | delta-encoded |
| **Evento ativo** | servidor (`state.eventId`) | estado da sala → cliente carrega `public/events/<id>.json` | — |
| Pedestres NPC de ambiente | **local** (cada cliente) | — | 0 |
| **Grafites** (rodada 7) | servidor: valida, guarda e modera (`server/src/graffiti`) | `gf_add`/`gf_del` por **superfície na área de interesse** (120 m); quem entra recebe os próximos | 80–400 B por grafite, uma vez |

## Veículos dos jogadores (rodada 7)

### Estados (servidor autoritativo)
| Estado | `NetVehicle.state` | Quando |
|---|---|---|
| `AVAILABLE` | 0 | estacionado, sem ocupante (nascimento; depois de o jogador sair ou desconectar) |
| `OCCUPIED` | 1 | um jogador controla; **um único controlador por veículo** (`canEnter` → `ocupado` para o segundo) |
| `RESETTING` | 2 | abandonado longe da vaga (> 15 m) por 5 min **sem ninguém a 25 m** → volta à vaga e fica `AVAILABLE` |

- **Entrar:** `E — USAR <VEÍCULO>` aparece perto de um veículo livre; o cliente pede `enter`, o servidor valida
  distância (pela carroceria: carro 2,2 m, moto 1,6 m, bicicleta/patinete 3,5 m), estado e ocupante.
- **Sair:** o veículo fica **parado onde está** e volta a `AVAILABLE` imediatamente para qualquer jogador. Rodada 10:
  o ponto de saída é a **saída segura** do servidor (`src/vehicles/exitSafety.ts`: porta do motorista → outro lado →
  frente → trás → anel; nunca dentro de parede, de outro veículo, colado em outra pessoa a pé nem fora do mapa).
- **Corpo no veículo (rodada 10, docs/VEHICLE_MOUNTING.md):** nada de osso na rede. Cada cliente deriva a fase
  (`entering → mounted → exiting`) da mudança de `NetPlayer.vehicle` e põe o corpo no banco do veículo **como ele o
  desenha** (âncoras de `MOUNT_PROFILES`, IK de mãos/pés só de perto); inclinação, esterço e pedivela saem do
  deslocamento do veículo — iguais para o motorista e para quem olha.
- **Sincronizado:** posição, rotação, velocidade, ocupante, tipo e estado (`NetVehicle`), só para quem está na área
  de interesse — o servidor mantém uma grade espacial de veículos (`vgrid`) e consulta só as células próximas.

### Controles e limites urbanos ("não é pista de corrida")
| Tipo | Controles | Velocidade (normal / Shift) | Validação do servidor |
|---|---|---|---|
| Carro | W acelera · S freia/**ré** · A/D esterça · E entra/sai | 25 / 30 km/h | 8,8 m/s |
| Moto | W · S freia · A/D · E | 25 / 30 km/h | 8,8 m/s |
| Bicicleta | W · S freia · A/D · E | 20 / 25 km/h | 7,3 m/s |
| Patinete | W · S freia · A/D · E | 17 / 20 km/h | 5,9 m/s |
| Carro de som | W · S freia/ré · A/D · E | 12,6 / 14,4 km/h | 4,2 m/s |
| Trio elétrico | W · S freia/ré · A/D · E (porta da cabine) | 4,3 / 5,4 km/h | 1,6 m/s |

Carro de som e trio são **sempre pacíficos** (nunca entram em `checkImpacts`; todo pedestre bloqueia — `vehicleBlock`),
**sólidos** para quem anda (`pushOutOfBox`, cliente com folga 0,35 m, servidor 0,15 m) e para os outros veículos
(`boxesOverlap`, cliente e servidor: não atravessa, para encostado). O trio testa as pontas (12,6 m), não só o centro.

### Modo pacífico (padrão): não há atropelamento
- `impactAllowed(motorista, alvo)` só é verdadeiro se **os dois** estiverem em modo interação.
- Para qualquer outro caso, `vehicleBlock` (regra pura em `src/net/rules.ts`, usada pelo cliente **e** pelo servidor)
  amostra o caminho do veículo a cada 0,25 m contra a caixa do veículo (`VEHICLE_BOX`) e **para antes de encostar**
  na pessoa. Já encostado, pode dar ré ou desviar, nunca avançar. Sem dano, sem ragdoll, sem empurrão.
- O servidor corrige o motorista com o motivo `bloqueado`; o cliente prevê o mesmo bloqueio (jogadores remotos e
  pedestres NPC locais), então a correção quase nunca aparece.

### Medido (`tools/qa/vehicles_mp.mjs`, 2 navegadores reais por tipo: 24/24)
Para carro, moto, bicicleta e patinete: estacionado e disponível → A entra → B **não** entra no mesmo → A anda →
B vê o movimento (erro < 2,5 m) → A sai → veículo parado e disponível.

### Medido (`tools/qa/vehicle_mount_mp.mjs`, rodada 10: 26/26)
Para carro, moto, bicicleta e patinete: B vê A **entrando** (fase no remoto), **montado** (pelve no banco com erro 0,
mãos no guidão/volante < 0,12 m), **andando** com o corpo preso ao banco (inclinação/esterço/pedivela vistos por B) e
**saindo**; depois da saída, B desenha A de pé exatamente no ponto do servidor. Testes do servidor real
(`tests/vehicleMountServer.test.ts`): corrida pelo mesmo carro (só um entra), saída segura com alguém na porta,
reconexão dentro da graça (volta no mesmo veículo, sem duplicar) e fora dela (veículo livre e de volta à vaga).

## Ações sociais e itens (rodada 7)
Nada de ossos pela rede. Cada jogador tem, no estado da sala (só para quem está na área de interesse):

| Campo | Tipo | O quê |
|---|---|---|
| `act` | u8 | ação/emote (`src/social/actions.ts`; 0 = nenhuma) |
| `actAt` | f64 | início no relógio do servidor (ms) → todos tocam a MESMA fase (relógio comum, `src/net/clock.ts`) |
| `actVar` | u8 | variação 0..7 (desfasamento/espelho) |
| `prop` | u8 | item na mão (`src/social/props.ts`) |
| `design` | u16 | design do item (`src/social/designs.ts`; campanhas vêm de `public/designs/campaigns.json`) |

- **Pedido → validação → estado.** O cliente envia `act {a, v}` / `prop {p, d}` (alguns bytes) e prevê localmente;
  o servidor valida (`src/social/actionRules.ts`: id existe, não caído, não em veículo, item exigido, design compatível,
  intervalo mínimo por tipo, 24 pedidos/10 s) e grava. Negado → `act_denied`/`prop_denied` e o cliente volta ao
  estado do servidor.
- **O servidor encerra:** andar (deslocamento > 0,12 m por mensagem) cancela ações que não permitem movimento
  (dançar, sentar, pose…); `once` (acenar, comemorar…) expiram; cair ou entrar em veículo encerram. Ações de
  "andar com bandeira/cartaz", palmas e megafone seguem andando.
- **Multidão distante** (mensagem `crowd`, v2): bloco social opcional de **5 B** (ação, idade em ¼ s, item, design)
  só para quem está fazendo algo — a multidão instanciada dança e levanta bandeira sem estado completo.
- **Medido** (`tools/qa/social_mp.mjs`, 2 navegadores + 1 distante, 12/12): B vê a dança de A com a mesma fase
  (0,15 s × 0,15 s), braços, bandeira (item e design), andar balançando a bandeira, cartaz, megafone; andar encerra
  a dança dos dois lados; o jogador distante não recebe A detalhado.
## Itens de confronto no mundo e política de zona (rodada 9)
Detalhes: `docs/COMBAT.md`.
- **Itens no chão** (servidor autoritativo, `server/src/items`): taco/barra/spray (props `COMBAT_PROP`) existem em
  número FIXO, em pontos de apoio definidos por dados (`public/gameplay/combat_props.json`, só em zonas de confronto/
  disputa). Estados `RACK`/`GROUND`/`CARRIED`; um por jogador; pegar exige alcance (2,2 m da posição aceita); largado
  volta à vaga depois de `groundTtlMs`; teto de largados (`maxGround`, o mais antigo volta já); quem cai, sai ou perde
  a sessão larga onde estava. Mensagens `item_pick {i}` / `item_drop` → `item_list` (só itens a ≤ 70 m, **só quando
  a lista muda** para aquele cliente, fatiado a 2 Hz) · `item_self {c,i}` · `item_denied`. A mão continua no `prop`
  (item de confronto só para quem o possui — `actionRules.validateProp`).
- **Política de zona** (`zones.json` `combatPolicy` + `peaceAreas`): PAZ (Central/spawn, Centro, Candelária),
  DISPUTA (Campo de Santana, Rio Branco), CONFRONTO (Cidade Nova). Áreas de paz fixas (spawn, palco, telões), de
  evento (pontos de retorno) e MÓVEIS (anéis do trio e do carro de som, acompanham o veículo). Consulta do servidor:
  `room.zonePolicy.policyFor(zoneOf(sid))`, `room.zonePolicy.peaceAt(x, z)`.
- **Proteção de retorno** (`NetPlayer.fx` bit PROTECTED): entrar/reconectar (sala), levantar (sistema de confronto),
  retorno de evento — `room.applyProtection(sid)`; expira sozinha (tick).

## Grafites (rodada 7)
Detalhes em `docs/GRAFFITI.md`. Todos que estão perto de uma superfície autorizada veem os mesmos grafites:
- o desenho em andamento é **local**; só o grafite pronto (vetor compacto, ≤ 4 KB) vai ao servidor, que valida superfície,
  alcance (≤ 3 m, do lado pintável), conteúdo, texto, cota e limites antes de distribuir;
- distribuição por **interesse**: grade espacial estática das superfícies + conjunto de grafites conhecidos por cliente,
  fatiado no tick, lotes com orçamento de bytes; ao sair da área o cliente descarta;
- moderação (denúncia → oculto; admin), expiração (TTL dos temporários) e remoção propagam `gf_del` só para quem tinha;
- persistência local (JSON) atrás de `GraffitiStore`: os grafites sobrevivem a reinício do servidor;
- medido com 4 navegadores reais (`tools/qa/graffiti_mp.mjs`): 26/26.
## Trio elétrico: plataforma sincronizada (rodada 7)

Quem sobe no trio **não está em veículo** (`vehicle = ''` — ações sociais continuam valendo) e passa a ter:

| Campo (`NetPlayer`) | Tipo | Significado |
|---|---|---|
| `platform` | string | id do trio (`''` = no chão) |
| `plx`, `plz` | float32 | posição LOCAL no piso (m; +z = frente do trio, +x = lado do motorista) |
| `plh` | float32 | rumo relativo ao trio (rad) |

Mensagens: `board {id, seq}` → `board_ok {id, lx, lz}` / `board_denied {id, reason}` (`distancia`, `lotado`,
`ja_em_veiculo`, `ja_em_cima`, `estado`, `inexistente`); `unboard {seq}` → `unboard_ok {x, z}` (pé da escada; se
houver parede, pelas laterais); `pmove [lx, lz, lh, speed, loco, seq]` (15 Hz, substitui o `move` enquanto está em
cima) → `pcorrect [lx, lz, seq, reason]` se o servidor prender ao polígono ou limitar a velocidade.

Regras (`src/vehicles/platform.ts`, puras e testadas):
- **subir**: a pé, de pé, sem estar em veículo/plataforma, a ≤ 2,2 m do pé da escada, até 20 por trio;
- **andar**: velocidade de pedestre (`MAX_SPEED.foot` + folga) e **dentro do polígono** `TRIO_DECK` (guarda-corpo,
  recorte da mesa de som); o cliente prende ao MESMO polígono → correção quase nunca acontece;
- **ir junto**: a cada movimento do trio o servidor recalcula o mundo de cada passageiro (`localToWorld`); o x/z de
  mundo **sincronizado** só é regravado quando muda > 1 m (serve à grade/AOI e à multidão distante) — quem tem o
  estado completo desenha o passageiro como **pose interpolada do trio × posição local interpolada**
  (`NetworkClient.platformPose`), então ele não escorrega nem treme quando o trio anda ou vira;
- o trio em que o jogador está fica sempre na sua vista (AOI); quem está em cima não bloqueia o próprio trio, não
  empurra, não é empurrado nem atropelado; `move` antigo em trânsito (seq) é descartado ao subir/descer.

Medido (`tools/qa/trio_mp.mjs`, 3 navegadores reais + 2 para o carro de som: **24/24**): A sobe → B vê A em cima;
A anda no piso → B vê a posição local (erro 0,002 m); guarda-corpo segura; C dirige o trio 7,3 m em ~7 s → a
posição de A **relativa ao trio** fica constante para B (erro máx. 0,03 m em 61 amostras, = deslocamento do trio
entre duas leituras do teste) e para A; o mundo de A no servidor acompanha (≤ 1 m, pela regravação a cada 1 m);
B não atravessa a carroceria a pé; A desce no pé da escada do trio já deslocado. Carro de som: A entra, B não entra
no ocupado, A dirige ~9,9 m em 4 s, B vê (erro 0,3 m), A sai pela porta e o carro fica disponível.

## Pedestres (ainda locais)
Os pedestres usam o mapa de superfícies rasterizado no navegador (canvas) e o comportamento de travessia. Hoje
continuam **locais e diferentes** em cada cliente. Desde a rodada 7 têm vida social determinística por semente
(`src/social/crowdSocial.ts`: item/design pelos pesos do evento, ações irregulares desfasadas) e vão a pé para os
pontos de concentração (trio, carro de som) registrados em `src/social/rally.ts`. Próximo passo: gerar no build uma grade de navegação
(calçadas/faixas) usável pelo servidor e simular uma população global pequena perto dos jogadores, com o mesmo esquema
de snapshot compacto (o mesmo formato que o antigo trânsito usava).

## Espectadores (rodada 8)
Mesmo mundo, sem corpo: ver `docs/SPECTATOR.md`. A área de interesse do espectador é a da **câmera** (`spec_cam`,
validado e com taxa limitada), com o mesmo código dos jogadores (grade espacial + `StateView` + `crowd` + grafites).
Espectadores não são entidades, não colidem e não contam como jogadores.

### Espectador aéreo: células determinísticas (rodada 8.1)
No alto (camadas FAR/AGGREGATE, pela altitude que o cliente informa em `spec_cam.alt`) o espectador não recebe
pessoas, recebe **células de 40 m** (`spec_cells`, binário, 1 Hz, ≤ 6 KB/s): jogadores reais, multidão de ambiente
estimada pelos dados do evento (separada), distribuição por grupo e por atividade. O conjunto é montado **uma vez por
período no servidor** e é o mesmo para todos; a `seed` de cada célula (`cellSeed(cx, cz, semente da sala)`) define onde
o cliente desenha cada impostor — dois espectadores no alto veem **a mesma** passeata (mesmas contagens, mesmas
cores, mesmos lugares). Quem a rede desenha individualmente é descontado da célula (sem duplicar). Jogadores normais
não mudam nada: mesmo AOI, nunca recebem `spec_cells` (testado em `tests/spectatorAerialServer.test.ts`). Detalhes,
formato e medições: `docs/SPECTATOR.md` → "Espectador aéreo".

## Reconexão (rodada 8)
Regras puras em `src/net/reconnect.ts` (testes: `tests/reconnect.test.ts`); servidor em `PresidenteVargasRoom`
(`onDrop` / `onReconnect` / `onLeave`); cliente em `NetworkClient` (`bind`, `onRoomLeft`, `rejoinFresh`).

```
cliente   CONNECTED ─queda─▶ RECONNECTING ─voltou─▶ CONNECTED (mesma entidade)
                                 └─graça vencida/recusa─▶ EXPIRED ─entrada nova─▶ CONNECTED (entidade nova)
servidor  CONNECTED ─queda─▶ DISCONNECTED_GRACE (20 s) ─voltou─▶ CONNECTED
                                 └─prazo─▶ EXPIRED → entidade removida (sem fantasma)
```
- **Graça**: `PV_GRACE_S` (padrão 20 s). Na queda (`onDrop`, só jogador) a entidade FICA — congelada (velocidade 0,
  ação em curso encerrada; veículo/trio/item mantidos, ninguém rouba o carro) e **marcada** (`NetPlayer.link = 1`; os
  outros clientes mostram "· reconectando…" no nome). Nunca é duplicada: o `sessionId`/entityId é o mesmo na volta.
- **Cliente**: reconexão automática do SDK com o token da sessão, atraso exponencial com jitter
  (`backoffDelay`: 300 ms × 2ⁿ, teto 4 s, metade fixa + metade aleatória) e tentativas suficientes para cobrir a graça
  inteira mesmo com o jitter mínimo (`retriesForGrace`) — o cliente só desiste depois que a graça certamente venceu.
  Mensagens não são enfileiradas durante a queda (nada de movimentos velhos). Selo discreto **RECONECTANDO…**
  (`src/net/ReconnectBadge.ts`).
- **Volta** (`onReconnect`): `link = 0`, cliente novo nos mapas, grafites próximos reenviados, aparências da multidão
  distante reenviadas, validação de velocidade recomeça agora; o servidor manda `resume {x,y,z,heading,vehicle,
  platform,plx,plz,prop,design,seq}` e o cliente volta para a posição AUTORITATIVA (segura) se tiver andado offline.
  O estado completo da sala volta pelo próprio Colyseus; `addRemote` é idempotente (nunca dois para o mesmo id).
- **Graça vencida**: o Colyseus chama `onLeave` → `removePlayer` (libera veículo/trio, slot e nid; ninguém continua
  "vendo"). O cliente, ao esgotar as tentativas, limpa remotos/veículos e **entra de novo** (`rejoinFresh`, backoff):
  jogador autenticado pede um ticket NOVO (`GameOptions.ticketProvider` → `POST /api/session/ticket`, uso único);
  jogador de teste entra anônimo. Espectador não tem graça: sai e entra de novo.

Medido (`tools/qa/reconnect_mp.mjs`, navegadores reais, graça de teste 10 s: **18/18**): queda artificial de A
(WebSocket derrubado + rede offline por CDP) → B vê A em graça (UMA entidade, `link = 1`) e A mostra RECONECTANDO; rede
volta após ~3 s → A reconecta na **mesma** entidade 3,6 s depois da queda (mesmo id; posição restaurada com erro 0,00 m;
bandeira na mão mantida) e B vê exatamente uma entidade de A; A volta a andar e B vê. Offline além da graça → a
entidade some para B no prazo, o servidor a remove (sem fantasma) e, com a rede de volta, A entra como entidade nova
(uma só). Login duplicado e aba de espectador da mesma conta: ver abaixo (mesmo teste). Também em
`tests/spectatorServer.test.ts` (servidor real + SDK, roda no `npm run verify`).

**Correção necessária no servidor:** o `@colyseus/core` 0.18 usa `WebSocket.OPEN` (global) na reconexão; o Node 20 não
tem `WebSocket` global e TODA reconexão falhava (`ReferenceError`, o cliente perdia a entidade).
`server/src/polyfills.ts` (importado primeiro em `server/src/index.ts`) define o global com o `ws`.

## Reinício do servidor (rodada 9.1)
A sala vive na memória do processo: depois de um reinício a entidade antiga **não existe mais** (não há graça possível).
O cliente (`NetworkClient.onRoomLeft`/`rejoinFresh`) volta sozinho, sem recarregar a página, como entidade NOVA com a
MESMA conta (ticket novo de `POST /api/session/ticket`; aparência, grupo, progressão e itens vêm do banco):

- **Reinício gracioso** (SIGTERM — deploy, `systemctl restart`): o servidor manda `server_restarting` e fecha com 4001;
  o cliente mostra **SERVIDOR REINICIANDO — RECONECTANDO…** e tenta entrar de novo com backoff (300 ms × 2ⁿ, teto
  4 s, até 40 tentativas ≈ 2 min) até o processo novo subir. Progressão, grafites e telemetria já foram gravados no
  `onDispose` (`docs/SECURITY_PRODUCTION.md` § Desligamento gracioso).
- **Queda do processo** (sem aviso): a queda parece de rede → **RECONECTANDO…** e reconexão do SDK com o token; no
  processo novo o token não acha a sala (fechamento 4003) → **CONEXÃO PERDIDA — ENTRANDO DE NOVO…** → entrada nova.
- **Queda de rede com o servidor de pé**: continua como antes — volta na MESMA entidade dentro da graça.
- Falha passageira do ticket (API ainda subindo, 429, 5xx) faz a entrada ser tentada de novo; só uma recusa
  definitiva (sem licença) entra como visitante. Recusas que pedem decisão param as tentativas e mostram aviso:
  versão nova (4010, "Nova versão disponível — recarregar") e lotação (4011 "Sala cheia — entrar como espectador?",
  4012). `4013` (entradas demais) e `4014` (servidor encerrando) são tentados de novo.

Medido (`tools/qa/restart_mp.mjs`, navegador real + conta real no PostgreSQL: **19/19**): SIGTERM → selo
REINICIANDO em < 1 s, processo sai com 0 em ~0,5 s; servidor fora por ~3 s → o cliente entrou de novo ~1,4 s depois de
o processo novo responder, com outro `sessionId`, papel jogador, mesma página e o mesmo `GET /api/me/progress`; um
espectador do SDK vê exatamente UMA entidade com o apelido da conta. SIGKILL → RECONECTANDO → entrada nova, idem.
Queda de rede curta com o servidor de pé → mesma entidade (controle).

## Login duplicado (rodada 8)
**Uma entidade jogável por conta (userId).** Política: a sessão **nova assume** (mais robusta para quem trocou de
aparelho/aba ou ficou com uma aba "zumbi"). Em `takeOver()` (no `onJoin` do jogador): a entidade antiga é removida
ANTES de a nova ser criada (nunca há duas), a identidade antiga sai de `identities` (qualquer mensagem dela passa a ser
negada; o `onLeave` dela fica inócuo), uma graça pendente é rejeitada, e a conexão antiga recebe `session_replaced` e é
fechada com o código 4020 (`RECONNECT.replacedCloseCode`) — o cliente antigo **não** reconecta e mostra "SUA CONTA ENTROU
EM OUTRA JANELA". Posição e item na mão passam para a nova; veículo/trio são liberados (a nova começa a pé ao lado,
sem atravessar parede). **Abas de espectador da mesma conta são permitidas** e não afetam o jogador.

## Presença (rodada 8)
`server/src/presence/PresenceTracker.ts` — **só em memória**, nunca gravada por quadro/mensagem.
`ONLINE` (autenticado, entrando) · `PLAYING` / `SPECTATING` (conexão viva e atividade recente) · `AWAY` (sem atividade
de jogo/câmera há 120 s, ou sem nenhum batimento — ping, spec_cam — há 45 s) · `OFFLINE` (em graça ou sem sessão).
Atividade = qualquer mensagem de jogo aceita por `gate()` ou `spec_cam` aceito; batimento = `ping`. `byUser(userId)`
dá a presença mais forte entre as sessões da conta (perfil/amigos, rodada 9). Gravar `lastSeen` no banco, se vier,
deve ser grosso (na saída ou a cada vários minutos), nunca por mensagem.

## Métricas públicas (rodada 8)
`GET /api/metrics/public` (`server/src/http/publicMetricsRoute.ts` → `server/src/presence/publicMetrics.ts`), cache
de 1,5 s, contrato `PublicMetrics` (`src/identity/types.ts`), contagens **semânticas**:
| campo | significado |
|---|---|
| `playersOnline` | pessoas jogando: entidades humanas (inclui quem está em graça de reconexão). **Nunca** bots ou NPCs |
| `spectatorsOnline` | espectadores conectados |
| `environmentCrowd` | multidão AMBIENTAL **simulada**, dos dados do evento: `social.rallyCrowd` + 56 pedestres NPC × `npcs.pedestrianDensity` (manifestação: 360 + 56 = 416) — número de simulação, rótulo próprio na UI |
| `testBots` | bots de carga (`bot: true` no join, só em servidor de teste — `server/tools/bots.ts`) |
| `totalConnections` | conexões abertas agora (jogadores + espectadores + bots; sem as em graça) |
| `eventId`, `eventName`, `updatedAt` | evento atual (sem sala viva: evento padrão dos dados) |
