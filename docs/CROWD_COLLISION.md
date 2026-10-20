# Colisão entre corpos (rodada 12)

Bug crítico até a rodada 11: um avatar atravessava o outro. Desde a rodada 12 **ninguém atravessa ninguém** — jogador
humano, personagem autônomo (agente C) ou NPC de ambiente — sem rigid body por pessoa e sem custo perceptível.

## Corpo

| contrato (`src/physics/bodies.ts` `BODY`) | valor | papel |
|---|---|---|
| `radius` | 0,32 m | corpo = círculo no plano horizontal; contato = 2 × 0,32 = **0,64 m** |
| `personalSpace` | 0,9 m | desvio local suavizado (`steerAround`) de quem anda sozinho (autônomos) |
| `maxPushPerStep` | 0,12 m | resolução progressiva: empurrão máximo por corpo por passada (sem explosão) |
| `serverTolerance` | 0,18 m | penetração que o servidor tolera antes de corrigir um humano (latência) |
| `queryRadius` | 2 m | TETO da consulta de vizinhos (na prática: contato + passo + folga ≈ 0,8–1,2 m) |

`BodyRef { id, x, z, r, fixed?, mass?, soft? }` — `fixed` nunca é empurrado; `mass` reparte o empurrão entre dois
móveis; `soft` = penetração que QUEM SE MOVE pode fazer nesse corpo (NPC 0,16 m, autônomo visto do cliente 0,12 m,
humano 0). Quem não tem corpo: caído/levantando/ragdoll, em veículo, em cima do trio (queda na multidão nunca
"explode"; levantar procura ponto livre).

## Algoritmo (`src/physics/bodyResolve.ts` — puro, o mesmo no cliente e no servidor)

- **`SpatialBodyGrid`** (implementa `BodyIndex`): células de 2 m, chave numérica, `upsert/move/remove/near`; conta
  `queries` (métrica `neighborQueries`).
- **`constrainMove(id, r, from, to, vizinhos, dt)`** — um corpo que se move (jogador local, humano no servidor,
  autônomo): ninguém termina mais perto de um vizinho do que `min(contato, distância de antes)`. Só a componente
  **normal** do passo some; a **tangencial** fica → desliza em volta em vez de travar seco. 3 passadas (duas pessoas ao
  mesmo tempo); fresta impossível (dois contatos puxando para lados opostos) → não anda. Sobreposição antiga (latência,
  spawn) sai a 0,6 m/s **só para quem está andando** — parado, ninguém o empurra.
- **`resolveBodies(corpos, índice)`** — muitos corpos móveis (autônomos entre si e contra humanos `fixed`): cada par
  sobreposto se afasta pela normal, a parte de cada um pela massa inversa, limitada a `maxPushPerStep`, 2 passadas
  Gauss-Seidel; os que andaram trocam de célula no fim. Centros coincidentes: direção determinística pelo par de ids.
- **`steerAround(id, x, z, dir, vizinhos, espaço)`** — desvio local: repulsão + componente lateral (contorna pelo lado
  em que já está), desacelera antes de encostar, nunca para de vez (velocidade ≥ 30 %).
- **`penetrationOf`**, **`findFreeSpot`** (anéis de 0,5 m, 8→24 direções, começando oposto ao vizinho mais encostado;
  `clear` para parede), **`canEscape`** (8 direções × 0,25 m), **`StuckDetector`** (quer andar, não anda, ≥ 2 corpos
  ou corpo + parede, por 3 s).

## Cliente — predição (`src/physics/LocalBodies.ts`, bloco `// rodada 12 — colisão` no `Game.ts`)

Por quadro, depois de `stepPlayer` e da colisão com veículos:
1. vizinhos: **remotos** a pé (`NetworkClient.bodiesNear`, posição interpolada; humano/bot duro, autônomo `soft`
   0,12) + **NPCs locais** (pedestres e multidão de concentração com esqueleto: `yieldBodies` empurra cada um para fora
   a até 1,1 m/s e o devolve como corpo macio 0,16 → **multidão densa resiste**: cada NPC sai devagar e volta ao lugar);
2. `constrainMove` → parede tem a palavra final (`resolveCircle`);
3. esquiva/avanço curto (lunge da rodada 9.1) passam pelo mesmo passo (`CombatClientDeps.bodies`) e param no contato;
4. **preso de verdade**: `StuckDetector` (3 s) **e** `canEscape` falso (nenhuma das 8 direções anda) → manda
   `unstuck`. Empurrar uma multidão que só fecha a frente nunca teleporta ninguém (QA: 0 pedidos).

QA: `__pv.bodies(reset?)` → `{avgMs, maxMs, avgNeighbors, avgContacts, blockedFrames, stuckRequests, minDist}`.

## Servidor — autoridade (`server/src/collision/RoomBodies.ts`, blocos `// rodada 12 — colisão` na sala)

- **Grade por tick** (`rebuild`, O(N)): todo `NetPlayer` a pé e de pé (OK/cambaleando) — humanos, **autônomos (kind 1)**
  e bots de carga. Humanos e bots são `fixed` para a resolução dos autônomos (quem cede é o autônomo). `sync` mantém o
  corpo em dia a cada movimento aceito.
- **Validação do humano** (`onMove`, a pé, depois das paredes e da carroceria do trio): penetração > `serverTolerance`
  **aumentando por causa do próprio passo** → `correct` motivo `corpo` com a posição deslizada encostada a
  `contato − tolerância` (correção mínima: só o excesso — sem briga de predição). Quem está parado nunca é corrigido
  nem empurrado; ninguém vira fantasma por multidão (não há "desligar colisão" em aperto). Cliente honesto: **0
  correções** no QA.
- **Ponto livre**: entrar (exceto sessão assumida), **reconectar** (`r12Relocate` antes do `resume`), **levantar da
  queda** (`correct` motivo `levantar`) — `findFreeSpot` sem cruzar parede. Saída de veículo: a saída segura da
  rodada 10 (`findSafeExit`) já recusa ponto a < 0,65 m de outra pessoa (`EXIT_PERSON_GAP` ≥ contato).
- **`unstuck`** (mensagem do cliente): conferido aqui — ≥ 2 corpos encostados (ou 1 + parede a ≤ 0,55 m) **e**
  `canEscape` falso; ≤ 1 a cada 4 s; ponto livre além do anel encostado (`correct` motivo `livre`); senão
  `unstuck_denied`.
- **Veículos × pessoas**: regras atuais preservadas (impacto de carro/moto, `vehicleBlock` para o carro antes de
  encostar); veículo parado é obstáculo (`pushOutOfBox` no cliente, carroceria do trio/carro de som no servidor).

### API para o agente C (autônomos)

```ts
room.bodies.grid                  // SpatialBodyGrid (BodyIndex) com TODOS os corpos a pé da sala (reconstruída no tick)
room.bodies.resolveAutonomous(cs) // resolveBodies(cs, grid) — cs = corpos dos autônomos que andaram (objetos da grade:
                                  // grid.get(id), já movidos com grid.move); humanos fixos; conta no collisionMs
room.bodies.sync(id, netPlayer)   // depois de escrever x/z do NetPlayer do autônomo
room.bodies.freeSpot(id, x, z, clear?) // nascer/reaparecer sem cair dentro de alguém
// puro (src/physics/bodyResolve.ts): constrainMove / steerAround / canEscape para o passo de cada autônomo
```
Fluxo sugerido por tick do autônomo: `steerAround` (direção) → passo → `constrainMove` contra `grid.near(...)` →
`grid.move` → (todos) `resolveAutonomous` → escrever no NetPlayer → `sync`. O cliente vê autônomos como corpos
macios (0,12 m < tolerância), então um humano que encosta num autônomo parado o empurra devagar (o servidor resolve).

### Uso pelos autônomos (rodada 12, agente G)

- Passo de cada autônomo: `steer` (desvio com antecipação, espaço pessoal 0,9 m × personalidade) → `constrainStep` contra
  os vizinhos (`createBodyIndex`) → `room.move` (a sala aplica `constrainMove` contra `room.bodies.grid`, humanos duros)
  → `resolveAutonomous` pós-tick. Nascer/chegar: `freeSpot`.
- Briga: o soco (1,2 m) é pedido a ≤ alcance + 0,12 m — com 0,64 m de contato e o recuo do golpe (0,35 m), exigir
  ≤ 1,05 m deixava quem revidava "se aproximando" a 1,25 m para sempre (o servidor aceita até alcance + `rangeSlackM`).
- Multidão de concentração: 20–35 autônomos de pé num anel de 14–30 m (concentrações do diretor) ficam compactos sem
  sobrepor; a plateia de uma briga fica a 4,5–8,5 m (`WATCH_FIGHT`), quem foge abre caminho pela própria colisão.
- Os NPCs LOCAIS do cliente cedem aos autônomos (src/npc/localPopulation.ts, docs/AUTONOMOUS_CHARACTERS.md).

## Multidão

- 30 corpos em 3 fileiras fechando a passagem: o humano **não passa** (QA, `tests/collisionServer.test.ts` com 10 numa
  fila de 0,72 m) e **sem deadlock**: sai de lado/para trás na hora; nenhum teleporte falso.
- 100 concentrados no mesmo ponto (pura): mediana da distância ao vizinho mais próximo > 0,95 × contato, 5º percentil
  > 0,85 × contato, ninguém anda mais de 2 × 0,12 m por passo, grupo continua compacto (< 6 m).
- NPCs locais cedem com resistência (1,1 m/s) e voltam a pé ao lugar no anel.
- Desvio local (QA): 16 bots com `steerAround` + `constrainMove` atravessam por cima de um humano parado — 16/16
  passam, distância mínima 0,62 m, 0 correções, o humano não sai do lugar.

## Custo medido

**Servidor, puro** (`server/tools/collisionbench.ts`, disco de √N × 0,42 m ≈ 1,8 pessoa/m², 200 ticks;
`docs/screenshots/round12/collision_bench.json`). "humanos" = pior caso: todo mundo andando para o centro SEM a
colisão do cliente (cada passo é corrigido); "autônomos" = resolução progressiva de 90 % autônomos + 10 % humanos.

| corpos | humanos: ms/tick (méd · p95 · máx) | consultas/tick | autônomos: ms/tick (méd · p95 · máx) | pares/tick |
|---|---|---|---|---|
| 50 | 0,15 · 0,33 · 0,48 | 75 | 0,07 · 0,17 · 0,23 | 392 |
| 250 | 0,72 · 1,18 · 1,43 | 375 | 0,33 · 0,60 · 1,28 | 2 221 |
| 500 | 1,54 · 2,51 · 2,97 | 750 | 0,60 · 1,02 · 1,29 | 4 874 |

**Servidor, ponta a ponta** (`server/tools/loadtest.ts 15 50k,250k,500k` — `k` = CONCENTRADOS, bots reais de rede
apertando para o centro sem colisão local; `docs/screenshots/loadtest_round12_collision.json`; gerador de carga na
mesma máquina):

| bots | tick ms (méd/máx) | **collisionMs** (méd/máx) | neighborQueries/tick | validações/s | correções de corpo |
|---|---|---|---|---|---|
| 50 | 0,71 / 2,04 | **0,13 / 0,33** | 75 | 740 | 2 206 |
| 250 | 3,38 / 6,62 | **0,61 / 1,20** | 377 | 3 692 | 10 796 |
| 500 | 10,86 / 17,59 | **1,39 / 2,19** | 762 | 7 461 | 21 652 |

A 500 concentrados a colisão custa ~1,4 ms de um tick de 100 ms (13 % do tick, < 1,5 % do orçamento) **no pior caso**
(cada bot é um cliente que ignora a colisão e é corrigido o tempo todo). Por isso **não há LOD nem orçamento**: precisão
máxima para todos. A consulta é do tamanho do passo (contato + passo + folga), não `queryRadius` — mediu ~3× menos
tempo na validação densa. Se um dia precisar, o lugar do orçamento é `RoomBodies.validate` (pular a validação de
bots de carga / autônomos longe de humanos), nunca remover colisão.

**Cliente** (por quadro): `collisionbench` 0,006–0,008 ms em média (≈ 8–10 vizinhos, 2 contatos) no meio de
50/250/500 remotos concentrados; QA real no Chrome 0,012–0,016 ms/quadro em média, pico 0,2–1,2 ms.

`/metrics` (servidor): `collisionMs` (ms por período de tick: grade + validações), `collisionMaxMs`,
`collisionBodies`, `neighborQueries` (por tick), `neighborQueriesPerSec`, `bodyValidationsPerSec`, `bodyCorrections`,
`unstucks`, `freeSpots`.

## Combate

Dois corpos encostados ficam a **0,64 m** — dentro do soco (1,2 m) e do chute (1,5 m). A colisão não impede acerto
legítimo (o servidor mede a distância de centro a centro, como antes), nem a esquiva, nem o avanço curto: o lunge para
no contato, ainda no alcance. Testes: `tests/combat.test.ts` ("corpos ENCOSTADOS … soco e chute"),
`tests/collisionServer.test.ts` (soco a 0,65 m na sala real), QA (soco encostado: condição de B 100 → 88).

## Testes e QA

- `tests/bodyCollision.test.ts` (puro): contrato × alcance; A contra B parado não atravessa (B não é empurrado);
  diagonal desliza; 10 corpos fecham um corredor e o lado continua livre; corpo macio; sobreposição antiga sai devagar;
  100 concentrados (estatística de distância mínima, sem explosão); autônomos × humano fixo; ponto livre (e parede);
  anti-trap (`StuckDetector`, `canEscape`); desvio local; grade.
- `tests/collisionServer.test.ts` (sala real, clientes forjados): A forjado contra B → correção `corpo`, B intacto;
  diagonal passa; fila de 10 bloqueia; spawn em ponto ocupado → ponto livre; `unstuck` negado com saída e aceito
  cercado por 4; soco encostado acerta; `/metrics` com `collisionMs`/`neighborQueries`.
- QA `tools/qa/collision_mp.mjs` (2–3 Chromes + bots `tools/qa/collision_bots.ts`), 13/13:
  `docs/screenshots/round12/I_humano_bloqueado.jpg` (parado no contato), `J_multidao_bloqueando.jpg` (30 corpos),
  `K_avoidance.jpg` (contorno pela tangente ao lado de outra pessoa); medidas em `collision_mp.json` (servidor no
  roteiro inteiro: `collisionMs` 0,04 ms médio / 0,5 ms máx, **0 correções de corpo** com clientes reais).
- Observação de QA (fora do escopo da colisão): no Chrome headless desta máquina, remotos com esqueleto às vezes deixam
  de ser desenhados (o rótulo continua) depois da troca de detalhe adiada de ~6 s / teleporte de QA; as capturas foram
  feitas antes disso, e o fluxo de bots com desvio é medido por números.
