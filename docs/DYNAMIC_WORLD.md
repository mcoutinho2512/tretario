# Mundo dinâmico (rodada 12)

Eventos que **nascem do estado do mundo**, não da agenda: concentração, caminhada, manifestação, encontro de torcidas,
festa, corrida improvisada, discussão, briga e briga generalizada. Sem LLM, sem chat automático, sem trânsito, sem
multidão pronta: toda multidão é feita de quem **já estava por perto**.

| Peça | Arquivo |
|---|---|
| Diretor (sem Colyseus) | `server/src/world/DynamicWorldDirector.ts` |
| Dados (frequência, escalada, reações, sinais) | `public/gameplay/dynamic_world.json` → `server/src/world/dynamicConfig.ts` |
| Contrato com os autônomos | `server/src/autonomous/types.ts` (`AutonomousWorldView`, `Goal`, `Escalation`, `DynamicEventKind`, `DynamicEventState`) |
| Dublê do mundo (testes/medição) | `server/src/world/SimWorldView.ts` |
| Protocolo do sinal `dyn` | `src/events/schedule.ts` (`DynamicSignalWire`, `DynamicSignalsMessage`) |
| Cliente (guarda os sinais) | `src/events/EventClient.ts` (`dyn`, `onDyn`) |
| Testes | `tests/dynamicWorld.test.ts` (WorldView simulada), `tests/dynamicWorldServer.test.ts` (sala real) |
| QA | `tools/qa/dynamic_world_mp.mjs` → `docs/screenshots/round12/Q…W`, `docs/bench/round12_dynamic_world.json` |

## Arquitetura

- O diretor **lê** a `AutonomousWorldView` (implementada pelo sistema de autônomos — AGENTE C) e **propõe** objetivos
  (`view.propose(id, goal, peso)`); o cérebro de cada autônomo aceita conforme a personalidade. O diretor nunca move,
  nunca bate e nunca cria ninguém.
- **Ritmo lento e distribuído**: ~2 **sondas**/s (`director.probesPerS`) em pontos perto dos humanos (75%, até 70 m) ou do
  eixo da avenida; cada evento vivo é reavaliado a ~1 Hz (focos de briga a ~1,25 Hz), cada um com fase própria. Uma sonda =
  uma `near()` com raio 22 m; uma avaliação = uma `near()` (+ `heat()` nos focos de briga).
- **Integração ao EventSystem existente (sem agenda paralela)**: a sala liga o diretor ao `EventRuntime` pelos ganchos do
  `EventHost` — `extraAgenda` (entradas `format: 'dinamico'`, estado `ACTIVE` → "Acontecendo agora" e tela AGENDA, sem
  botão de inscrição: participar é ir até lá) e `extraRallies` (concentrações no **mesmo** `evt_pts` → minimapa e
  RallyPoint, `crowd: 0`: nenhum NPC reservado). Os sinais de áudio/HUD vão numa mensagem leve nova, `dyn`.
- Na sala (`server/src/PresidenteVargasRoom.ts`): `setupDynamicWorld` (antes do runtime), `this.dyn.tick(now)` no tick de
  10 Hz, `dyn.hello` 1,5 s depois da entrada, `qa_dyn` (só PV_TEST) e `dyn.onAggression` quando um HUMANO derruba um
  AUTÔNOMO. A WorldView começa vazia (`EMPTY_WORLD_VIEW`); o sistema de autônomos liga a real com `room.dyn.setView(view)`
  (marcado `// rodada 12 — ligar à WorldView do AGENTE C`).

### Papel de cada autônomo (contrato para o cérebro)

`director.roleOf(id)` → `{ eventId, role, side, opponent?, pushUntil?, since, sup, group?, personality }`:

| Papel | Objetivo proposto | O que o cérebro faz |
|---|---|---|
| `CORE` / `JOIN` | `JOIN_CROWD` · `MEET_GROUP` (tem amigo lá) · `FOLLOW_SUPPORTERS` (mesma torcida da maioria) · `FOLLOW_EVENT` (caminhada) | ir até o ponto e ficar (conversar, aplaudir, dançar — ações sociais/props existentes) |
| `WATCH` | `WATCH_EVENT` / `WATCH_FIGHT` | olhar de perto (distância segura), reagir com gestos |
| `ARGUE` | `SOCIALIZE` com `target` = oponente | **discussão**: aproximar, gesticular (gestos existentes), sem golpe |
| `FIGHT` | `JOIN_FIGHT` com `target` | **briga** pelo CombatSystem: só empurrão até `pushUntil` (3 s), depois soco; larga quando cansar (stamina) |
| `RACE` | `TRAVEL` até o destino | correr (a pé ou no veículo que já usa) |
| fuga | `AVOID_FIGHT` / `LEAVE_AREA` | afastar-se (sem papel: deixa o evento) |

O cérebro **pode recusar** (`propose` → `false`). Largar o objetivo (`WANDER`, `TRAVEL`, `LEAVE_AREA`, `AVOID_FIGHT`,
`USE_VEHICLE`; ou, na briga, qualquer coisa que não seja `JOIN_FIGHT`) = sair do evento. É assim que o **cansaço**
desescala uma briga.

## Tipos de evento

| Tipo | Nasce de | Cresce/vive | Termina |
|---|---|---|---|
| CONCENTRACAO | sonda acha ≥ `coreMin` (3) livres sociáveis a ≤ 10 m; chance `seedChance` (0,12) | núcleo de no máx. 5 → convites a quem está a ≤ 45 m: ≤ `invitePerEval` (2) por avaliação, chance = `attract[personalidade]` (× 1,6 se mesma torcida da maioria); parte vira observador (`watchShare`) | cresce 90–240 s → pico 60–180 s (convites a ¼) → esvazia 60–150 s (12% saem por avaliação) → fim com ≤ 2 |
| MANIFESTACAO | concentração com ≥ 10 chegados e ≥ 35% MANIFESTANTE | idem | idem |
| CAMINHADA | manifestação no pico (chance 0,35) | o centro anda pelo eixo (1,1 m/s, 180–420 m); a cada avaliação ~¼ recebe `FOLLOW_EVENT` (rodízio) | chegada → esvazia |
| ENCONTRO_TORCIDAS | concentração com ≥ 2 torcidas DIFERENTES com ≥ 3 cada | idem; chance `tensionPerMin` (0,12/min) de uma DISCUSSÃO entre torcedores de torcidas diferentes (ainda sujeita ao temperamento e ao orçamento) | idem |
| FESTA | ≥ 8 chegados, uma torcida com ≥ 60% ou ≥ 50% SOCIAL/TORCEDOR | idem (comemoração: `cheering` máximo) | idem |
| CORRIDA_IMPROVISADA | ≥ 2 livres EXPLORADOR/AGITADO/… (`racer` ≥ 0,5); chance 0,04 | `TRAVEL` a 150–260 m pelo eixo; quem está a ≤ 30 m pode assistir | chegada de alguém, 120 s ou ninguém |
| DISCUSSAO / BRIGA / BRIGA_GENERALIZADA | foco de briga (abaixo) | escalada | dispersão |

Reclassificação com **histerese**: o tipo novo precisa se manter 4 avaliações seguidas e nunca volta a CONCENTRACAO.

## Escalada (CALMO → TENSÃO → CONFRONTO → GENERALIZADO)

Um nível por vez, com tempo mínimo em cada; nunca pula.

1. **TENSÃO — DISCUSSAO** (2 pessoas a ≤ 6 m). Chance por sonda = `seedChance` (0,01) × média do `temper` das duas
   personalidades × `differentSupMult` (1,8) se forem de torcidas **diferentes** × `heatMult` (1,5) se já há briga perto.
   Ambas precisam aceitar `SOCIALIZE`. Observadores: ≤ 1 decisão por avaliação (sem adesão).
   Depois de `tension.minS` (6 s), por avaliação: escala com `escalateChance` (0,18) × temperamento × rivalidade (ou
   na hora se alguém já bateu — `heat.hitsPerMin > 0`), ou acalma com `calmChance` (0,1) × (1,2 − temperamento); em
   `maxS` (25 s) acalma → fim.
2. **CONFRONTO — BRIGA**. Os dois recebem `JOIN_FIGHT` (empurrão nos primeiros 3 s, soco depois); quem recusa se afasta.
   Por avaliação, ≤ 3 pessoas a ≤ 18 m decidem **uma** reação pelos pesos da personalidade (`conflict.reactions`):
   **entrar** (amigo — mesmo grupo ou mesma torcida de um lado — × 2,5; estranho × 0,35), **olhar** (`WATCH_FIGHT`),
   **fugir** (`AVOID_FIGHT`) ou **ignorar** (nenhuma proposta). No máximo **1 adesão por avaliação**; o excedente fica
   olhando. Quem já decidiu não é perguntado de novo.
3. **GENERALIZADO — BRIGA_GENERALIZADA**: só quando ≥ `generalizeAt` (6) estão brigando **por adesão** e depois de
   `fight.minS` (8 s). Raio 28 m, ≤ 4 decisões e **≤ 2 adesões por avaliação**, teto `maxFighters` (30). Nunca "2 → 50".
4. **Desescalada natural**: quem cansa larga `JOIN_FIGHT` e sai da conta; GENERALIZADO com < 3 volta a CONFRONTO; com
   < 2 ou no tempo máximo (`fight.maxS` 50 s, `general.maxS` 120 s) começa a **dispersão**: um nível a menos a cada 4 s,
   3 pessoas por avaliação recebem `LEAVE_AREA`/`WANDER`; termina em CALMO sem ninguém. O tipo fica como o máximo
   alcançado (uma BRIGA que se dispersa continua BRIGA; o nível desce).

**Humanos**: nunca recebem proposta e nunca são escolhidos como alvo. Só viram lado de um foco se **agredirem** um
autônomo (`onAggression`, chamado quando um humano derruba um autônomo — o sistema de autônomos pode chamar também em
golpe/empurrão): o alvo reage pela personalidade (revidar pesa × 2,5; fugir; ignorar). Revidar abre uma DISCUSSÃO com o
humano como lado 1 (tempo mínimo 1,5 s); bater de novo escala. Intervalo de 20 s por humano; não gasta o orçamento
espontâneo (a generalizada ainda gasta).

## Orçamento e frequência (`budget`)

| | teto/h | simultâneos | intervalo global | por região (grade de 80 m) | distância mínima |
|---|---|---|---|---|---|
| reuniões (todas) | 14 | 4 | — | 240 s | 55 m |
| corrida improvisada | 3 | 1 | — | 600 s | — |
| DISCUSSAO (início de foco) | 10 | 2 | 150 s | 600 s | 40 m |
| BRIGA (subida a CONFRONTO) | 4 | — | — | — | — |
| BRIGA_GENERALIZADA | 1 | — | — | — | — |

Sem orçamento para subir, a discussão não escala (acalma). Medido em 1 h simulada com 250 autônomos esquentados
(`tests/dynamicWorld.test.ts`): inícios dentro dos tetos e ≥ 150 s entre focos — nunca "uma briga por minuto". Mudar o
JSON muda a frequência (o teste com teto 2/h confirma).

## Torcidas e neutralidade

A única leitura de torcida é **igualdade** do índice `sup` (0 = sem torcida). Pessoas de torcidas **diferentes** só
**multiplicam a chance** de tensão (`differentSupMult`) e o encontro de torcidas só tem chance por minuto de uma
discussão — nunca combate automático; cada foco nasce como DISCUSSÃO. Mesma torcida/grupo = "amigo" (entra mais numa
briga do seu lado), para qualquer torcida. Teste: permutar os índices de torcida dá **exatamente** a mesma história.

## Sinais para áudio e HUD — mensagem `dyn`

Servidor → todas as conexões, `{ list: DynamicSignalWire[] }`, ≤ 1 Hz e só quando muda; também 1,5 s depois da entrada.

```ts
{ id: 'dyn12', k: 'BRIGA', x: -812, z: 377, r: 12, e: 2, n: 5, w: 9, ci: 0.35, ch: 0.27, cb: 0.62 }
```

| campo | significado |
|---|---|
| `k` | tipo (`DynamicEventKind`) |
| `x`,`z`,`r` | centro e raio (m, inteiros) |
| `e` | escalada 0 CALMO · 1 TENSÃO · 2 CONFRONTO · 3 GENERALIZADO (reuniões: 0) |
| `n` / `w` | participantes / observadores (autônomos + humano agressor; nunca "jogadores online") |
| `ci` | intensidade da multidão 0..1 = (n + w) / `signals.crowdFull` (40) |
| `ch` | torcida/aplauso 0..1 = `signals.cheer[k]` × min(1, gente/10) (briga: só os observadores) |
| `cb` | confronto 0..1 = max(piso do nível — 0,15/0,45/0,75 —, combatentes/12 + golpes por min/120); reuniões 0 |

No cliente: `EventClient.dyn` (lista atual) e `onDyn` (AGENTE D liga ao áudio e ao minimapa). As reuniões já aparecem no
minimapa pelo `evt_pts` (rótulo do tipo) e no "Acontecendo agora" pela agenda quando têm ≥ `presentation.agendaMin` (6)
participantes; dos focos de briga só a BRIGA_GENERALIZADA entra na agenda (`presentation.agenda`).

## Forçar eventos (QA, só servidor de teste)

`qa_dyn { kind, x?, z?, ack? }` (PV_TEST=1; produção ignora): `kind` ∈ CONCENTRACAO, CAMINHADA, MANIFESTACAO,
ENCONTRO_TORCIDAS, FESTA, CORRIDA_IMPROVISADA, DISCUSSAO, BRIGA, BRIGA_GENERALIZADA; posição padrão = a de quem pede;
`ack: true` responde `qa_dyn_res {ok, id}`. Forçado ignora orçamento/cooldown mas a dinâmica é a mesma: reuniões crescem
por convite; BRIGA e BRIGA_GENERALIZADA passam por TENSÃO → CONFRONTO (→ GENERALIZADO) em ordem, 3× mais rápido
(`qa.forcedSpeedup`), com adesões graduais; vive pelo menos `qa.forcedMinS` (60 s). Sem ninguém por perto o foco é
**fantasma** (`n = 0`): os níveis andam por tempo, só para testar o caminho dos sinais.

No navegador (QA): `window.__pvInv.send('qa_dyn', { kind: 'BRIGA', x, z })`; sinais em `window.__pvEvents.dyn`.

Roteiro: `PV_API=http://127.0.0.1:4561 npx vite --port 5225 --strictPort` → `PV_DYN_PORT=4560 node tools/qa/dynamic_world_mp.mjs http://localhost:5225`
(cenas Q_concentracao, R_caminhada, S_discussao, T_pequena_briga, U_multidao_observando, V_briga_generalizada,
W_pessoas_fugindo). **Antes da integração com o AGENTE C** a WorldView é vazia: as capturas mostram HUD ("Acontecendo
agora"), minimapa e o ambiente; o roteiro valida servidor → `dyn`/agenda/`evt_pts` → cliente (9/9). Depois da
integração o mesmo roteiro filma os autônomos.

## Custo medido

`DynamicWorldDirector.stats` (`msTotal`, `msMax`, `evals`, `probes`, `nearCalls`) e `avgMs`. Com a WorldView simulada
(`near()` por força bruta — a real usa a grade espacial), 10 min simulados, na máquina de desenvolvimento:

| autônomos | ms/tick (média) | ms por avaliação/sonda | pior tick | near()/min |
|---|---|---|---|---|
| 250 | 0,004 | 0,011 | 0,38 | ~230 |
| 1000 | 0,010 | 0,019 | 0,17 | ~310 |

O teste exige < 0,5 ms/tick e < 1 ms por avaliação com 250.

## Dados (`public/gameplay/dynamic_world.json`)

Seções: `director` (ritmo), `regions`, `budget`, `gathering`, `race`, `conflict` (temperamento, chances, níveis,
reações por personalidade, amigo/estranho, provocação), `signals`, `presentation` (rótulos, quem entra na agenda/minimapa),
`qa`. Leitura tolerante: chave ausente = padrão, número preso em [0, 10⁶], tipo errado ignorado; o teste garante que o
arquivo tem exatamente a forma dos padrões.
