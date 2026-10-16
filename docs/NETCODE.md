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
| Limites de taxa | cliente 15 Hz; servidor: patches de estado a 20 Hz (≤ 48 detalhados), multidão distante a 2 Hz, trânsito a 2 Hz, AOI a 5 Hz (fatiada), `maxMessagesPerSecond = 60` (desconecta flood) |
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

## Área de interesse (AOI) — rodada 6: grade espacial + limite + multidão distante
- **Grade espacial** (`src/net/spatialGrid.ts`, pura e testada): células de AOI/2 = 110 m, reconstruída a cada tick
  (O(N)). Toda consulta "quem está perto" usa a grade: AOI, candidatos de impacto de veículo. Nada mais varre N×N.
- **Mesma regra de antes**: entra a ≤ **220 m** (`PV_AOI`), sai só além de **253 m** (histerese × 1,15). Os testes
  comparam a versão rápida (`selectInterestSlots`) com a referência e com o algoritmo antigo, passo a passo.
- **Limite de detalhados**: no máximo **48** jogadores (`PV_AOI_MAX`; o cliente pode pedir menos no join pelo
  preset: BAIXO 16, MÉDIO 32) com estado completo na `StateView` (patches a 20 Hz), **os mais próximos primeiro**;
  quem já está na vista tem vantagem (distância × 0,85) para não trocar a cada passo na borda do limite.
- **Multidão distante** (mensagem binária `crowd`, `src/net/crowdCodec.ts`): os demais jogadores da área vão a
  **2 Hz** (`PV_CROWD_HZ`) em 11 B cada (posição em dm, rumo 8 bits, velocidade, corpo/status), aparência (+12 B) só
  na primeira vez. Cada jogador é codificado uma vez por rodada (tabela por slot); a mensagem de cada cliente é só
  cópia de bytes. O cliente interpola (650 ms de atraso) e desenha instanciado. `NetPlayer.nid` (u16) casa as duas vias.
- **Fatiamento**: AOI e multidão são distribuídas entre os ticks (cada cliente no seu tick: AOI a 5 Hz, multidão a
  2 Hz) — sem picos. Entrada de um jogador recalcula só a vista dele.
- Trânsito: cada cliente recebe só os veículos a ≤ 380 m.
- Medições (50 → 1000 bots, denso e espalhado) e limites: [CROWDS.md](CROWDS.md).
- Próximo passo (escala): salas por "distrito"/sharding quando passar de ~750 jogadores na mesma concentração.
