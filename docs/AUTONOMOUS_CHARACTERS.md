# Personagens autônomos

> Rodada 12. Personagens do MUNDO decididos pelo SERVIDOR (AGENTE C: `server/src/autonomous/`); apresentação no
> cliente (AGENTE D) na seção "Cliente" abaixo; diretor de eventos dinâmicos (AGENTE E) em docs/DYNAMIC_WORLD.md;
> colisão entre corpos (AGENTE A) em docs/CROWD_COLLISION.md. Não são contas, não são bots de carga, não usam LLM nem
> chat: personalidade = pesos de probabilidade.

## Servidor

### Arquitetura

| Arquivo | Papel |
|---|---|
| `server/src/autonomous/types.ts` | contrato (Personality, GoalKind, Goal, ShortMemory, SimLod, `AutonomousWorldView` do diretor) |
| `AutonomousSystem.ts` | população, LOD/materialização, decisão, passo de movimento, rodas, gestos/olhar, confronto, WorldView, métricas |
| `brain.ts` / `personality.ts` | utility AI (utilidade × personalidade × ruído, inércia 1,6×) e os 9 perfis (pesos) |
| `steering.ts` | movimento humano (puro): aceleração, curva limitada, chegada, antecipação, espaço pessoal, desvio suavizado, espera |
| `bodies.ts` | adaptador do contrato de corpos: percepção do desvio (grade com velocidades) + `constrainStep` = `constrainMove` do agente A |
| `names.ts` | apelidos (gerador + reserva de chaves) |
| `host.ts` | `AutonomousHost`: o que o sistema vê/faz — a SALA implementa; `simHost.ts` é o host sem rede (testes/relatório) |
| `config.ts` | leitura validada de `public/gameplay/autonomous.json` (+ títulos reais de recompensa, ações de confronto por chave) |
| `report.ts` | medição de humanização (mundo real: paredes/eixo/pontos do manifesto + diretor de eventos) |

A sala (`PresidenteVargasRoom`, bloco "rodada 12 — personagens autônomos") cria cada autônomo como entrada COMUM de
`state.players` (id `ac:<n>`, `kind = 1`) com `PlayerRT.auto` e uma "conexão" interna (stub). Por isso tudo passa pelos
MESMOS métodos dos jogadores: `onMove` (velocidade/paredes/carroceria do trio, `bodies.sync`), `onAct`/`onProp`
(`validateAction`/`validateProp`, anti-spam), `onEnter`/`onExit` → `mountVehicle`/`dismountVehicle` (canEnter, saída
segura), `CombatSystem.request` (stamina, cooldown, alcance, arco, política). As respostas (`correct`, `cbt_self`,
`cbt_denied`, `exit_ok`…) voltam ao cérebro pelo stub. O cliente desenha com o MESMO caminho dos remotos (AOI, multidão
`crowd` com bit 6, interpolação, animação, montagem) — nenhum renderizador paralelo.

Fora dos autônomos: AOI/StateView própria, mensagem `crowd` própria, itens do chão (`items.each`), progressão/missões/
telemetria (`GameplayBus.ignore`), presença, `metrics.players`, lotação da sala (`roomFull` desconta), plateia do debate,
nível/título/torcida de conta (`peopleEntries`).

`PV_AUTONOMOUS`: ausente → `population.maxActive` dos dados (fora do servidor de teste) e 0 com `PV_TEST=1` (os testes
antigos não mudam); `0`/`off` desliga; `N` = população.

### Quantidade e LOD (public/gameplay/autonomous.json)

- População persistente da sessão = `maxActive` (220); ativos (com entidade) = `maxActive − perHumanReduction × pessoas`,
  nunca abaixo de `minActive` (60): com 40 pessoas, 100 autônomos.
- LOD pela distância à PESSOA mais próxima (humanos, bots de carga e câmeras de espectador), recalculado a 2 Hz,
  ordenado por distância com orçamentos:

| Faixa | Distância | Máx. | Passo de movimento | Decisão (por pessoa, sorteada) | O que roda |
|---|---|---|---|---|---|
| NEAR | ≤ 60 m | 80 | 10 Hz | 0,7–1,6 s | desvio com antecipação, corpos, gestos, olhar, social, combate, veículo |
| MID | ≤ 160 m | 120 | ~3,3 Hz (10 Hz em briga/fuga/veículo) | 2,5–5 s | desvio, corpos, gestos, social |
| FAR | ≤ 270 m | resto | 1 Hz | 8–15 s | só o trajeto (sem desvio/gesto) |
| DORMANT | > 270 m (volta a ≤ 240 m) | — | nada | nada | fora de `state.players` (custo zero) |

- Densidade ORGÂNICA perto de CADA pessoa (rodada 12, agente G — `population.local`): a cada 2 s, quem tem menos de
  `want` = clamp(`share` 0,45 × ativos ÷ pessoas, `min` 12, `max` 30) autônomos a ≤ 70 m recebe até 2 "chegadas": um
  DORMANT longe de todos (ou um FAR sem compromisso a > 180 m de qualquer pessoa, fora da vista) aparece a 150–215 m
  pelo eixo — ou, para quem joga LONGE do eixo (vagas a ~270 m), por uma rua livre de parede a 55–110 m — e vem andando.
  O passeio de quem está fora do eixo fica onde há gente (≤ 90 m de uma pessoa). Metade das viagens (TRAVEL) vai para
  perto de alguém que joga no eixo. Quem vai embora (LEAVE_AREA) anda até sumir. O teto de ativos continua valendo.
- Pontos fixos do mapa (palco, caminhões, telões, praça do spawn) atraem menos sem evento (`hotspotWeights` 0,8 / 0,45 /
  0,35 / 0,4; antes 1,3 / 0,8 / 0,6 / 0,7): "event" 41,5 % → 25 % do tempo.
- Orçamento de decisões por tick (`max(12, ativos/6)`): pico nunca vira tick longo.

### Personalidades (pesos, não scripts)

SOCIAL · OBSERVADOR · AGITADO · TORCEDOR · MANIFESTANTE · EXPLORADOR · CURIOSO · CONFRONTADOR · CAUTELOSO
(frações em `personalities`). Cada perfil tem pesos por objetivo, velocidade, chance de correr, sociabilidade, gestos/min,
curiosidade, reação a briga (observar/entrar/fugir/defender), espaço pessoal, tempo na área e "pavio". Cada pessoa ainda
sorteia a sua variação: velocidade de caminhada (σ ≈ 0,15 m/s), corrida, curva, aceleração, espaço pessoal, gestos, fase e
tempo de reação.

### Objetivos e memória

`WANDER IDLE TRAVEL SOCIALIZE MEET_GROUP JOIN_CROWD WATCH_EVENT CHEER DANCE FOLLOW_EVENT FOLLOW_SUPPORTERS USE_VEHICLE
WATCH_FIGHT AVOID_FIGHT JOIN_FIGHT LEAVE_AREA`, cada um com duração sorteada (`GOAL_MS`). Memória curta: grupo, briga vista,
ameaça (quem me bateu), último adversário, veículo, destino. Pontos de concentração: palco, caminhões, telões, praça do
spawn (manifesto), trio/carro de som andando e concentrações dos eventos vivos (`evt.rallies()`), com "prova social"
(quanto mais gente, mais atrai; lotado, menos).

### Distribuição no tempo

Primeira decisão de cada um num instante sorteado (0,15–4,5 s ao aparecer); intervalo sorteado por decisão; reação a
briga/agressão com atraso individual (0,3–1,6 s × fator pessoal); gestos por processo de Poisson individual; loops com
duração sorteada; rodízio de fala próprio de cada roda. Resultado (10 min, 100 autônomos): inícios de caminhada num mesmo
tick ≤ 4 depois do aquecimento; mesma ação começando no mesmo tick 1,6 %.

### Movimento

Rumo desejado = alvo + desvio lateral filtrado (constante 0,35 s) com LADO mantido ≥ 1,1 s (sem zig-zag); antecipação pelo
ponto de maior aproximação (velocidade relativa, 2 s); desacelera ao chegar e em curva; parado por alguém à frente →
espera e, depois de 1,4 s, contorna pelo outro lado. Viagem longa segue o eixo da avenida numa FAIXA própria, com alvo
25–32 m à frente (sem desacelerar a cada ponto); obstáculo → troca de faixa e contorno curto; 4 correções seguidas no
mesmo alvo → desiste do alvo (fica, encara o foco, decide de novo). Corpos: `constrainMove` (agente A) no passo e, na
sala, contra `room.bodies.grid` (humanos duros) antes do `onMove`, + `resolveAutonomous` depois do tick.

### Social

Rodas de 2–5: ângulos espalhados na roda com folga individual, de frente para o centro; quem fala gesticula (`talk`) na sua
vez (rodízio 2,5–9 s, às vezes pausa), os outros olham (`look`) quem fala e às vezes fazem sinal/apontam/celular; quem sai
pode acenar. Grupos caminhando: o líder escolhe o destino, os outros vão ao lado/atrás no ritmo dele. Torcedores
(`FOLLOW_SUPPORTERS`) vão para o centro de quem tem a MESMA torcida (igualdade de `sup`) e balançam bandeira; manifestantes
seguem trio/carro de som/eventos (cartaz, megafone, apito, percussão). Reação a pessoa perto: olhar (curiosidade), às vezes
um aceno; nunca seguir.

### Confronto

Sempre pelo CombatSystem (mesmas regras do jogador; mãos livres: a bandeira/cartaz é guardada e volta depois). Ritmo humano:
0,65–1,7 s entre golpes (nunca abaixo da recarga), sequência pedindo o soco de novo dentro da janela (o servidor resolve o
combo), esquiva às vezes ao ver o golpe chegar, larga a briga com fôlego no fim (stamina < 12 por 1,5 s) ou condição < 30.
Reação ao ser agredido: revidar (personalidade + pavio), fugir ou reclamar (aponta, recua). Contra HUMANO só com motivo
(ele me agrediu / é o lado do foco porque agrediu) e sem perseguir: humano a > 7 m encerra. Briga vista: observar
(roda a 4,5–8,5 m, celular), fugir (16–30 m, correndo se perto) ou entrar (amigo apanhando pesa `defend`).
Rodada 12 (agente G): adversário CAÍDO ou na proteção de retorno (5 s depois de levantar/aparecer, `combat.json`
`protectMs`) não encerra a briga — quem bateu espera a 1,4 m apontando/chamando e volta a bater; cambalear não é cair;
bate a ≤ alcance do soco + 0,12 m (o recuo do golpe deixava o revide parado a 1,25 m); troca de golpes com mais soco
(74 %) que empurrão/chute (que derrubam); derrubado reage (revida/foge/reclama) AO LEVANTAR; depois de cair, larga a
briga com chance `flee × 0,75 + 0,05` (cauteloso ~73 %, confrontador ~9 %).

### Diretor de eventos (AGENTE E)

A sala chama `dyn.setView(auto)`: `near` (grade de toda a população), `humans`, `propose` e `heat` (combatentes em focos
vivos, multidão, golpes/min). `propose` é aceito/recusado pela personalidade (afinidade × peso − compromisso com o objetivo
atual; fim de foco = sempre aceita). O cérebro LÊ `dyn.roleOf(id)`: ARGUE = discussão (aproxima a 1,4 m, aponta/gesticula,
sem golpe; o objetivo continua SOCIALIZE); FIGHT = empurrão até `pushUntil`, depois golpes; sem papel = acabou;
AVOID_FIGHT/LEAVE_AREA = fuga do ponto dado; TRAVEL com destino (RACE) = corre até lá. HUMANO acertando autônomo →
`dyn.onAggression` (além da derrubada).

### Veículos

12 % têm afinidade (tipo pelos pesos `vehicles.kinds`): numa viagem longa vão a um veículo LIVRE do mundo a ≤ 30 m (os
outros, às vezes, a um a ≤ 12 m) e montam pelo `onEnter` (mesmo `canEnter`); sem veículo do mundo, metade usa o gancho do
veículo PESSOAL do agente B (`r12pv.spawnPersonalVehicle`, só o dono usa). Dirigindo: velocidade por tipo e pessoa, abaixo
de 1,9 m/s com gente à frente (nunca atropela), desce (`onExit`, saída segura) ao chegar.

**Abrir caminho (QA de integração da rodada 12).** No modo pacífico um veículo para antes de encostar em quem está a pé
(`vehicleBlockers` na sala). Com o mundo vivo, os autônomos que dançam em volta do trio (ponto de concentração que anda
junto) o travavam para sempre: no QA, `trio_mp` com 150 autônomos dava 0 m em 7 s. Agora, quando um autônomo bloqueia
um veículo dirigido, a sala chama `AutonomousSystem.makeWay`: ele anda depressa para o lado mais próximo do eixo do
veículo (o outro se houver parede), meia largura + 1,6–2,4 m, fica ali olhando ~2–3,5 s depois de chegar e volta ao
objetivo de antes (não perde o grupo nem a dança). Ninguém é atravessado: o veículo segue bloqueado enquanto alguém está
na frente, então anda como num cortejo. Não abre caminho quem está brigando, caído ou num veículo. Contador
`stats.makeWay`. Resultado: o mesmo trio com 150 autônomos anda 7,3 m em 7 s.
Como o cliente de quem dirige já freia ANTES de encostar (previsão local do modo pacífico), a sala muitas vezes nem
recebe o movimento recusado: por isso o autônomo também percebe sozinho (`lookForDriven`, NEAR, a cada 0,3–0,5 s, sem sorteio — não mexe na sequência aleatória calibrada) um
veículo com motorista HUMANO cuja frente o inclui (até 4,5 m adiante, meia largura + 0,7 m) e abre caminho — no QA a moto
ficava parada 0,1–0,3 m diante de um autônomo. Testes: tests/autonomous.test.ts (pela sala e pela percepção).

**Região da Candelária (20/10/2026, pedido do dono).** O jogo começa em frente à Candelária (`src/world/gameSpawn.ts`:
praça da fachada, no prolongamento do eixo, a ~88 m do centro da igreja, virado para ela) e **95 %** dos autônomos
vivem perto dela (`autonomous.json` → `focus: { share: 0.95, radiusM: 150 }`; centro = igreja). Quem vive no foco
nasce, passeia (WANDER) e viaja (TRAVEL/LEAVE_AREA, faixa do eixo) só a ≤ 150 m; pontos sorteados precisam de linha
livre até a praça da fachada ou o fim da Presidente Vargas (nunca dentro da igreja). Os outros 5 % circulam pela
avenida inteira e são os únicos "trazidos" para perto de um humano que está longe da Candelária. Teste
(tests/candelariaFocus.test.ts, mapa real): ≥ 93 % a ≤ 150 m no início, ≥ 93 % a ≤ 200 m depois de 3 min (os pontos de
concentração do evento ali ficam a 150–180 m), nenhum dentro do prédio. Servidor de teste: só com `PV_FOCUS=1`.

### Nomes

Combinações de `names` (palavra; palavra+sufixo; palavra+número; duas palavras; minúsculas; sublinhado) — nunca série
(números vizinhos na mesma base são recusados, inclusive sufixo numérico), nunca "Bot/NPC/Player+número", ≤ 3 usos da mesma
palavra base, sempre pela moderação de apelido das contas. Reserva: as chaves vivas ficam num registro do processo e o
cadastro/troca de apelido de CONTA recusa (`apelido_em_uso`); ao subir, os apelidos são conferidos no banco
(`profiles.byNicknameKey`) e, ao aparecer, contra quem está na sala. `NetPlayer.tag`: o servidor sorteia por autônomo
1 (sempre com nome, fração `nametag.share`) ou 2 (nunca); humanos 0 (regra do cliente). Alguns (12 %) exibem um TÍTULO
real de recompensa (achievements/missions) e nível coerente.

### Métricas separadas

- Públicas (`/api/metrics/public`, presença): só pessoas — autônomos não são clientes.
- `/metrics`: `players` = conexões de jogo (humanos + bots); à parte `aiMs` (média por tick), `aiMaxMs`, `aiDecideMs`,
  `aiMoveMs`, `aiSocialMs`, `aiDecisionsPerSec`, `autonomousPopulation`, `autonomousActive`, `autonomousNear/Mid/Far/Dormant`.
- Espectador aéreo: autônomos entram nas células como AMBIENTE (`env`), nunca em `players`.
- Denunciar/silenciar pelo nid de um autônomo: `user_report_res {ok:false, r:'autonomo'}` / `chat_mute_denied {reason:'autonomo'}`.
- Missões/progressão/telemetria: eventos de autônomos ignorados (`GameplayBus.ignore`).

### Humanização (docs/bench/round12_humanization.json — `npx tsx server/tools/autonomous_report.ts 100 10`)

100 autônomos, 10 min simulados, 6 pessoas roteirizadas ao longo da avenida, diretor de eventos ligado, provocação humana a
cada minuto e um foco de briga forçado no meio:

| | idle | walk | run | social | event | vehicle | fight | watch | leave |
|---|---|---|---|---|---|---|---|---|---|
| antes (agente C) | 8,7 % | 30,3 % | 0,4 % | 13,1 % | 41,5 % | 5,0 % | ~0 % | 0,1 % | 0,9 % |
| rodada 12 G (100 × 10 min) | 16,8 % | 33,5 % | 0,4 % | 19,4 % | 24,8 % | 3,3 % | 0,2 % | 0,5 % | 1,0 % |
| 180 × 1º 10 min, humanos parados | 16,8 % | 32,8 % | 0,2 % | 20,8 % | 25,5 % | 2,2 % | 0 % | 0,2 % | 1,4 % |
| 180 × 60 min, humanos parados | 15,3 % | 24,0 % | 0,2 % | 24,2 % | 25,9 % | 1,5 % | 0,3 % | 0,6 % | 8,1 % |

(briga e plateia são raras por desenho: 4 brigas/h no teto; 60 min em docs/bench/round12_calibration.json)

Velocidade média andando 1,66 m/s (σ entre pessoas 0,15); 4,1 mudanças de direção > 30°/min andando; 63 % do tempo
parado (rodas, concentrações); trajetos mediana 13 m, p90 61 m; 0,7 desvios/pessoa·min; 0,6 correções de parede por 1000
movimentos; 51 rodas formadas (rumo espalhado 143°); 40 viagens de veículo (~75 s cada).

Padrões robóticos encontrados e CORRIGIDOS: (1) viagem pelo eixo "esfregando" obstáculo (50 correções/1000 movimentos) →
troca de faixa + contorno; (2) gente parada empurrando parede para chegar ao lugar → desiste do alvo após 4 correções
(510 → 89 correções em 10 min); (3) sobe/desce de veículo a cada decisão (339 viagens de ~6 s) → segue até o destino;
(4) agredido ignorava o ataque se tinha objetivo do diretor → reação pessoal imediata; (5) combo pedido pelo id da
sequência (negado) → pede o soco de novo na janela; (6) golpe com bandeira na mão (negado `sem_item`) → guarda o item;
(7) todos começando a andar juntos ao aparecer → primeira decisão espalhada (0,15–4,5 s); continua um pico de 11
inícios no 1º segundo (aquecimento), ≤ 4 depois.

### Custo (docs/bench/round12_autonomous.json — `npx tsx server/tools/autonomous_bench.ts 20`)

Sala real no mesmo processo + 1 pessoa + 8 bots de carga espalhados (AOI/patches reais), média por tick de 100 ms:

| autônomos | ativos (NEAR/MID/FAR) | aiMs | aiMaxMs | decisões/s | tick total | patch |
|---|---|---|---|---|---|---|
| 50 | 50 (18/32/0) | 0,45 | 1,27 | 26 | 0,79 ms | 0,14 ms |
| 100 | 100 (46/54/0) | 0,71 | 1,97 | 53 | 1,12 ms | 0,13 ms |
| 250 | 204 (80/120/4) | 1,18 | 2,63 | 101 | 1,79 ms | 0,15 ms |

Só o sistema (SimHost): 0,11 / 0,13 / 0,26 ms por tick. O grosso é o caminho de movimento do jogador (`onMove`), que é
justamente o que garante as mesmas regras. Os orçamentos dos dados (NEAR 80, MID 120, ativos 220) ficam em ~1 % do tick.

### Testes

`tests/autonomous.test.ts` (SimHost: kind, nomes, reserva, decisões distribuídas, LOD/orçamentos, população alvo,
steering, rodas, reação a pessoa, `propose` por personalidade e recusa contra humano sem motivo, veículo por entrar/sair,
confronto sem spam e com pausa, `heat`, agressão humana sem perseguição, humanização no mundo real) e
`tests/autonomousServer.test.ts` (sala real: kind 0/1/2 no cliente, métricas públicas e /metrics, denúncia/silenciar
recusados, apelido reservado, missões, diretor ligado, veículo do mundo e briga pelo CombatSystem).
QA: `tools/qa/autonomous_mp.mjs` → docs/screenshots/round12/ A_avenida_populacao, D_grupo_social, E..H_torcedores_<id dos
dados>, X_veiculos_autonomos, Y_visao_aerea; resumo docs/bench/round12_autonomous_qa.json.

### NPCs locais do cliente — regra da população dupla (rodada 12, agente G)

Pedestres (`PedestrianSystem`) e multidão de concentração (`RallyCrowd`) são simulados só no cliente (cada jogador vê os
seus); autônomos são do servidor (todos veem os mesmos). Perto de autônomos, gente local vira "fantasma". Regra
(`src/npc/localPopulation.ts`, números em `autonomous.json` `localPopulation`, aplicada a ~2 Hz pelo `Game`):

- **pedestres**: com `autoNear` autônomos (remotos kind 1 + multidão distante `npc`) a ≤ 80 m do jogador, limite =
  preset até 4 autônomos, caindo linear até 4 pedestres com ≥ 24; com > 4 autônomos, pedestres locais só NASCEM a ≥ 45 m
  (fundo); quem passou do limite só some fora da vista ou a > 45 m (ninguém some na frente da câmera);
- **concentração**: ponto com ≥ 6 autônomos a ≤ raio + 10 m perde os NPCs locais (voltam com ≤ 2 — histerese); ponto
  de concentração DINÂMICA do servidor (`evt_pts` `dyn_…`) nunca recebe NPC local (é feito de autônomos);
- **sem autônomos** (PV_AUTONOMOUS=0, dormentes, servidor antigo): tudo como antes — a avenida nunca fica vazia.

Teste: `tests/localPopulation.test.ts`.

## Cliente

Os autônomos chegam ao cliente pelo MESMO caminho dos jogadores remotos (`state.players` → `NetworkClient` →
`CrowdDirector`/`AvatarVisual`); o cliente só os distingue por `NetPlayer.kind` (src/world/entityKind.ts), lido de forma
tolerante (ausente = 0 = humano). Nada aqui decide comportamento — só como a pessoa é mostrada, e sempre barato em escala.

### Contrato esperado do servidor (campos tolerantes)

| Campo | Uso no cliente | Ausente |
|---|---|---|
| `NetPlayer.kind` (u8) | 1 = autônomo: regras de nome, painel sem moderação, fora da contagem pública | humano |
| `NetPlayer.look` (u16) | nid do alvo para cabeça/tronco (pessoa; numa briga, o oponente) | olhar livre |
| `NetPlayer.tag` (u8) | 1 = sempre com nome · 2 = sem nome · 0 = regra do cliente (o servidor manda 1/2 para cada autônomo) | regra do cliente |
| mensagem `crowd`, bit 6 das flags | não humano na multidão distante (src/net/crowdCodec.ts `npc`) | humano |
| mensagem `dyn` (AGENTE E, `DynamicSignalWire`) | focos do diretor de eventos → minimapa e áudio (src/events/dynamicPresentation.ts) | nada |

O bit 6 já é preenchido pela sala (`crowdTable.set(..., npc: p.kind !== 0)`); se os autônomos forem codificados por
outro caminho, basta passar `npc: true`.

### Nomes (src/net/nameLod.ts, src/net/NameTagPool.ts)

- **Parte sem nome**: autônomo tem nome se `autonomousTagged(nid, share)` (hash determinístico do nid; `share` =
  `public/gameplay/autonomous.json` → `nametag.share`, padrão 0,6), a menos que o servidor mande `tag`. Sem nome = nunca
  mostra rótulo (o realce do cursor ainda diz o apelido, e o painel também).
- **Faixas**: completo até `nametag.nearM` (18 m), faixa média até `nametag.midM` (35 m), nada além. Humanos seguem
  15 / 30 / 50 m. Faixa média lotada (> 8 candidatos) → só o centro da tela, quem está interagindo ou em foco.
- **Foco**: pessoa sob o cursor ou aberta no painel → apelido completo e prioridade alta.
- **Oclusão**: raio câmera → cabeça contra as paredes ≥ 3 m do mundo de colisão (prédios; gradil/mureta não contam),
  amostrado: no máximo 8 raios novos por decisão, resultado válido por 400 ms, ocluir exige 2 bloqueios seguidos.
- **Pool fixo**: 18 nós DOM no total (teto de 14 visíveis + folga), emprestados a quem a decisão escolhe — antes era
  um nó por remoto detalhado.

### Animação (src/characters/crowd/animVariety.ts)

Semente estável por pessoa (`personSeed(nid)`) → fase inicial dos ciclos, passada (cadência ±6 %), andamento do parado
(±10 %), deslocamento e andamento (±4 %) das ações em laço. Vale nos dois desenhos:

- **Esqueleto** (`HumanAnimator.setVariant`, chamado ao ganhar esqueleto): além do balanço da rodada 9.1 (troca de
  peso, tronco, olhar em volta), joelho da perna livre, braços (mais junto/afastado, mão à frente), olhada de lado
  curta a cada 7–16 s e inclinação própria da cabeça.
- **Instanciado (VAT)**: `CrowdAgent.seed` → fase, cadência e deslocamento das ações por instância
  (`CrowdRenderer`), sem custo de GPU extra.

100 pessoas que recebem "bater palmas" no mesmo tick (e com a mesma variação) ficam espalhadas pelo ciclo. Sonda
(`tools/qa/humanization_probe.mjs`, 5 min, 120 pessoas, `--sync-clap=20`: até 48 inícios no MESMO instante do
servidor): entre quem toca a mesma ação em laço, vetor médio circular **R 0,994 → 0,138** e maior fração "no mesmo
quadro" (1/30 do ciclo) **97,6 % → 14 %** (pior amostra 100 % → 23 %); viradas > 30° na mesma amostra de 200 ms: máx.
3 (antes 5). GIF/quadros em docs/screenshots/round12/qa_video/.

### Olhar (HumanAnimator.setLook / lookAngles)

`look` (nid) é resolvido LOCALMENTE (remoto detalhado, o próprio jogador, multidão distante) e vira um ponto de
mundo; o animador distribui o giro por tronco alto (20 %), pescoço (35 %) e cabeça (45 %), limitado a ±70° de giro e
±25° de inclinação, solta o alvo atrás das costas (> 115°), suaviza (constante ~0,17 s) e cede 60 % à ação de corpo
inteiro. Só para quem está a < 22 m, com esqueleto no LOD ≤ 1, a pé e de pé.

### Painel da pessoa (src/ui/PersonPanel.ts)

Autônomo: apelido, título (quando houver) e torcida; VER PERFIL e INTERAGIR. Sem SILENCIAR/DENUNCIAR (não há chat
nem conta) e sem nível. Nunca diz "bot"/"NPC" nem afirma que é humano (teste em `tests/populationPresentation.test.ts`).

### Contagem pública

Só humanos: as métricas da home vêm do servidor (presença por CLIENTE — autônomos não são clientes); o telão "N
pessoas na avenida" usa `NetworkClient.humanCount` (remotos kind 0 + multidão distante sem o bit 6). O texto do
espectador no alto usa `spec_cells.players` do servidor — os autônomos devem entrar como `env` (ambiente), não em
`players`, no `CrowdCellAggregator`.

### Minimapa e áudio

Autônomos entram no calor da densidade e na multidão agregada do áudio como qualquer agente (nunca ponto/voz por
pessoa). Focos do diretor (`dyn`) viram UMA marca agregada por foco e calor de multidão/comemoração/confronto
na célula do áudio — ver docs/HUD.md e docs/AUDIO_SYSTEM.md (rodada 12).

### QA (servidor de teste)

- `PV_TEST=1 PV_QA_BOT_KIND=1`: bots de carga entram como `kind = 1` (produção: bots = `LOAD_BOT`).
- `server/tools/bots.ts --names` (apelidos do autonomous.json) e `--sync-clap=S` (todos batem palma juntos).
- `window.__pvR12`: `labels()`, `labelDebug()`, `people()`, `sample()`, `lookAtMe()`, `look(fn)`, `dyn(lista)`,
  `lookStats()`, `netMs()`, `humans()`; `?r12var=0` desliga a individualidade dos remotos (comparação).
- `tools/qa/humanization_probe.mjs`, `tools/qa/nametag_bench.mjs`, `tools/qa/nametag_synth.ts`,
  `tools/qa/round12_people_shots.mjs`.
