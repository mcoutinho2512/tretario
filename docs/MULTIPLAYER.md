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
| Protocolo compartilhado | `src/net/protocol.ts` | mensagens, limites, `validateMove` (pura, testada) |
| Servidor | `server/src/index.ts`, `PresidenteVargasRoom.ts`, `state.ts` | Colyseus 0.18 (MIT), Schema v5 |
| Cliente | `src/net/NetworkClient.ts` | carregado sob demanda; não pesa no bundle sem `?mp` |

**Autoridade (ADR-013)**
- O cliente envia **propostas** de movimento (15 Hz) e faz predição local. O servidor valida velocidade máxima
  por modo (a pé, bicicleta, patinete, carro), limites do mundo, valores inválidos, ordem (`seq`) e teleporte. Se rejeitar,
  responde `correct` e o cliente obedece.
- Spawn, nome (sanitizado), tipo de corpo e cores (listas e intervalos permitidos): decididos ou validados no servidor.
- `interaction` (modo pacífico/interação) é campo do **servidor**. Combate, inventário e dinheiro nunca são aceitos do cliente.
- Estado sincronizado: `players` (posição, rumo, velocidade, locomoção, veículo, aparência), `eventId`, `serverTime`.

**Jogadores remotos:** reutilizam o mesmo `AvatarVisual` do jogador local (esqueleto de 17 ossos), com
interpolação num buffer de ~120 ms e pose de bicicleta/patinete quando montados.

## Teste automatizado de ponta a ponta
`node tools/qa/multiplayer.mjs` (com servidor e cliente rodando) abre 2 navegadores e verifica:
1. os dois entram na mesma sala e veem um ao outro;
2. A anda e B vê A na posição final (diferença < 1 cm na medição);
3. A sai e some para B;
4. B tenta se teletransportar 300 m e o servidor corrige.

## Limitações atuais
- O servidor valida velocidade e limites, mas **não colide com prédios** (o mapa de colisão do cliente usa canvas).
  Próximo passo: gerar no build uma grade de colisão binária compartilhada (Node + navegador).
- Pedestres e trânsito de ambiente são **locais de cada cliente** (ADR-003): cada jogador vê carros e pessoas diferentes.
  Os semáforos já são determinísticos pelo relógio e podem ser sincronizados por `serverTime`.
- Sem reconexão automática, sem salas por distrito, sem interest management. Ver [CROWD_ARCHITECTURE.md](CROWD_ARCHITECTURE.md).
