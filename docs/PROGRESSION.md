# Progressão, XP, recompensas e telemetria (rodada 9)

Missões/conquistas e seus dados: `docs/MISSIONS.md`. Este documento cobre a autoridade, o XP, os níveis, as recompensas
cosméticas, a persistência e a telemetria.

## Arquitetura

```
sala (aceite: move/act/prop/enter/board/gf/chat; zonas)      server/src/progression/emitters.ts
        │  room.gameplay (GameplayBus, síncrono)
        ├──► ProgressionService  ── prog / prog_ev (só ao dono) ──► cliente (src/ui/progress)
        │        │ lote (marca suja)
        │        └──► DataStore.progression (memória | Prisma)
        └──► GameplayTelemetry ── linha JSON por período ──► server/data/telemetry.jsonl ──► npm run dev:telemetry
```

- `server/src/progression/ProgressionService.ts` — sem Colyseus; estado **por conta** (reconexão e login duplicado
  reaproveitam o mesmo estado em memória). `RoomProgression.ts` liga serviço + emissores + telemetria à sala; a sala tem
  um bloco `// rodada 9 — progressão` e linhas marcadas nos caminhos de aceite.
- Regras puras compartilhadas: `src/progression/engine.ts` (casamento de objetivo, nível, requisito de item, validação
  do catálogo). Contrato: `src/progression/types.ts`.

## Autoridade e anti-farm

- O cliente só envia `mission_track {id}` (missão em destaque) e `prog_seen {k}` (tela vista) — preferências de UI.
  `test_tp` existe só no servidor de teste (`PV_TEST=1`).
- **XP só de**: recompensa de missão, recompensa de conquista e **conclusão** de evento da agenda (`event_complete`).
  Chat, emote, item, grafite, soco/chute e distância **não** rendem XP por quantidade: só contam para objetivos.
- Conclusão de evento: 40 XP com retorno decrescente por evento por dia (×0,5 a cada repetição; 4 por evento/dia;
  teto diário de 200 XP) — `EVENT_XP`.
- Tetos por minuto para os eventos que contam em objetivos (`EVENT_CAPS`: chat 3, grafite 2, ação 8, item 8, golpe 20…);
  além disso, ignorados (`stats.capped`).
- Distância: só de movimentos **aceitos**, em lotes ≥ 10 m; passo maior que a velocidade máxima do modo (teleporte,
  correção) não conta.
- Confronto: XP só por objetivo concluído (TREINO DE CONFRONTO, opcional) — nunca por golpe acertado.
- Recompensa **uma vez**: a conclusão é marcada antes de pagar; itens por par único `(userId, item)` em memória e no
  banco. Repetir a mesma sequência de eventos não muda nada (teste "recompensa UMA vez").

## Níveis (`public/gameplay/levels.json`)

| Nível | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| XP total | 0 | 100 | 250 | 450 | 700 | 1000 | 1400 | 1900 | 2500 | 3200 |

Caminho pacífico completo ≈ 1675 XP (nível 6), sem confronto e sem eventos da agenda.

## Recompensas cosméticas (`public/gameplay/rewards.json` + `src/characters/unlocks.ts`)

| Item | Como | Fonte |
|---|---|---|
| `design:mar_e_mata` (bandeira/cartaz) | nível 2 | PROGRESSION |
| `shirt:208` camisa azul petróleo | nível 3 | PROGRESSION |
| `design:calcadao` bandeira/cartaz Calçadão | nível 4 | PROGRESSION |
| `shirt:210` listras areia e verde | nível 5 | PROGRESSION |
| `design:noite_na_avenida` bandeira/cartaz Noite na avenida | missão ENTRE NO CLIMA | PROGRESSION |
| `shirt:209` coral com gola creme | missão MOBILIDADE | PROGRESSION |
| `shirt:211` ondas do calçadão | conquista DO INÍCIO AO FIM | PROGRESSION |
| `design:por_do_sol` | conquista PRIMEIRO EVENTO | EVENT_REWARD |
| pacote de poses / bandeiras de artistas | — | PREMIUM_FUTURE: "em breve", **não bloqueia nada e nunca é cobrado** |

Regra: recompensas são SEMPRE itens novos (camisas 208–211, designs 40–43, títulos). Nada que já era livre antes da
rodada 9 é bloqueado — quem já usava uma peça não perde a aparência salva.

- Só itens novos ou pouco usados viraram recompensa: o que todos já usavam continua livre. Nenhum dá vantagem.
- Direitos = `RewardGrant` + itens do nível. Valem no **validador único** (`validateAppearance(raw, fallback, ent)`) na
  sala e na API (`PUT/GET /api/me/appearance`, via `entitlementsFor` — com a conta conectada vale o estado em memória,
  então a recompensa recém-ganha funciona antes da gravação), e nas regras de ação/item (`validateAction`/
  `validateProp` com `ActionActor.ent` → motivo `bloqueado`). Sem `ent` (NPC, previsão do cliente) nada muda.
- Editor de personagem: chips bloqueados com 🔒 e o requisito (`requirementOf`); direitos de `GET /api/me/progress`
  (só a própria conta). A troca de design na roda de ações pula os bloqueados.

## Persistência

- Modelos (migration `20261017134942_round9_progression`): `PlayerProgress` (userId PK, xp, level, `data` JSON com
  missões ativas, conquistas parciais, telas vistas, missão em destaque, contador de eventos do dia), `CompletedMission`,
  `AchievementUnlock`, `RewardGrant` — os três com par único. `onDelete: Cascade` na conta.
- `DataStore.progression.{load, save}` (memória e Prisma, mesmo contrato — `tests/dataStoreContract.ts`). `save` faz
  upsert + `createMany(skipDuplicates)` numa transação.
- **Em lote**: marca suja; grava a cada `PV_PROG_FLUSH_S` (15 s) e na queda (graça), na saída/fim da graça/sessão
  substituída e no desligamento (`onDispose → flushAll`). Nunca por evento (teste: centenas de eventos → 0 escritas).
  Falha de gravação devolve as linhas à fila (o par único torna a repetição inócua).
- Visitante, jogador anônimo do servidor de teste e conta fictícia (`testUser`): só memória da sessão
  (`persistent:false`); o cliente avisa "o progresso vale só nesta visita". Bots de carga não têm progressão.

## Protocolo

| Mensagem | Direção | Conteúdo |
|---|---|---|
| `prog` | servidor → dono | `{ p: PlayerProgression, persistent }` ao entrar e a cada mudança, ≤ 2 Hz |
| `prog_ev` | servidor → dono | `{ kind: objective/mission/achievement/level/reward, id, label, xp?, level?, item? }` |
| `mission_track` | cliente → servidor | `{ id }` (só missão ativa; senão vira nulo) |
| `prog_seen` | cliente → servidor | `{ k }` (`[a-z_]{1,24}`, até 16) |
| `test_tp` | cliente → servidor | `{ x, z }` — **só `PV_TEST=1`** |

## Telemetria de gameplay (`server/src/telemetry/GameplayTelemetry.ts`)

- Memória + uma linha JSON por período (`PV_TELEMETRY_S`, 60 s) em `server/data/telemetry.jsonl`
  (`PV_TELEMETRY_FILE`; servidor de teste não grava sem essa variável). Sem serviço externo, **sem rota pública**.
- Só agregados: sessões iniciadas/encerradas, duração (total e histograma), contas × visitantes, missões
  iniciadas/concluídas (e por missão), conquistas, subidas de nível, eventos da agenda (entradas/conclusões), corridas
  iniciadas (`event_join` de formato `race`)/concluídas, sessões que assistiram debate (e minutos), sessões com
  participação em confronto, zonas visitadas, contagem por tipo de evento e **atividades por sessão** (histograma, base
  para métricas de retenção). Nada de userId, sessionId, apelido, posição ou texto.
- Cada linha traz os contadores do período (deltas); somar as linhas dá o total, inclusive entre reinícios.
- `npm run dev:telemetry [-- --since=24] [-- --json] [-- --file=…]` imprime os agregados (CLI do operador).
