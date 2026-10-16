# Mundo compartilhado: todos veem a mesma Presidente Vargas

Objetivo: dois jogadores olhando o mesmo cruzamento veem **essencialmente a mesma situação**.

> **Rodada 7 — avenida fechada ao trânsito convencional.** Não há mais trânsito NPC (nem simulação no servidor, nem
> snapshot, nem `TrafficSim`/`TrafficSystem`). Os únicos veículos que se movem são os **dos jogadores**: carros, motos,
> bicicletas e patinetes elétricos estacionados junto ao meio-fio, nos bolsões e nas transversais. Ônibus ficam
> **estacionados como cenário** (não utilizáveis). Os semáforos continuam visuais (e para os pedestres NPC).

## O que é autoritativo, o que é determinístico, o que é local

| Elemento | Quem decide | Como chega ao cliente | Custo de rede |
|---|---|---|---|
| **Relógio do mundo** | servidor (`Date.now()`) | ping/pong estilo NTP (`src/net/clock.ts`), filtrando pelo menor RTT | ~20 B a cada 2 s |
| **Semente do mundo** | servidor (`state.seed`) | estado da sala (uma vez) | — |
| **Semáforos** (135 cruzamentos) | **função pura do relógio** (`lightAt(t + offset)`) | nada é transmitido: cada cliente calcula a fase com o relógio sincronizado | **0** |
| ~~Trânsito NPC~~ | **removido** na rodada 7 (avenida fechada) | — | 0 |
| **Veículos utilizáveis** (89: 14 carros, 12 motos, 38 bicicletas, 25 patinetes) | servidor: estado, ocupante, posição validada do motorista | estado da sala filtrado por AOI (`StateView` + grade espacial própria `vgrid`) | delta-encoded |
| Ônibus estacionados (4), gradis, placas "via interditada" | pipeline (`manifest.parkedBuses`) + cliente (`ClosureDressing`) | estáticos | 0 |
| **Jogadores** | servidor (posição validada) | estado da sala filtrado por AOI, 20 Hz | delta-encoded |
| **Evento ativo** | servidor (`state.eventId`) | estado da sala → cliente carrega `public/events/<id>.json` | — |
| Pedestres NPC de ambiente | **local** (cada cliente) | — | 0 |

## Veículos dos jogadores (rodada 7)

### Estados (servidor autoritativo)
| Estado | `NetVehicle.state` | Quando |
|---|---|---|
| `AVAILABLE` | 0 | estacionado, sem ocupante (nascimento; depois de o jogador sair ou desconectar) |
| `OCCUPIED` | 1 | um jogador controla; **um único controlador por veículo** (`canEnter` → `ocupado` para o segundo) |
| `RESETTING` | 2 | abandonado longe da vaga (> 15 m) por 5 min **sem ninguém a 25 m** → volta à vaga e fica `AVAILABLE` |

- **Entrar:** `E — USAR <VEÍCULO>` aparece perto de um veículo livre; o cliente pede `enter`, o servidor valida
  distância (pela carroceria: carro 2,2 m, moto 1,6 m, bicicleta/patinete 3,5 m), estado e ocupante.
- **Sair:** o veículo fica **parado onde está** e volta a `AVAILABLE` imediatamente para qualquer jogador.
- **Sincronizado:** posição, rotação, velocidade, ocupante, tipo e estado (`NetVehicle`), só para quem está na área
  de interesse — o servidor mantém uma grade espacial de veículos (`vgrid`) e consulta só as células próximas.

### Controles e limites urbanos ("não é pista de corrida")
| Tipo | Controles | Velocidade (normal / Shift) | Validação do servidor |
|---|---|---|---|
| Carro | W acelera · S freia/**ré** · A/D esterça · E entra/sai | 25 / 30 km/h | 8,8 m/s |
| Moto | W · S freia · A/D · E | 25 / 30 km/h | 8,8 m/s |
| Bicicleta | W · S freia · A/D · E | 20 / 25 km/h | 7,3 m/s |
| Patinete | W · S freia · A/D · E | 17 / 20 km/h | 5,9 m/s |

### Modo pacífico (padrão): não há atropelamento
- `impactAllowed(motorista, alvo)` só é verdadeiro se **os dois** estiverem em modo interação.
- Para qualquer outro caso, `vehicleBlock` (regra pura em `src/net/rules.ts`, usada pelo cliente **e** pelo servidor)
  amostra o caminho do veículo a cada 0,25 m contra a caixa do veículo (`VEHICLE_BOX`) e **para antes de encostar**
  na pessoa. Já encostado, pode dar ré ou desviar, nunca avançar. Sem dano, sem ragdoll, sem empurrão.
- O servidor corrige o motorista com o motivo `bloqueado`; o cliente prevê o mesmo bloqueio (jogadores remotos e
  pedestres NPC locais), então a correção quase nunca aparece.

### Medido (`tools/qa/vehicles_mp.mjs`, 2 navegadores reais por tipo: 24/24)
Para carro, moto, bicicleta e patinete: estacionado e disponível → A entra → B **não** entra no mesmo → A anda →
B vê o movimento (erro < 2,5 m) → A sai → veículo parado e disponível.

## Pedestres (ainda locais)
Os pedestres usam o mapa de superfícies rasterizado no navegador (canvas) e o comportamento de travessia. Hoje
continuam **locais e diferentes** em cada cliente. Próximo passo: gerar no build uma grade de navegação
(calçadas/faixas) usável pelo servidor e simular uma população global pequena perto dos jogadores, com o mesmo esquema
de snapshot compacto (o mesmo formato que o antigo trânsito usava).
