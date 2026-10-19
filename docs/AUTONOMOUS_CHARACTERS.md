# Personagens autônomos

> Rodada 12. O resto deste documento (servidor: cérebro, personalidades, LOD de simulação, diretor) é do AGENTE C;
> esta seção cobre só a APRESENTAÇÃO no cliente (AGENTE D).

## Cliente

Os autônomos chegam ao cliente pelo MESMO caminho dos jogadores remotos (`state.players` → `NetworkClient` →
`CrowdDirector`/`AvatarVisual`); o cliente só os distingue por `NetPlayer.kind` (src/world/entityKind.ts), lido de forma
tolerante (ausente = 0 = humano). Nada aqui decide comportamento — só como a pessoa é mostrada, e sempre barato em escala.

### Contrato esperado do servidor (campos tolerantes)

| Campo | Uso no cliente | Ausente |
|---|---|---|
| `NetPlayer.kind` (u8) | 1 = autônomo: regras de nome, painel sem moderação, fora da contagem pública | humano |
| `NetPlayer.look` (u16) | nid do alvo para cabeça/tronco (pessoa; numa briga, o oponente) | olhar livre |
| `NetPlayer.tag` (u8, **opcional, ainda não existe**) | 1 = sempre com nome · 2 = sem nome · 0 = regra do cliente | regra do cliente |
| mensagem `crowd`, bit 6 das flags | não humano na multidão distante (src/net/crowdCodec.ts `npc`) | humano |
| mensagem `dyn_events` (opcional) | focos do diretor de eventos → minimapa e áudio (src/events/dynamicPresentation.ts) | nada |

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

100 pessoas que recebem "bater palmas" no mesmo tick (e com a mesma variação) ficam espalhadas pelo ciclo.

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
pessoa). Focos do diretor (`dyn_events`) viram UMA marca agregada por foco e calor de multidão/comemoração/confronto
na célula do áudio — ver docs/HUD.md e docs/AUDIO_SYSTEM.md (rodada 12).

### QA (servidor de teste)

- `PV_TEST=1 PV_QA_BOT_KIND=1`: bots de carga entram como `kind = 1` (produção: bots = `LOAD_BOT`).
- `server/tools/bots.ts --names` (apelidos do autonomous.json) e `--sync-clap=S` (todos batem palma juntos).
- `window.__pvR12`: `labels()`, `labelDebug()`, `people()`, `sample()`, `lookAtMe()`, `look(fn)`, `dyn(lista)`,
  `lookStats()`, `netMs()`, `humans()`; `?r12var=0` desliga a individualidade dos remotos (comparação).
- `tools/qa/humanization_probe.mjs`, `tools/qa/nametag_bench.mjs`, `tools/qa/nametag_synth.ts`,
  `tools/qa/round12_people_shots.mjs`.
