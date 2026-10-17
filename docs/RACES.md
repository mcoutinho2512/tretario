# Corridas de bicicleta e de patinete (rodada 9)

Corrida é um formato de evento agendado (`format: "corrida"`, docs/EVENTS.md). **Um runner só** para os dois veículos
(`server/src/events/RaceRunner.ts`); o veículo vem dos dados (`RaceSpec.vehicle: "bicycle" | "scooter"`). Não há
corrida de carro nem de moto. Os tetos de velocidade continuam os de sempre (`src/net/protocol.ts MAX_SPEED`:
bicicleta 7,3 m/s ≈ 25 km/h, patinete 5,9 m/s ≈ 20 km/h) — nenhuma exceção para eventos.

## Dados (`public/events/<evento>.json` → `agenda[]`)
```json
{ "id": "corrida-bicicleta-cidade-nova", "format": "corrida", "zones": ["CIDADE_NOVA"],
  "recurrence": { "everyMin": 30, "offsetMin": 10, "registrationMin": 5, "startingS": 20, "durationMin": 8 },
  "capacity": 12, "minParticipants": 1, "npcCrowd": 40,
  "race": { "vehicle": "bicycle", "laps": 2, "timeLimitS": 420,
    "start": { "id": "largada", "at": { "t": 0.03, "side": 0 }, "radius": 9 },
    "checkpoints": [ { "id": "cp1", "at": { "t": 0.06, "side": 10 }, "radius": 8 }, "…" ],
    "watchArea": { "t": 0.036, "side": 24 } } }
```
Pontos em fração do eixo da avenida (`{t, side}`; `side` em metros, + = lado norte) ou `{x, z}`. As rotas incluídas
usam as **pistas laterais da Cidade Nova** (t 0,03–0,16, ±10 m do eixo), fora do trecho dos pedestres e das
concentrações (que começa na Central, t 0,18): a de bicicleta é um circuito de ~560 m (7 checkpoints, meia-volta em
t 0,16), a de patinete ~390 m (5 checkpoints). Todos os segmentos foram conferidos contra a colisão do mundo.

## Regras (servidor)
| etapa | regra |
|---|---|
| inscrição | REGISTRATION/STARTING; **montado** num veículo do tipo da corrida (estado do servidor, `NetPlayer.vehicle`) → senão `veiculo`; capacidade, uma inscrição por jogador |
| largada | STARTING = contagem (`startingS`); `race_def` (largada, checkpoints, grade de largada **indicativa**: ninguém é teleportado) aos inscritos e a quem acompanha (`evt_watch`) |
| progresso | cada movimento ACEITO pela validação do servidor (`onMove`, posição final já presa a MAX_SPEED e às paredes) é testado contra o **próximo** checkpoint: segmento entre o movimento anterior e o atual × raio do checkpoint. Passar por outro checkpoint não conta (pular é inválido); a pé ou em outro veículo não avança |
| voltas / chegada | `laps` × checkpoints, depois cruzar a largada |
| anti-trapaça | salto entre dois movimentos aceitos maior que `teto × dt × 1,35 + 0,6 + 6 m` → **DQ `teleporte`** (só acontece por reposicionamento fora do movimento); mais de 6 correções `too_fast` na prova → **DQ `correcoes`** (cliente forçando posição); tempo-limite `timeLimitS` → **DNF `tempo`**; sair do mundo (graça vencida) → DNF `saiu` |
| resultado | posição e tempo pelo relógio do servidor; chegou → `race_finish {raceId, vehicle, rank, timeMs}` + `event_complete`; `evt_result` com a classificação (chegou → em prova → DNF → DQ) |

Nenhuma mensagem do cliente informa checkpoint, volta ou chegada; tipos inventados (`race_cp`, `evt_finish`) nem
existem — o Colyseus derruba quem manda (tests/eventsServer.test.ts).

## Mensagens
- `race {inst, cp, lap, rank, total, t, finished?, status?, reason?}` → inscritos a 2 Hz e a cada checkpoint (`t` < 0
  na contagem).
- `race_def` (acima) · `race_board {inst, t, rows}` → quem acompanha, 1 Hz · `evt_result` no fim.

## Cliente (`src/events/EventClient.ts`)
- Marcadores só para inscritos e quem acompanha: **um** `InstancedMesh` de anéis (largada + checkpoints, geometria
  compartilhada, sem iluminação) + um cilindro translúcido no próximo checkpoint. Removidos com o resultado.
- Painel discreto no alto (checkpoint, volta, posição, tempo / contagem) e classificação final.
- Minimapa: checkpoints (o próximo em destaque) e a largada (`Minimap.eventMarks`).
- Torcida: `npcCrowd` NPCs de ambiente **simulados** (RallyCrowd, determinístico, só no cliente) assistem na
  `watchArea` enquanto a corrida está viva; nunca contam como jogadores (`AgendaEntry.count` = humanos).

## Testes
- `tests/eventRuntime.test.ts`: bicicleta e patinete pelo mesmo runner (veículo certo para inscrever, ordem, pular não
  conta, voltas, posição, tempo, DNF por tempo), teleporte → DQ, correções → DQ, segmento × raio, rotas dos dados.
- `tests/eventsServer.test.ts`: servidor real, clientes forjados — inscrição a pé negada, corrida inteira por
  movimentos, reivindicação do cliente ignorada, teleporte forçado → DQ `correcoes`.
- `tools/qa/events_mp.mjs`: navegador + bots, corrida de bicicleta completa (navegador dirigindo) e de patinete
  (bot correndo, navegador acompanhando).
