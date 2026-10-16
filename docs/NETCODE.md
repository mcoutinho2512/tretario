# Netcode: autoridade, latência e área de interesse

## Autoridade (o cliente nunca decide)
| Ação | Cliente | Servidor valida |
|---|---|---|
| Andar/correr/dirigir | prevê e envia proposta compacta a 15 Hz (`[x,y,z,heading,speed,loco,seq]`) | ordem (`seq`), valores finitos, limites do mundo, **velocidade máxima pelo modo que o SERVIDOR sabe** (a pé/bicicleta/patinete/carro), **cruzamento de paredes** (mesma geometria do cliente; carro com 3 raios) → senão `correct` |
| Entrar em veículo | pede `enter(id)` e espera `enter_ok` | existe, livre (1 ocupante), jogador a pé e de pé, distância à **carroceria** ≤ 2,2 m (carro) / 3,5 m ao centro (bicicleta) |
| Modo interação | pede `mode` | política do evento (`interaction: pacifico/opcional`), estado |
| Empurrar | toca a animação e pede `push(alvo)` | ambos em modo interação, ambos de pé e a pé, distância ≤ 1,9 m, alvo dentro de 75° da frente, linha livre (sem parede), cooldown 1 s, no máximo 6 ações em 15 s, alvo sem imunidade |
| Atropelamento | nada (só dirige) | motorista e alvo em modo interação; velocidade **medida pelo servidor** ≥ 2,5 m/s; alvo dentro da caixa do carro ao longo do trajeto (anti-tunelamento) |
| Queda | ragdoll visual local | posição de repouso (limitada por paredes), 2,6 s no chão + 1,4 s levantando, depois 5 s de **imunidade** (anti-griefing); movimentos do caído são ignorados |

Regras puras e testadas: `src/net/rules.ts`, `src/net/authority.ts` (tests/rules, tests/authority).

## Latência
| Técnica | Onde |
|---|---|
| Predição do jogador local | movimento aplicado na hora; nada espera o servidor |
| Reconciliação | `correct` traz o `seq`; o cliente mede o erro naquele `seq` (histórico de 120 propostas) e o aplica sobre a posição atual (preserva o movimento posterior); erros > 4 m: snap |
| Interpolação | remotos renderizados no passado, com buffer **adaptativo**: 70 ms + 2,5 × jitter medido (100–300 ms) |
| Jitter | estimado pelo desvio dos intervalos de chegada dos patches em relação aos 50 ms |
| Relógio | NTP simplificado; semáforos e trânsito usam o relógio do servidor |
| Limites de taxa | cliente 15 Hz; servidor: patches de estado a 20 Hz, trânsito a 2 Hz, AOI a 4 Hz, `maxMessagesPerSecond = 60` (desconecta flood) |
| Compactação | movimento como array numérico (msgpack); trânsito binário de 12 B/veículo; estado com Schema delta + `StateView` |

### Simular rede ruim (desenvolvimento)
```bash
COLYSEUS_LATENCY=150 npm run server                # RTT simulado no servidor (nativo do Colyseus)
PV_JITTER=40 PV_LOSS=0.03 npm run server           # jitter (preserva ordem) e perda de mensagens toleráveis
http://localhost:5173/?mp=1&lag=100&jitter=30      # latência/jitter no navegador (WebSocket instrumentado)
node tools/qa/walkthrough.mjs http://localhost:5173 150 30   # roteiro completo sob 150 ms ± 30 ms
```
Sobre perda: WebSocket é TCP (confiável e ordenado). Perda real vira **atraso em bloco** (head-of-line), e é isso
que o jitter simula. `PV_LOSS` descarta apenas mensagens que o jogo tolera perder (movimento e snapshot de trânsito),
para testar a robustez. Patches de estado nunca são descartados, porque isso corromperia o decoder.

## Área de interesse (AOI)
- O servidor mantém um `StateView` por cliente. A cada 250 ms recalcula quem está a ≤ **220 m** (configurável em
  `PV_AOI`), com **histerese** (sai só a > 253 m), e adiciona/remove jogadores e veículos. O cliente só recebe patches do que vê.
- Trânsito: cada cliente recebe só os veículos a ≤ 380 m.
- Com bots espalhados por 2 km de avenida, cada um vê em média **uma fração** dos demais (ver PERFORMANCE.md).
- Próximo passo (escala): grade espacial de células para não varrer N×N jogadores, e salas por "distrito" quando
  passar de algumas centenas de jogadores.
