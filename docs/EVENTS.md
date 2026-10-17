# Plataforma de eventos

A Presidente Vargas é uma **plataforma de eventos**, não um jogo de um tema só. O mesmo mundo recebe um dia
comum, um clássico de futebol, um ato, um encontro ou um show. **Nenhuma lógica de tema fica no código**:
tudo vem de dados. Um teste automatizado (`tests/events.test.ts`) falha se nomes de clubes ou políticos
aparecerem em `src/`.

## Conceitos (`src/events/types.ts`)
| Conceito | Para que serve |
|---|---|
| `EventDef` | o evento: nome, categoria livre, política de interação, e todos os itens abaixo |
| `Team` | time de um confronto (cores, escudo opcional) |
| `Group` | grupo de participantes (torcida, coletivo, convidados); pode ligar-se a um `Team`; `npcShare` veste parte dos NPCs |
| `AvatarOption` | avatares disponíveis no evento (sobre os corpos base: homem, mulher, idoso, idosa) |
| `Cosmetic` | roupa/acessório (futuramente vendável; nunca dá vantagem) |
| `WorldDecoration` | banners/bandeiras nos postes da avenida, com cores do evento |
| `BillboardPlan` / `BillboardContent` | conteúdo dos painéis de LED: texto gerado, imagem ou vídeo por URL; por zona, por painel ou em playlist |
| `VehicleOption` | veículos utilizáveis no evento (bicicleta, patinete; carro depois) |

## Como trocar o evento
- Por URL: `http://localhost:5173/?event=classico-exemplo` (arquivos em `public/events/`).
- Padrão: `public/events/index.json` → `"default"`.
- Futuro: o servidor define o evento ativo da sala (o campo `eventId` já existe no estado da sala).

Exemplos incluídos (genéricos, de propósito):
- `cotidiano`: dia comum, modo pacífico, painéis com "espaço publicitário disponível".
- `classico-exemplo`: dois times genéricos (Time A × Time B), banners nas cores, torcidas como grupos, interação opcional.
- `encontro-exemplo`: encontro/ato neutro, bandeiras, painéis com a programação.

> **Marcas e licenças:** nomes oficiais, escudos e cores registradas de clubes, ou imagens de pessoas reais, só
> devem ser cadastrados por quem tiver o direito de usá-los. A plataforma não embute nenhum.

## Painéis de LED
- **Locais:** o pipeline (`tools/build_world.ts`) escolhe 28 fachadas altas (≥ 28 m) voltadas para a avenida, perto dos
  grandes cruzamentos (Pres. Vargas × Passos, Uruguaiana, Rio Branco, 1º de Março, Tomé de Sousa). Fica no máximo 1 por prédio,
  com espaçamento ≥ 45 m e base acima de 8 m: efeito de "mídia urbana" sem cobrir a arquitetura.
- **Conteúdo em runtime:** `BillboardSystem.setPanelContent(id | '*', content)`. Exposto em `window.__pv.billboard(...)`
  para testes; o backend usará a mesma API (agenda de anúncios). Painéis com o mesmo conteúdo compartilham textura.
- `?event=` define a playlist; cada painel começa num item diferente da playlist.
- **Não há venda de publicidade implementada.**

## Eventos agendados (rodada 9) — agenda dentro do mundo
O evento do mundo (`EventDef`) ganha uma **agenda** (`agenda: ScheduledEventDef[]`, `src/events/schedule.ts`): atividades
que acontecem no MESMO mundo, recorrentes, no relógio do **servidor**. Mesmo modelo para todas; a lógica de cada
formato fica num *runner* (`server/src/events/runners.ts`), nunca em `if (evento === …)`.

| formato | runner | o que o servidor decide |
|---|---|---|
| `caminhada` | `WalkRunner` | líder virtual andando pela rota a `paceMs`; participação por acompanhar (docs/MANIFESTATION_SYSTEM.md) |
| `corrida` | `RaceRunner` | largada, checkpoints em ordem, voltas, posição, tempo, DQ (docs/RACES.md) — bicicleta e patinete |
| `confronto_grupos` | `ClashRunner` | grupos permitidos, zonas, pontos (área + derrubadas no evento), retorno protegido |
| `debate` | (agente E) | palco em texto — implementa a mesma interface `EventRunner` |

**Recorrência** (`src/events/recurrence.ts`): ocorrência k começa (ACTIVE) em `epoch + offsetMin + k × everyMin`;
a contagem (STARTING) dura `startingS` antes e a inscrição (REGISTRATION) abre `registrationMin` antes da contagem;
termina `durationMin` depois. `startAt`/`endAt` (ISO) limitam a janela. Instância = `"<id>@<início ms>"`.

**Estados** (`server/src/events/EventRuntime.ts`, sem Colyseus): `SCHEDULED → REGISTRATION → STARTING → ACTIVE →
FINISHED`; `CANCELLED` quando, no início, há menos inscritos (humanos) que `minParticipants` (0 = acontece mesmo vazio
— NPCs simulados mantêm vivo). O runner pode encerrar antes (`ctx.finish()`: todos chegaram, líder chegou).

**Inscrição** (`evt_join {inst}` / `evt_leave {inst}` → `evt_res {inst, ok, r?}`): aberta em REGISTRATION/STARTING
(e em ACTIVE se o formato aceita entrada tardia: caminhada, confronto); capacidade (`lotado`), regras de grupo
(`groupRules.allowed`, só por chave e igualdade → `grupo`), uma inscrição viva por jogador (`ja_inscrito`),
capacidade `event.join` da política de acesso (`sem_permissao`) e a regra do formato (corrida: `veiculo`).
`evt_watch {inst, on}` acompanha sem se inscrever (marcadores, placar, resultado) — espectadores também.

**Graça de reconexão**: caiu e está em graça (entidade congelada) → a inscrição continua; só a saída de vez (graça
vencida, saída, sessão substituída — `onLeave` da sala) desiste (`forfeit`: corrida vira DNF).

**Mensagens** (servidor → cliente): `agenda {list: AgendaEntry[]}` ao entrar e quando muda (≤ 1 Hz; `count` = humanos
inscritos; `joined` = o próprio); `evt_pts {list}` — concentrações dos eventos vivos (líder da caminhada, torcida da
corrida) ≤ 1 Hz e só quando muda; `race`, `race_def`, `race_board`, `walk`, `clash`, `evt_result`, `evt_done`.
O cliente (`src/events/EventClient.ts`) só exibe e pede — nunca informa checkpoint, chegada ou participação.

**Gameplay** (`src/gameplay/events.ts`, barramento `room.gameplay`): `event_join` ao inscrever, `event_complete`
(participação concluída; recompensa é por isso, nunca por golpe), `race_finish {raceId, vehicle, rank, timeMs}`.

**Confronto** (agente A): `room.evt.combatEventFor(sid)` → `CombatEventRules` da instância de confronto ATIVA em que o
jogador está inscrito (`friendlyFire` dos dados, padrão false); `room.evt.zonePolicy(zone)` → `combatPolicy` do evento
ativo nas suas zonas (ex.: `CONTESTED`); `room.evt.protectedUntil(sid)` → proteção de retorno; `room.evt.onKnockdown(a, b)`
→ pontuação do confronto (a sala já chama no `knockdown` atual).

**Na sala** (`server/src/PresidenteVargasRoom.ts`): um bloco `// rodada 9 — eventos` (`setupEvents`: adaptador
`EventHost`, mensagens) e ganchos de uma linha em `tick`, `onMove` (posição ACEITA), `onJoin` (`hello`), `onLeave`
(`gone`), `knockdown` e `environment()` (células do espectador).

**Teste/QA**: com `PV_TEST=1`, `PV_AGENDA_FILE=<json>` troca a agenda por um arquivo; `PV_AGENDA_EPOCH=<ms|now>`
desloca a origem (ocorrência 0 no horário pedido). `tools/qa/events_mp.mjs` usa a agenda DOS DADOS com horários
encurtados.

Agenda incluída: `manifestacao` — caminhada Central → Candelária (a cada 60 min), corridas de bicicleta e de patinete
na Cidade Nova (a cada 30 min); `cotidiano` — as duas corridas; `encontro-exemplo` — caminhada; `classico-exemplo` —
desafio das torcidas no Campo de Santana (confronto, `CONTESTED`, fogo amigo desligado) e corrida de bicicleta.
