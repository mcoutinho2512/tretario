# Mundo compartilhado: todos veem a mesma Presidente Vargas

Objetivo: dois jogadores olhando o mesmo cruzamento veem **essencialmente a mesma situação**, sem transmitir
a posição de 220 veículos a 60 Hz para cada um.

## O que é autoritativo, o que é determinístico, o que é local

| Elemento | Quem decide | Como chega ao cliente | Custo de rede |
|---|---|---|---|
| **Relógio do mundo** | servidor (`Date.now()`) | ping/pong estilo NTP (`src/net/clock.ts`), filtrando pelo menor RTT | ~20 B a cada 2 s |
| **Semente do mundo** | servidor (`state.seed`) | estado da sala (uma vez) | — |
| **Semáforos** (135 cruzamentos) | **função pura do relógio** (`lightAt(t + offset)`) | nada é transmitido: cada cliente calcula a fase com o relógio sincronizado | **0** |
| **Trânsito** (220 veículos) | servidor simula a 10 Hz (`TrafficSim`, o mesmo código do cliente) | snapshot binário de **12 bytes/veículo**, 2 Hz, só da área de interesse (380 m) | ~0,3–1 KB/s |
| **Veículos utilizáveis** (carros, bicicletas, patinetes) | servidor (ocupante, posição validada do motorista) | estado da sala filtrado por AOI (`StateView`) | delta-encoded |
| **Jogadores** | servidor (posição validada) | estado da sala filtrado por AOI, 20 Hz | delta-encoded |
| **Evento ativo** | servidor (`state.eventId`) | estado da sala → cliente carrega `public/events/<id>.json` | — |
| Pedestres NPC de ambiente | **local** (cada cliente) | — | 0 |

### Por que o trânsito é "servidor simula + cliente extrapola"
- Um trânsito 100% determinístico só a partir da semente exigiria simular desde o início dos tempos (a interação
  entre carros, semáforos e jogadores é caótica) ou divergiria em segundos.
- Transmitir posições a 20–60 Hz custaria ~10–30 KB/s por jogador só de trânsito.
- **Escolha:** o servidor roda o `TrafficSim` (puro, compartilhado). O cliente recebe a cada 500 ms o estado
  **compacto** (`id, faixa, s, v, v0, próxima faixa, tipo/cor`) e roda o **mesmo** `TrafficSim` entre snapshots
  (mesmas faixas, mesma regra de seguimento, mesmos semáforos pelo relógio comum). Correções pequenas (< 6 m)
  são suavizadas em ~0,35 s; grandes (troca de faixa/respawn) são aplicadas na hora.
- **Medido no walkthrough:** A e B perto do mesmo cruzamento viam **os mesmos veículos** (17/17 ids em comum),
  com erro mediano de posição entre 0,00 e 0,14 m. Semáforos: **135/135 iguais** no mesmo instante.

### Formato do snapshot de trânsito (`TrafficSim.packAround`)
```
u16 id · u16 faixa · u16 s×10 (dm) · u8 v×10 · u8 tipo|cor<<2 · u16 próxima faixa (65535 = nenhuma) · u16 v0×100
```

## Pedestres (ainda locais)
Os pedestres usam o mapa de superfícies rasterizado no navegador (canvas) e o comportamento de travessia. Hoje
continuam **locais e diferentes** em cada cliente. Próximo passo: gerar no build uma grade de navegação
(calçadas/faixas) usável pelo servidor e simular uma população global pequena perto dos jogadores, com o mesmo esquema
de snapshot compacto do trânsito.
