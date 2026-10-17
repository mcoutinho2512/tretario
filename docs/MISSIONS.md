# Missões e conquistas (rodada 9)

Tudo por **DADOS** (`public/gameplay/*.json`), avaliado **no servidor** a partir de eventos de gameplay que o próprio
servidor emite (`src/gameplay/events.ts`, `server/src/gameplay/bus.ts`). O cliente nunca informa progresso, XP ou
conclusão. Progressão, XP, níveis e persistência: `docs/PROGRESSION.md`.

## Formato

```jsonc
// public/gameplay/missions.json — MissionDefinition[] (src/progression/types.ts)
{ "id": "mobilidade", "title": "MOBILIDADE", "description": "…", "category": "mobilidade",
  "requires": ["boas_vindas"],          // missões concluídas antes (revelação progressiva)
  "minLevel": 2,                        // opcional
  "optional": true,                     // opcional: nunca exigida (confronto)
  "objectives": [
    { "id": "a_pe", "label": "Caminhe 500 m", "on": "distance", "where": { "mode": "foot" }, "sumField": "meters", "count": 500 },
    { "id": "bicicleta", "label": "Use uma bicicleta", "on": "vehicle_enter", "where": { "kind": "bicycle" } }
  ],
  "rewards": [{ "kind": "xp", "amount": 200 }, { "kind": "unlock", "item": "shirt:206" }, { "kind": "title", "title": "…" }] }
```

- **Objetivo** = tipo de evento (`on`) + filtro por **igualdade** campo a campo (`where`) + `count` (padrão 1). Com
  `sumField`, soma o campo do evento (metros, segundos) em vez de contar.
- **Missão** aparece quando todas as `requires` estão concluídas e o nível ≥ `minLevel`; conclui com todos os objetivos.
  Progresso de antes da missão aparecer não conta.
- **Conquista** (`achievements.json`) tem o mesmo formato de objetivo; `session: true` = progresso só da visita
  (ex.: Central → Candelária na mesma sessão); `hidden: true` = não aparece antes de ganhar.
- Validação: `parseCatalog` (`src/progression/engine.ts`) descarta entradas inválidas (tipo de evento desconhecido,
  XP absurdo, recompensa de tipo desconhecido) sem lançar. `tests/progression.test.ts` confere que **todos** os JSON
  passam, que `requires` existe e que nenhuma missão não opcional depende de evento de confronto.

## Eventos que contam

| Evento | Quem emite | Campos para `where`/`sumField` |
|---|---|---|
| `zone_enter` | sala (ZoneTracker, histerese) | `zone` (CENTRAL, CAMPO_DE_SANTANA, CENTRO, RIO_BRANCO, CANDELARIA) |
| `distance` | **agente C** — movimentos ACEITOS, lotes ≥ 10 m, salto/teleporte não conta | `mode` (foot/bicycle/scooter/car/moto), `meters` |
| `action` | **agente C** — `act` aceito | `key`, `category` (gestos/manifestacao/danca/itens) |
| `prop` | **agente C** — `prop` aceito (pegar item) | `kind`, `slot` (flag/sign/banner = "qualquer bandeira") |
| `vehicle_enter`, `trio_board` | **agente C** — `enter_ok` / `board_ok` | `kind` |
| `rally_visit` | **agente C** — ≥ `PV_RALLY_DWELL_MS` (8 s) dentro do anel de uma concentração (palco, caminhão, trio, carro de som — formas de `RALLY_SHAPE`), uma vez por estadia | `kind` (stage/event/trio/soundcar) |
| `graffiti`, `chat` | **agente C** — grafite/mensagem aceitos | — |
| `combat_action`, `combat_dodge`, `dummy_knockdown` | agente A (confronto) | `key` (soco, chute…) |
| `event_join`, `event_complete`, `race_finish` | agente D (eventos/corridas) | `eventId`, `format`, `rank`… |
| `debate_watch`, `debate_turn`, `debate_react` | agente E (debate) | `seconds` |

Os emissores do agente C ficam em `server/src/progression/emitters.ts`; a sala chama uma linha em cada caminho de aceite
(marcadas `// rodada 9 — progressão` em `PresidenteVargasRoom.ts`).

## Missões atuais

| Missão | Revela após | Objetivos | Recompensa |
|---|---|---|---|
| BEM-VINDO À PRESIDENTE VARGAS | — (1ª entrada) | caminhar 30 m | 50 XP |
| CONHEÇA A PRESIDENTE VARGAS | boas-vindas | visitar CENTRAL, CAMPO_DE_SANTANA, RIO_BRANCO, CANDELARIA | 200 XP + título |
| ENTRE NO CLIMA | boas-vindas | pegar bandeira, dançar, gesto, concentração, subir no trio | 200 XP + ação "Dança clássica" |
| MOBILIDADE | boas-vindas | 500 m a pé, bicicleta, patinete, chegar ao Centro | 200 XP + camisa amarela |
| VOZ NA AVENIDA | ENTRE NO CLIMA | cartaz, 3 gestos de manifestação, 3 concentrações | 250 XP |
| GRANDE PASSEIO | CONHEÇA + MOBILIDADE | 2 km a pé, 1 km de bicicleta | 300 XP |
| PARTICIPE DE UM EVENTO | boas-vindas, nível 2 | entrar e concluir um evento da agenda | 250 XP |
| ASSISTA A UM DEBATE | boas-vindas, nível 2 | 2 min de debate, reagir | 150 XP |
| DE PONTA A PONTA | MOBILIDADE, nível 3 | terminar uma corrida | 150 XP |
| TREINO DE CONFRONTO (opcional) | boas-vindas, nível 2 | soco, chute, esquiva, derrubar o boneco | 150 XP |

Conquistas: PRIMEIROS PASSOS, DO INÍCIO AO FIM (Central e Candelária na mesma visita → bolsa), NO MEIO DA MULTIDÃO,
NO PALCO (trio), SOBRE DUAS RODAS, PRIMEIRO EVENTO (→ design "Pôr do sol"), PERNAS PARA QUE TE QUERO (5 km), ARTE NA
AVENIDA, BOA CONVERSA (só título), OUVINTE ATENTO, NA RETA FINAL (secreta).

**Caminho pacífico**: só andar, explorar, social e veículos (sem confronto, sem agenda) soma ≥ 1000 XP → **nível ≥ 5**
(teste `caminho PACÍFICO …`). Nenhuma missão exige grupo, lado político ou atacar humanos.

## Novo jogador

1ª entrada: cartão "BEM-VINDO À PRESIDENTE VARGAS — Explore a avenida" com **um** objetivo (caminhar 30 m). Ao
concluir, aparecem 3 missões (aviso "Nova missão: …"); as demais vêm por requisito/nível — nada de 20 tutoriais.
"Visto" (`prog_seen {k:'welcome'}`): contas no servidor (`PlayerProgress.data.seen`); visitantes também no aparelho
(`localStorage pv3d.seen`), já que o progresso deles não persiste.

## Cliente (`src/ui/progress/ProgressionUI.ts`)

- **Rastreador** (encaixe `HudShell.mountTracker`, alto à esquerda): missão em destaque (`mission_track`, só
  preferência) ou a primeira ativa; recolhe ao título em 9 s; DOM só quando chega `prog`.
- **Avisos** (`HudShell.notice`, fila de um por vez): objetivo ✓, MISSÃO CONCLUÍDA, CONQUISTA, NÍVEL, RECOMPENSA.
- **PROGRESSO** (menu ☰ → Progresso): nível, barra de XP, missões ativas (com "Acompanhar") e concluídas, conquistas,
  recompensas (liberado / 🔒 requisito / "em breve").

## Como adicionar uma missão

1. Acrescente a definição em `public/gameplay/missions.json` (ids `[a-z0-9_]`, objetivos com `on` de `events.ts`).
2. Se der item: o item precisa existir em `public/gameplay/rewards.json` **e** em `ITEM_TIERS`
   (`src/characters/unlocks.ts`) — o teste de consistência falha se faltar um dos lados.
3. `npm test` (catálogo, neutralidade, caminho pacífico) e, se houver evento novo, o emissor no servidor.

## QA

- `tests/progression.test.ts` (regras, serviço, anti-farm, persistência em memória, direitos, emissores, telemetria)
- `tests/progressionServer.test.ts` (sala real: movimentos forjados + teleporte de teste pelas zonas → missão conclui →
  XP no banco → login novo restaura)
- `server/test/progression.dbtest.ts` (`npm run test:db`: pares únicos no PostgreSQL, cascata, reinício)
- `node tools/qa/missions_mp.mjs http://localhost:5173` (navegador: boas-vindas, missão de exploração, nível, PROGRESSO;
  capturas `docs/screenshots/round9/L_missao_exploracao.jpg`, `M_progresso_xp.jpg`, `N_recompensas.jpg`)
- Teleporte de QA: mensagem `test_tp {x,z}` só com `PV_TEST=1` (o servidor move o jogador como o `testSpawn`; não conta
  distância). No navegador: `__pvProg.tp(x, z)`.
