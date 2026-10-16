# Multiplayer (desenvolvimento local)

> **Somente desenvolvimento.** O servidor escuta em `127.0.0.1` e não há deploy na VPS (ver ROADMAP, Fase 7).

## Rodar
```bash
npm run server:install   # uma vez (instala server/)
npm run server           # terminal 1: ws://127.0.0.1:2567
npm run dev              # terminal 2: cliente
```
Abra duas janelas:
- `http://localhost:5173/?mp=1&avatar=homem&name=Ana`
- `http://localhost:5173/?mp=1&avatar=idosa&name=Beto`

Cada uma vê a outra caminhando na Presidente Vargas, com nome sobre o avatar. O F3 mostra o status da conexão,
o número de remotos e as correções do servidor. `?mp=ws://outro-host:2567` aponta para outro servidor.

## Arquitetura
| Parte | Arquivo | Papel |
|---|---|---|
| Regras puras (cliente + servidor) | `src/net/protocol.ts`, `src/net/rules.ts`, `src/net/authority.ts` | validação de movimento, empurrão, impacto, entrar em veículo, empacotamento |
| Geometria compartilhada | `src/physics/walls.ts`, `src/world/landmarks/colliders.ts` | paredes de prédios, muros e landmarks (mesmos números nos dois lados) |
| Trânsito compartilhado | `src/traffic/TrafficSim.ts` | simulação pura; o servidor simula e o cliente extrapola entre snapshots |
| Relógio | `src/net/clock.ts` | tempo do mundo comum (semáforos, trânsito) |
| Servidor | `server/src/index.ts`, `PresidenteVargasRoom.ts`, `state.ts`, `world.ts`, `metrics.ts` | Colyseus 0.18 (MIT), Schema v5, `StateView` (AOI) |
| Cliente | `src/net/NetworkClient.ts`, `src/net/netWebSocket.ts` | carregado sob demanda; predição/reconciliação/interpolação; métricas de banda |

Detalhes: [NETCODE.md](NETCODE.md) (autoridade, latência, AOI) e [SHARED_WORLD.md](SHARED_WORLD.md) (o que é sincronizado e como).

## Ferramentas de QA
| Comando | O que faz |
|---|---|
| `node tools/qa/walkthrough.mjs [url] [lag] [jitter]` | 3 navegadores (A, B, C), servidor de teste próprio (porta 2600 ou `PV_WALKTHROUGH_PORT`), 27 checagens: ver os outros, mesmo trânsito/semáforos, colisão no servidor, carro (entrar, ocupado, dirigir, ré, sair), empurrão negado/aceito, ragdoll, imunidade, impacto. Grava screenshots, quadros para GIF e `report.json` |
| `cd server && npx tsx tools/loadtest.ts 20 [50d,100d,250d,500d,50s,…]` | carga progressiva 50→500 bots, densa (manifestação) e espalhada: tick/patch/AOI, CPU, event loop, memória, banda e visíveis (ver [CROWDS.md](CROWDS.md)) |
| `cd server && npx tsx tools/aoibench.ts 500 denso` | custo de um recálculo de AOI (grade × referência × todos-contra-todos) |
| `node tools/qa/crowd_bench.mjs [url] [50,100,250,500] [low,medium,high]` | cliente no meio de N bots por preset: FPS, CPU/GPU, draw calls, triângulos, heap |
| `node tools/qa/bench_presets.mjs` | desempenho do cliente por preset com 10 bots |
| `python3 tools/qa/make_gif.py [pasta]` | GIFs a partir dos quadros do walkthrough |
| `GET http://127.0.0.1:2568/metrics` | métricas do servidor (bytes/s, msgs/s, tick, memória, correções, negativas, quedas) |

`PV_TEST=1` (somente em ferramentas de QA) permite ao cliente escolher o ponto de spawn (`?spawn=x,z`). Nunca deve ser
ligado num servidor real.

## Limitações atuais
- **Pedestres NPC continuam locais** de cada cliente (o trânsito e os semáforos já são compartilhados).
- O servidor não colide jogadores/carros dirigidos contra o **trânsito de ambiente** (só o cliente faz isso);
  impacto do carro do jogador em **NPCs** de ambiente não existe.
- Ragdoll é visual e local: cada cliente pode mostrar a queda com pose diferente; a posição de repouso é do servidor.
- Uma sala única, sem reconexão automática, sem persistência, sem login (adiado por decisão do produto).
- Servidor apenas em `127.0.0.1`. **Sem deploy.**
