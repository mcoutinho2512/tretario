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
| **Veículos de evento** (1 trio elétrico, 2 carros de som) | servidor, como os demais veículos (+ `NetVehicle.design`) | idem (AOI pela `vgrid`) | delta-encoded |
| **Passageiros em cima do trio** | servidor: posição LOCAL validada contra o polígono do piso | `NetPlayer.platform/plx/plz/plh` (20 Hz, só quando mudam) | ver abaixo |
| Ônibus estacionados (4), gradis, placas "via interditada" | pipeline (`manifest.parkedBuses`) + cliente (`ClosureDressing`) | estáticos | 0 |
| Caminhões de campanha, telões, palco | pipeline (`manifest.eventSpots`, carrocerias na colisão) + arte do evento | estáticos; telões desenhados localmente | 0 |
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
| Carro de som | W · S freia/ré · A/D · E | 12,6 / 14,4 km/h | 4,2 m/s |
| Trio elétrico | W · S freia/ré · A/D · E (porta da cabine) | 4,3 / 5,4 km/h | 1,6 m/s |

Carro de som e trio são **sempre pacíficos** (nunca entram em `checkImpacts`; todo pedestre bloqueia — `vehicleBlock`),
**sólidos** para quem anda (`pushOutOfBox`, cliente com folga 0,35 m, servidor 0,15 m) e para os outros veículos
(`boxesOverlap`, cliente e servidor: não atravessa, para encostado). O trio testa as pontas (12,6 m), não só o centro.

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

## Trio elétrico: plataforma sincronizada (rodada 7)

Quem sobe no trio **não está em veículo** (`vehicle = ''` — ações sociais continuam valendo) e passa a ter:

| Campo (`NetPlayer`) | Tipo | Significado |
|---|---|---|
| `platform` | string | id do trio (`''` = no chão) |
| `plx`, `plz` | float32 | posição LOCAL no piso (m; +z = frente do trio, +x = lado do motorista) |
| `plh` | float32 | rumo relativo ao trio (rad) |

Mensagens: `board {id, seq}` → `board_ok {id, lx, lz}` / `board_denied {id, reason}` (`distancia`, `lotado`,
`ja_em_veiculo`, `ja_em_cima`, `estado`, `inexistente`); `unboard {seq}` → `unboard_ok {x, z}` (pé da escada; se
houver parede, pelas laterais); `pmove [lx, lz, lh, speed, loco, seq]` (15 Hz, substitui o `move` enquanto está em
cima) → `pcorrect [lx, lz, seq, reason]` se o servidor prender ao polígono ou limitar a velocidade.

Regras (`src/vehicles/platform.ts`, puras e testadas):
- **subir**: a pé, de pé, sem estar em veículo/plataforma, a ≤ 2,2 m do pé da escada, até 20 por trio;
- **andar**: velocidade de pedestre (`MAX_SPEED.foot` + folga) e **dentro do polígono** `TRIO_DECK` (guarda-corpo,
  recorte da mesa de som); o cliente prende ao MESMO polígono → correção quase nunca acontece;
- **ir junto**: a cada movimento do trio o servidor recalcula o mundo de cada passageiro (`localToWorld`); o x/z de
  mundo **sincronizado** só é regravado quando muda > 1 m (serve à grade/AOI e à multidão distante) — quem tem o
  estado completo desenha o passageiro como **pose interpolada do trio × posição local interpolada**
  (`NetworkClient.platformPose`), então ele não escorrega nem treme quando o trio anda ou vira;
- o trio em que o jogador está fica sempre na sua vista (AOI); quem está em cima não bloqueia o próprio trio, não
  empurra, não é empurrado nem atropelado; `move` antigo em trânsito (seq) é descartado ao subir/descer.

Medido (`tools/qa/trio_mp.mjs`, 3 navegadores reais + 2 para o carro de som: **24/24**): A sobe → B vê A em cima;
A anda no piso → B vê a posição local (erro 0,002 m); guarda-corpo segura; C dirige o trio 7,3 m em ~7 s → a
posição de A **relativa ao trio** fica constante para B (erro máx. 0,03 m em 61 amostras, = deslocamento do trio
entre duas leituras do teste) e para A; o mundo de A no servidor acompanha (≤ 1 m, pela regravação a cada 1 m);
B não atravessa a carroceria a pé; A desce no pé da escada do trio já deslocado. Carro de som: A entra, B não entra
no ocupado, A dirige ~9,9 m em 4 s, B vê (erro 0,3 m), A sai pela porta e o carro fica disponível.

## Pedestres (ainda locais)
Os pedestres usam o mapa de superfícies rasterizado no navegador (canvas) e o comportamento de travessia. Hoje
continuam **locais e diferentes** em cada cliente. Próximo passo: gerar no build uma grade de navegação
(calçadas/faixas) usável pelo servidor e simular uma população global pequena perto dos jogadores, com o mesmo esquema
de snapshot compacto (o mesmo formato que o antigo trânsito usava).
