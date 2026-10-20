# STATUS — Presidente Vargas 3D

_Atualizado em 2026-10-20 (rodada 12: cidade viva — personagens autônomos, colisão entre corpos, veículo pessoal,
mundo dinâmico)._

## Rodada 12 — cidade viva, personagens autônomos, colisão entre avatares, veículo pessoal e eventos dinâmicos

Sete frentes sobre contratos comuns (`src/world/entityKind.ts`, `src/physics/bodies.ts`, `src/vehicles/personal.ts`,
`server/src/autonomous/types.ts`): [AUTONOMOUS_CHARACTERS.md](AUTONOMOUS_CHARACTERS.md),
[CROWD_COLLISION.md](CROWD_COLLISION.md), [PERSONAL_VEHICLES.md](PERSONAL_VEHICLES.md),
[DYNAMIC_WORLD.md](DYNAMIC_WORLD.md).

- **Sem zonas de paz**: a política PEACE saiu do código; só COMBAT/CONTESTED. Confronto em toda a área jogável, sem
  evento; mantida só a proteção de retorno de 5 s (spawn, levantar, reentrar).
- **Colisão entre corpos**: círculo r = 0,32 m (contato 0,64 m) numa grade espacial no servidor (`room.bodies`);
  humano × humano e humano × autônomo duros (o servidor corrige o excesso com tolerância de latência), autônomo ×
  autônomo resolvido no servidor, NPCs locais do cliente cedem. Sem pilhas: distância mínima mediana 0,46–0,57 m com
  500 concentrados. Spawn/reconexão em ponto livre; `unstuck` validado. Custo puro (sem rede) 50/250/500 humanos
  concentrados: 0,11 / 0,54 / 1,15 ms por tick; autônomos 0,05 / 0,21 / 0,43 ms; cliente 0,004–0,006 ms por quadro.
- **Veículo pessoal "selecionou → aparece"**: `pveh_req` → o servidor escolhe o ponto livre e já monta o jogador.
  Patinete 0,9 m, bicicleta 1,1 m, moto 1,6 m, carro 4 m (na pista); resposta em 6–16 ms; o outro jogador vê em
  80–200 ms. Um por jogador, só o dono usa, some 45 s após o abandono; 100 pedidos forjados em sequência → 1 veículo.
- **Personagens autônomos** server-authoritative (sem LLM, sem chat automático): 220 em produção (−3 por humano,
  mínimo 60), personalidades por peso, objetivos, memória curta, LOD NEAR/MID/FAR/DORMANT pela distância ao humano
  mais próximo; mesmo visual dos jogadores (`NetPlayer.kind = 1`), nomes naturais em parte deles (pool fixo de 18
  rótulos), **nunca contam como jogador online**. Usam veículos do mundo e pessoais, formam rodas, torcidas e
  concentrações, reagem a humanos, observam, evitam ou entram em brigas.
- **Mundo dinâmico** (`DynamicWorldDirector`, `public/gameplay/dynamic_world.json`): concentração, caminhada, encontro
  de torcidas, festa, discussão → briga → briga generalizada, por adesão gradual (CALMO → TENSÃO → CONFRONTO →
  GENERALIZADO). 60 min simulados com 180 autônomos: 10 discussões/h, 4 brigas/h (2–4 com golpes trocados),
  generalizada em 7 de 8 sementes; concentrações com pico mediano de 20 pessoas (máx. 29–36).
- **Remoto invisível** (bug de produção da rodada 11): velocidade indefinida virava NaN no cliente e o avatar sumia
  com o nome na tela (4,6 % do tempo); corrigido no cliente e no servidor (`initNetPlayer`).

**QA de integração (master integrado, 2026-10-20)**: `npm run verify` 948/948; 27 roteiros — os 6 da rodada 12
(collision 13/13, personal_vehicles 14/14, autonomous 11/11, remote_visibility, humanization, dynamic_world 11/13)
e os 18 das rodadas 10/11, mais 3 repetidos com 150 autônomos ligados. Corrigido na integração: **o trio elétrico
ficava travado com o mundo vivo** — os autônomos que dançam em volta dele o bloqueavam para sempre (o veículo para
antes de encostar em quem está a pé, e o cliente do motorista já freia antes); agora o autônomo na frente de um veículo dirigido percebe e abre caminho
(`AutonomousSystem.makeWay`): `trio_mp` com 150 autônomos 0 m → 7,3 m em 7 s. Roteiros ajustados ao mundo vivo
(contar só humanos; veículo pego por um autônomo no caminho; duas corridas de tempo de leitura). Falhas que ficam:
dynamic_world E/H — uma torcida sozinha junta 6 pessoas (o roteiro pede 8).

**Desempenho 11 × 12** (mesma máquina, `docs/bench/round12_compare_*.json`). Servidor, mesma carga (sem autônomos):

| cenário | tick 11 → 12 (ms) | CPU 11 → 12 | saída (KB/s) | colisão (ms) |
|---|---|---|---|---|
| 50 densos | 0,53 → 0,56 | 5 → 6 % | 363 → 361 | 0,08 |
| 250 densos | 2,87 → 2,71 | 17 → 18 % | 3540 → 3021 | 0,27 |
| 500 densos | 7,55 → 7,27 | 33 → 32 % | 11026 → 8914 | 0,56 |
| 500 espalhados | 3,46 → 3,45 | 29 → 29 % | 4953 → 4614 | 0,48 |
| 250 + 50 veículos | 1,60 → 1,70 | 16 → 17 % | 2362 → 2307 | 0,19 |

Com o mundo vivo de produção (220 autônomos): 50 / 250 / 500 densos → tick 1,48 / 3,83 / 9,52 ms, CPU 9 / 19 / 34 %.
Massa concentrada: 250 / 500 → tick 2,76 / 7,33 ms (colisão 0,41 / 0,82 ms, 375 / 759 consultas de vizinhos por
tick); com 220 autônomos 3,69 / 8,62 ms. IA na sala real com 50 / 100 / 250 autônomos: 0,45 / 0,71 / 1,10 ms por
tick (99 decisões/s com 250). Pico de RSS do servidor maior (500 densos 296 → 401 MB). Cliente (FPS, sem vsync):

| bots | LOW | MEDIUM | HIGH | ULTRA |
|---|---|---|---|---|
| 50 | 458 → 456 | 238 → 242 | 93 → 96 | 73 → 77 |
| 250 | 416 → 421 | 223 → 207 | 82 → 84 | 63 → 61 |
| 500 | 449 → 420 | 219 → 206 | 78 → 81 | 61 → 60 |
| 250 + 220 autônomos | — | 211 | 83 | 63 |

Draw calls iguais (HIGH 500: 1517 → 1536). Nomes: pool fixo de 18 nós DOM (antes um por remoto).

**Soak de 62 min** (build de produção, `SOAK_R12=1`: 180 autônomos, veículo pessoal patinete/bicicleta/moto/carro,
atravessar grupos de autônomos, provocar o mais próximo, focos dinâmicos forçados — concentração, encontro de
torcidas, discussão, briga, caminhada, festa, generalizada — mais tudo das rodadas 9–11 com 60 bots;
`docs/bench/round12_soak.json`): **sem vazamento estrutural**. Heap pós-GC 71 → ~100 MB no aquecimento (20 min) e
106–113 MB depois (+0,125 MB/min nos últimos 30 min, +0,04 nos últimos 15 — ruído de GC; a rodada 11 deu +0,19);
GPU sem pós-processamento plana (690–720 MB, −1,4 MB/min no fim); listeners 338–351; intervals 1–2; AudioNodes
115–118; FPS 57–58; `pointerLock` 0; autônomos 180 do início ao fim; rótulos de nome 18; IA 0,70–0,80 ms e colisão
0,11–0,12 ms por tick sem subir; heap do servidor 63–83 MB sem tendência; veículos pessoais recolhidos (0–1 vivos);
nenhum erro de página. DOM 2045 → 2200: histórico do chat (limitado a 200 linhas).

**Produção (2026-10-20 22:01 UTC)**: commit `cd0e0c6d4a5d` em https://tretario.com.br pelo pipeline oficial —
verificação na VPS 949/949, backup pré-deploy `tretario-20261020T220058-cd0e0c6d4a5d.dump` (45 KB, sha256 ok),
nenhuma migration pendente (7 aplicadas, nenhuma nova), 194 s de deploy, **1,53 s fora do ar**, `/health/ready` ok,
smoke do pipeline ok; release anterior (7b69c77) guardado para rollback. Smoke pela internet
(`tools/qa/prod_e2e.mjs`): visitante 6/6, jogador + XP 5/5, rodada 10 8/8, **rodada 12 17/17** — 48 autônomos à vista
e contagem pública só com humanos; moto 1,6 m, carro 3,2 m, patinete 0,9 m, bicicleta 1,1 m, já montado (19–37 ms no
servidor); colisão com autônomo parado sem atravessar (0,52 m); nomes em 2 de 48; 20 pedidos forjados → 1 veículo;
inventário, chat, confronto sem zona de paz, agenda, áudio, cursor livre, sem erro de página, logout/login.

**Limites conhecidos (rodada 12)**: concentração de uma torcida só junta 6–10 pessoas (mistas 15–36); a captura da
caminhada é a mais fraca; a generalizada forçada pelo QA na sala real usa adesão × 3; nomes podem se sobrepor em
grupos muito densos; com o mundo vivo o trio anda "em cortejo" (para enquanto alguém ainda está saindo da frente).

## Rodada 11 — desktop first, cursor sempre visível, inventário, editor e gráficos

Quatro frentes sobre contratos comuns (`src/input/keymap.ts`, `src/ui/escStack.ts`, `src/inventory/types.ts`):
[DESKTOP_CONTROLS.md](DESKTOP_CONTROLS.md), [INVENTORY.md](INVENTORY.md), [EQUIPMENT_SYSTEM.md](EQUIPMENT_SYSTEM.md),
[INTERACTION_SYSTEM.md](INTERACTION_SYSTEM.md), [HUD.md](HUD.md), [PERFORMANCE.md](PERFORMANCE.md), [CHARACTERS.md](CHARACTERS.md).

- **Controles**: nenhum `requestPointerLock` no código; cursor sempre visível. Clique esquerdo (≤ 6 px / 400 ms) =
  selecionar/interagir; botão direito segurado + arrastar = câmera (esquerdo arrastando também, para trackpad); roda =
  zoom. Dirigindo, a câmera segue o rumo e volta atrás do veículo 1 s depois de soltar o botão direito. Teclas:
  WASD, Shift, Espaço, E usar, R/Q/C/F confronto (clique nunca soca), T/Z/X itens, **I inventário**, **1–5 acesso
  rápido**, G roda, Enter chat, M mapa, H/P HUD limpo, F1 controles, F3 desempenho. Esc com pilha única (modal →
  inventário → painel → menu do jogo: Continuar, Configurações, Controles, Áudio, Gráficos, Sair; o mundo não pausa).
  Tela de controles com remapeamento local. Campos de texto (inclusive SELECT) bloqueiam atalhos.
- **Seleção**: sem raycast contra malhas; com 500 bots em cena, 16 candidatos por quadro (nunca 500), hover
  0,009–0,013 ms/quadro, clique 0,003 ms; objeto distante é identificado ("CARRO · longe") mas não usado.
- **Inventário** (I ou botão no HUD): só categorias com conteúdo real — Roupas 26, Acessórios 5, Itens 4,
  Manifestação 6, Bandeiras 24, Equipamentos 3, Torcida 16, Títulos 3; filtros Todos/Equipados/Desbloqueados/Novos;
  slots HEAD/TORSO/LEGS/FEET/ACCESSORY/HAND/TITLE/SUPPORTER; equipar/desequipar com prévia 3D; acesso rápido 1–5 por
  tecla e clique; o servidor recusa item bloqueado/não possuído mesmo com DevTools (aparência estrita, arte, confronto,
  título). Título equipado persistido (migration expand `Profile.titleKey`); **nível e título públicos** no painel da
  pessoa (`NetPlayer.lvl`, `NetPlayer.title`).
- **Editor de personagem** de jogo (abas Corpo, Cabelo, Camisa, Calça/short, Calçado, Acessórios, Torcida; cadeados
  com motivo; desfazer/refazer/restaurar) e **prévia 3D compartilhada** (um 2º contexto WebGL reutilizado: 1,85 ms por
  quadro × 15,8 ms se desenhada no renderer do jogo). Corrigido defeito antigo: a prévia ficava "indisponível" ao
  reabrir o editor na mesma página.
- **Gráficos e interface**: preset e limite de FPS (30 / 60 / sem limite) aplicados ao vivo; ULTRA com MSAA 4× e
  anisotropia 16× (o automático nunca escolhe ULTRA); detecção por capacidades reais (sem penalizar o Safari); ajustes
  com abas (Geral, Áudio, Gráficos, Interface, Controles); escala da interface 80–125 %; reduzir movimento; indicador
  de zona permanente; avisos curtos de ação bloqueada; HUD sem sobreposição em 1366×768, 1440×900, 1920×1080,
  2560×1440 (17/17 layouts).

**QA de integração (master integrado, 2026-10-19)**: `npm run verify` 837/837; `test:db` 22/22; 18 roteiros verdes —
os 13 da rodada 10 (walkthrough 36/36, vehicles 24/24, vehicle_mount 26/26, interaction 44/44, supporters 10/10,
audio 27/27, combat 37/37, action_bar 38/38, social 12/12, trio 24/24, reconnect 18/18, items_zones 35/35, events
32/32) e os 5 da 11 (desktop_input 46/46 — `pointerLockElement` nulo em 14 situações; inventory 30/30; editor_preview
32/32; desktop_graphics 17/17; selection_500). Corrigidos na integração: popover da barra de ações escondido pelo
botão INVENTÁRIO; foco perdido ao fechar a barra com Esc; testes de servidor com portas sobrepostas (portas livres de
verdade em `tests/fixtures/freePort.ts`); teste de denúncia dependente de ordem assíncrona.

**Desempenho 10 × 11** (mesma máquina, `docs/bench/round11_compare_*.json`): servidor 500 densos tick 7,5 → 7,6 ms,
CPU 32 → 30 %; 50 veículos 0,41 → 0,38 ms; banda igual. Cliente (M5 Pro, sem vsync) FPS 10 → 11:

| bots | LOW | MEDIUM | HIGH | ULTRA |
|---|---|---|---|---|
| 50 | 464 → 481 | 237 → 242 | 94 → 94 | 76 → 77 |
| 250 | 427 → 430 | 222 → 232 | 80 → 81 | 63 → 63 |
| 500 | 410 → 459 | 219 → 212 | 78 → 77 | 63 → 60 |

Sem regressão (diferenças no ruído). Draw calls e triângulos iguais (HIGH 500 bots: 1525 → 1513 chamadas).

**Soak de 48 min** (build de produção, `SOAK_R11=1`: mouse e teclado reais — botão direito girando a câmera,
varredura de hover, inventário com seleção/prévia/equipar/desequipar, acesso rápido 1–3, menu do jogo e ajustes pelo
Esc — mais tudo da rodada 10: 60 bots sociais/confronto + 10 dirigindo, torcida, veículos, áudio, espectador, chat,
eventos; `screenshots/soak/round11b.json`): **estabilizou**. Heap pós-GC 71 → 93 MB no aquecimento e 94–102 MB depois
(+0,19 MB/min nos últimos 28 min, ruído de GC); GPU sem pós-processamento 534 → ~690 MB e plana (690–714 MB,
+0,4 MB/min); listeners 339–351; intervals 1–2; AudioNodes vivos 115–118; FPS 57–58; **`pointerLock` = 0 em todas as
amostras**. DOM 2027 → 2198: histórico do chat (limitado a 200 linhas). Um 1º soak (`round11.json`) acusou +10 MB/min
de GPU: era o medidor — a prévia 3D descarta o 2º contexto WebGL após 15 s ocioso e o navegador libera ~51 MB por
abertura sem `deleteTexture`; o livro-razão de QA agora tira da conta os objetos de contextos perdidos (sonda de 6
ciclos: total real plano, +51 MB/ciclo expurgados).

**Produção (2026-10-19 16:45 UTC)**: commit `7b69c7741fbf` em https://tretario.com.br pelo pipeline oficial — verificação
na VPS 837/837, backup pré-deploy `tretario-20261019T164534-7b69c7741fbf.dump` (sha256 ok), guarda "sem comandos
destrutivos", migration `20261019120000_round11_profile_title` aplicada, 145 s de deploy, **1,5 s fora do ar**, health
pronto, smoke do pipeline ok; release anterior (7bb3696) guardado para rollback. Smoke pela internet
(`tools/qa/prod_e2e.mjs`): visitante 6/6, jogador + XP + logout/login 5/5, rodada 10 8/8. **Por motor de navegador**
(login, entrar como jogador, botão direito gira a câmera, cursor nunca capturado, inventário I/Esc, Esc abre o menu,
WASD, FPS): **Chrome 10/10**; **WebKit (motor do Safari, Playwright 26.0) 9/10** — o único item é um erro que só o
instrumentador do Playwright enxerga: o SDK do Colyseus tenta de propósito `new WebSocket(url, {headers})` (forma do
Node), que lança no navegador e é capturado antes de cair na forma do navegador; num Safari real a exceção não escapa
e o jogo conectou normalmente; **Firefox: não testado** — o Firefox de teste do Playwright não abre neste macOS
(sandbox do processo auxiliar). Edge, Firefox e Safari reais não estão disponíveis nesta máquina.

**Limites conhecidos (rodada 11)**: sem menu contextual no botão direito curto (a câmera tem prioridade); sem modo
opcional "capturar mouse"; botões do mouse não são remapeáveis; não há arrastar do inventário para o acesso rápido
(fixa-se pelos botões 1–5); a prévia 3D custa ~93 MB de GPU enquanto aberta (2º contexto); aviso "Taco não pode ser
usado nesta zona" só aparece em zona de paz (hoje a avenida toda é confronto); navegadores reais nesta máquina: só
Chrome e Safari — Firefox/Edge não testados de verdade (ver smoke por motor abaixo).


## Rodada 10 — torcidas, interação direta, veículos montáveis, áudio e animação

Cinco frentes em paralelo sobre contratos comuns (`src/supporters/types.ts`, `src/interaction/types.ts`,
`src/vehicles/seats.ts`, `src/audio/bus.ts`), integradas no master. Detalhes: [SUPPORTER_GROUPS.md](SUPPORTER_GROUPS.md),
[INTERACTION_SYSTEM.md](INTERACTION_SYSTEM.md), [VEHICLE_MOUNTING.md](VEHICLE_MOUNTING.md), [AUDIO_SYSTEM.md](AUDIO_SYSTEM.md),
[COMBAT.md](COMBAT.md) ("Animação (rodada 10)"); visão de jogo em [GAMEPLAY.md](GAMEPLAY.md).

- **Torcidas**: Flamengo, Vasco, Fluminense, Botafogo e Neutro por dados (`public/gameplay/supporters.json`); camisas
  212–215 no shader a partir das referências do dono (sem escudo/fabricante/patrocinador), bandeiras/faixas 216–223;
  4 corpos, todos os LODs e multidão VAT sem draw call/textura extra; torcida no perfil (migration expand-first),
  troca pendente durante evento competitivo, `NetPlayer.sup`, concentrações e evento "Encontro das torcidas";
  troca de grupo de evento no meio de confronto agora adiada (placar e fogo amigo consistentes).
- **Interação**: `InteractionSystem` único (E/T, USAR, barra, clique, toque); alvo contextual por prioridade e
  distância; painel da pessoa só com dados públicos; denúncia de jogador (`user_report`); HUD de veículo; brechas
  fechadas em `onEnter` (veículo em RESETTING, eco do payload).
- **Veículos**: avatar sentado/montado com IK leve (0,05 ms por corpo), entrar/sair visíveis, carro com vidro
  translúcido e interior, pedalada pela distância, impulso no patinete, câmera por tipo, saída segura no servidor,
  reconexão sem duplicar.
- **Áudio**: 47 sons gerados por código (nenhum arquivo externo); orçamento 24 pontuais + 8 laços + 4 multidão + 2
  ambiente; multidão agregada por célula (500 pessoas → 4 vozes); trio/carro de som espaciais; volumes e mute.
- **Animação**: golpes nos tempos do `combat.json` (dados de combate intactos), máscara superior andando, cambaleio
  direcional, levantar de costas/de bruços a partir do ragdoll (juntas com limite — fim das "pernas para o ar").

**QA de integração (master integrado, 2026-10-18)**: `npm run verify` 759/759; `test:db` (PostgreSQL 16 real,
migrations do zero) 21/21; 13 roteiros multiplayer, **389 verificações, 0 falhas** — walkthrough 36/36, vehicles 24/24,
vehicle_mount 26/26, interaction 44/44, supporters 10/10, audio 27/27, combat 37/37, action_bar 38/38, social 12/12,
trio 24/24, reconnect 18/18, items_zones 35/35, events 32/32.

**Desempenho 9.1 × 10** (mesma máquina, mesma ferramenta, `docs/bench/round10_compare_*.json`):

| Servidor | tick médio (ms) | tick máx (ms) | CPU | RSS pico | banda/cliente |
|---|---|---|---|---|---|
| 50 densos | 1,10 → 1,15 | 2,8 → 3,5 | 9 → 9 % | 200 → 190 MB | 7,4 → 7,7 KB/s |
| 250 densos | 4,29 → 4,06 | 8,4 → 9,1 | 24 → 24 % | 197 → 195 MB | 14,3 → 14,4 KB/s |
| 500 densos | 8,89 → 9,11 | 12,9 → 16,3 | 35 → 37 % | 354 → 340 MB | 22,4 → 22,4 KB/s |
| 500 espalhados | 4,48 → 4,27 | 12,3 → 8,2 | 32 → 32 % | 309 → 243 MB | 10,4 → 10,2 KB/s |
| 50 veículos ativos (13 carros, 12 motos, 13 bicicletas, 12 patinetes) | 0,87 → 0,84 | 2,8 → 6,7 | 9 → 10 % | 187 → 188 MB | 3,7 → 3,6 KB/s |

| Cliente (M5 Pro, sem vsync) | FPS | CPU ms | GPU ms | draw calls |
|---|---|---|---|---|
| 250 bots LOW / MEDIUM / HIGH | 445→455 / 203→245 / 71→89 | 2,1→2,0 / 5,2→3,9 / 13,5→10,7 | 2,0→2,1 / 3,7→2,7 / 12,7→7,6 | 306→307 / 593→606 / 1511→1539 |
| 500 bots LOW / MEDIUM / HIGH | 430→439 / 186→238 / 74→85 | 2,1→2,1 / 5,1→4,0 / 12,9→11,5 | 1,8→2,1 / 2,9→2,8 / 6,9→7,7 | 309→312 / 596→607 / 1477→1520 |

Sem regressão: as diferenças estão no ruído da máquina (a 10 não ficou mais rápida de propósito). No banco do
cliente o áudio fica desligado (sem gesto); o custo do áudio foi medido à parte (≈0,1 ms/quadro com 500 bots).

**Soak de 48 min** (build de produção, 60 bots sociais/confronto + 10 dirigindo, torcida trocando, carro/moto/
patinete pelo InteractionSystem, áudio ligado, espectador, chat, debate, eventos; `screenshots/soak/round10.json`):
veredito **estabilizou**. Heap pós-GC 68 → ~100 MB nos primeiros 20 min e plano depois (97–101 MB); GPU sem as
superfícies de pós-processamento 516 → ~700 MB estável; listeners 208–210; intervals 1–2; ragdolls 0; AudioNodes
vivos 115–117 do início ao fim (3249 criados e reciclados); FPS 58; servidor RSS 141 → 150 MB. DOM 1276 → 1574:
histórico do chat (limitado a 200 linhas) e etiquetas de nome de quem está perto — limitado, não é vazamento.

**Produção (2026-10-19 03:18 UTC)**: commit `7bb36962ceca` em https://tretario.com.br pelo pipeline oficial —
verificação na VPS 759/759, backup pré-deploy `tretario-20261019T031801-7bb36962ceca.dump` (sha256 ok), guarda de
migration "sem comandos destrutivos", migration `20261018220000_round10_supporter_profile` aplicada, 137 s de deploy,
**1,5 s fora do ar**, health pronto, smoke do pipeline ok; release anterior (9f15cd7) guardado para rollback. Smoke
pela internet (`tools/qa/prod_e2e.mjs`): visitante 6/6, cadastro beta 3/3 (conta de QA nova aprovada), jogador +
XP + logout/login 5/5, **fase r10 8/8** (torcida pela API e na rede, áudio tocando, patinete pelo InteractionSystem,
avatar montado, saída, torcida salva após logout/login).

**Limites conhecidos**: sem teste em aparelho físico (iPhone/Safari, Windows, Firefox); sons não avaliados de ouvido;
porta do carro não abre (o corpo a atravessa na entrada/saída); cabines do trio/carro de som opacas; sem passageiros;
passo na grama nunca escolhido (o mundo não distingue grama de calçada); siglas das concentrações se sobrepõem no
minimapa expandido; VPS compartilhada, backup só na própria VPS, sem alerta externo.


## Rodada 9.1 — produção BETA ([PRODUCTION.md](PRODUCTION.md), [DEPLOYMENT.md](DEPLOYMENT.md), [OPERATIONS.md](OPERATIONS.md))

- **No ar**: https://tretario.com.br (selo BETA, cadastro com aprovação manual), HTTPS Let's Encrypt, multiplayer por
  WSS, nginx com CSP/HSTS/noindex, PostgreSQL só local, backup diário com restauração de teste, `/health` e
  `/metrics` com verificação periódica, deploy com ~1,5 s fora do ar, rollback e página de manutenção
  ([BACKUP_RESTORE.md](BACKUP_RESTORE.md), [MONITORING.md](MONITORING.md), [SECURITY_PRODUCTION.md](SECURITY_PRODUCTION.md),
  [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md)).
- **Verificado em produção**: progresso do jogador sobrevive a logout/login, deploy, reinício do serviço e reboot da
  VPS; soak de 62 min sem vazamento estrutural (texturas de billboard corrigidas); capacidade medida 50/100/250/500
  jogadores (500 bots: tick 13,5 ms, CPU 56 %) → limite beta 250 por sala, 300 espectadores.
- **Agenda** só do servidor; inscrição em evento sobrevive a reconexão/takeover; limites do grafite limpos.
- **Confronto** (decisão do dono): avenida toda COMBAT, sem áreas de paz, contra todos (jogadores e NPCs), itens de
  confronto direto da roda; golpe só de perto, com mira assistida e avanço curto ([COMBAT.md](COMBAT.md)).
- **Home/telões/espectador** sem rótulo de simulação; contador sem número inventado ("Alguns jogadores na avenida" com
  gente real, "Avenida movimentada agora" sem ninguém).
- **Barra de ações** inferior ([HUD.md](HUD.md)); itens podem ser largados.
- **QA** (2026-10-18, depois do último ajuste de alcance): `npm run verify` OK (655 testes); walkthrough 36/36 sem
  latência e com RTT 150 ms + jitter 30 (o empurrão continua acertando com o alcance de 1,6 m); `action_bar` 38/38;
  `tests/combatLatency.test.ts` 3/3 também com a CPU saturada (a instabilidade vista antes sob carga não se repetiu).
- **Limitações**: VPS compartilhada com outros sistemas; backup só na própria VPS (sem cópia externa); monitoramento
  sem alerta externo; ainda sem teste em aparelho físico (iPhone fora do Wi-Fi, Windows, Firefox).

## Personagens (rodada 9.1) — de perto, sem buracos e menos "robô"

Relato do dono (Mac, Chrome, produção): bonecos facetados de perto, "opacos, consigo ver através", cabelo com manchas
verdes/marrons, movimento robotizado. Reproduzido no build de produção com `tools/qa/char_probe.mjs` (inventário de
cada humano visível: esqueleto/instanciado, LOD, triângulos, materiais e recorte da pele) junto do carro de som.
Detalhes e números em [CROWDS.md](CROWDS.md#rodada-91-personagens-de-perto); imagens em `docs/screenshots/round9_1/`.

| Causa (com evidência) | Correção |
|---|---|
| A **multidão de concentração** (RallyCrowd, ao redor do trio/carros de som/palco — onde o dono estava) era **sempre instanciada** (`maxTier: 1`, desde a rodada 7; a rodada 9 pôs mais gente nos pontos de evento): no ALTO, 12–15 humanos a < 6 m da câmera eram a malha única LOD2 (2,5 k tri); no BAIXO, LOD3 (600 tri) a 2 m | os mais próximos da câmera disputam o esqueleto no orçamento como pedestres/remotos (pool de `HumanCharacter` por corpo; até metade do orçamento do preset, < 10 m); a < 6 m agora: ALTO 6 LOD0 + 6 LOD1 (+1–4 LOD2 instanciados no anel mais denso), MÉDIO LOD1, BAIXO LOD1 (2 mais próximos) |
| **Buracos/ver através** nas malhas únicas (LOD2/LOD3, instanciadas e com esqueleto): material da multidão VAT de **um lado só** — cartões de cabelo e bordas de roupa vistos por trás sumiam (via-se o chão); **pele decimada atravessando** camisa/calça (manchas de pele e da calça na camisa); cabelo com a **cor dos texels transparentes** assada no vértice (manchas verdes/marrons) | VAT com `DoubleSide`; camisa/calça afastadas pela normal no shader (1,4 cm LOD2, 2,2 cm LOD3; presa na gola); cabelo = cor da camada × luminância limitada (sem matiz dos texels transparentes). Folha antes/depois: `closeup_malha_unica_antes_depois.jpg` |
| Pedestre que chegava perto mostrava o **LOD3 com esqueleto** (600 tri) enquanto o LOD0 carregava/vestia (peças + recorte no Worker) — e por cima o instanciado (os dois desenhados) | `HumanCharacter.showingDetail`: o esqueleto só aparece com detalhe compatível; a malha única LOD2 (já baixada, sem vestir) cobre a espera em vez do LOD3 |
| BAIXO: nunca mais detalhado que LOD2, instanciado só LOD3 | 2 mais próximos (< 10 m) no LOD1; instanciado LOD2 < 10 m |
| QA: `__pv.lookFrom` não atualizava a matriz da câmera antes do frustum da multidão (sondas com câmera livre mediam a visibilidade da câmera anterior) | `camera.updateMatrixWorld()` na câmera livre |

Descartados com evidência: `dropLod` não solta o LOD em uso (só `!single && l ≠ pedido && l ≠ visível`); a máscara do
`hideCovered` é por par de geometrias e aplicada à mesma geometria (corpo/peça do mesmo LOD); nenhum `rotation.x` de
queda ficou em quem estava de pé (sonda: `rotX 0` em todos); materiais do LOD0/1 já eram `DoubleSide`, cabelo
`alphaTest 0,45` com `depthWrite` (sem ordenação de transparência). Não houve regressão nas rodadas 8.1–9.1: o defeito
existia desde a rodada 7 e ficou mais visível com as concentrações da rodada 9.

**Movimento** (prioridade do dono: "os movimentos dos avatares está muito ruim"):
- Jogador local e remotos (`AvatarVisual`): rumo visível com giro limitado (sem estalo), velocidade suavizada para a
  animação, inclinação do corpo para dentro da curva (ω·v) e para a frente/trás ao acelerar/frear; passada pela escala
  do corpo (sem patinar).
- Remotos: carimbo de tempo das amostras sem o jitter de chegada + filtro curto da posição desenhada. Variação da
  velocidade quadro a quadro andando reto (`tools/qa/remote_motion.mjs`): **CV 0,30–0,33 → 0,11–0,13** (desvio
  0,50–0,60 → 0,21–0,24 m/s a 1,8 m/s).
- Golpes reescritos como poses-chave (preparação → estalo → acompanhamento → recuperação): soco com torção do tronco
  e ombro, chute frontal com recolha/extensão/contrapeso, **taco a duas mãos** (carrega atrás do ombro, varre, acompanha),
  barra de cima para baixo. **Levantar** depois da queda: clipe novo (senta → agacha apoiando nos joelhos → endireita)
  em vez de misturar osso a osso da pose do chão ao idle (pernas para o ar no meio).
- NPCs: fase própria dos ciclos e andamento do parado por semente (grupos não respiram/andam em uníssono), troca de
  peso/olhar em volta no parado e postura própria andando (camada procedural, só de perto), giro limitado, ritmo
  oscilante ±6 %, chegada desacelerando; multidão VAT mistura parado↔andar e andar↔trote (antes trocava de ciclo de
  uma vez), cadência pela escala.
- Folhas antes/depois (12 quadros): `andar`, `correr`, `curva90`, `parar`, `pulo`, `queda_levantar`, `soco`, `chute`,
  `taco`, `barra`, `esquiva`, `remoto`, `multidao_movimento` (`*_antes.jpg` / `*_depois.jpg`).

**Desempenho** (M5 Pro, sem vsync, médias; ruído de ±5–10 % entre repetições):
- Bancada de multidão (bots densos, `crowd_bench_r91_antes.json` / `_depois.json`, FPS antes → depois): 50 bots
  BAIXO 431 → 469, MÉDIO 232 → 265, ALTO 92 → 102; 500 bots BAIXO 410 → 426, MÉDIO 166 → 202, ALTO 56 → 83 (draw calls
  iguais ±20, triângulos ±3 %; a diferença de FPS é sobretudo ruído da máquina). Em pares repetidos lado a lado: ALTO
  50 bots igual (95/93 vs 95/89 FPS); BAIXO 500 bots −6 % (+0,2 ms CPU, +16 draw calls, ~+50 MB de heap e +90 texturas:
  LOD1 dos 2 mais próximos e VAT LOD2).
- Junto do carro de som (sonda, `char_probe.json`): ALTO 569–627 → 625–953 draw calls, 2,0 → 2,1–2,9 M tri, 167 →
  119 FPS a 4 m (CPU 5,7 → 8,3 ms); ULTRA 4 m 107 → 99 FPS, 15 m 108 → 75 FPS (CPU 9 → 12,7 ms). Com vsync todos a 60.
  O custo extra é o orçamento de esqueletos do preset sendo usado onde antes ficava vazio.
- Testes: `npm run verify` OK; walkthrough 36/36; social_mp 12/12; combat_mp 37/37 (reações de NPC ao golpe intactas).

Pendências: VAT continua com normais de repouso (iluminação dos braços no LOD2/3 instanciado); cabelo do LOD2/3 ainda
mostra pontos do couro cabeludo; o primeiro LOD0 de uma combinação nova de roupa ainda espera o recorte no Worker
(coberto pelo LOD2); levantar começa no lugar do servidor (o ragdoll pode ter rolado — a pelve volta em 0,9 s);
ULTRA na concentração densa fica perto de 60 FPS sem folga em máquinas mais fracas que o M5 Pro.

## Rodada 9 — gameplay, confronto arcade, missões, progressão e eventos ([GAMEPLAY.md](GAMEPLAY.md))

| Item | Estado |
|---|---|
| Pulo | servidor valida chão, recarga (sem bunny hop), estado, veículo; altura balística conferida; outros veem impulso/trajetória/pouso (`jump_start`/`jump_land`) |
| Confronto | CombatSystem único por DADOS (`public/gameplay/combat.json`): soco, chute, empurrão, esquiva, combos, taco, barra, spray; preparação → janela ativa → recuperação; fôlego e condição abstratos; cambaleio, queda (ragdoll Rapier existente) e levantar com teto de segurança; proteção de retorno ([COMBAT.md](COMBAT.md)) |
| Autoridade | o cliente só pede "ação X nesta orientação"; alvo, alcance, arco, parede, janela, estado, zona/evento, fôlego e recarga no servidor; candidatos pela grade espacial; cliente forjado testado (100 m, zona de paz, 30 pedidos/s, item que não tem, alvo/dano inventados, teleporte) |
| Zonas | política por dados: PEACE / CONTESTED / COMBAT + áreas de paz (spawn, palco, anéis do trio e carros de som, retornos); a MESMA política vale para golpes, empurrão antigo e atropelamento. Decisão do dono 2026-10-18: avenida toda COMBAT, sem áreas de paz, sem consentimento (`zones.json` `combatConsent`/`derivedPeaceAreas`) — pacífico também é atingido; só a proteção de 5 s bloqueia; NPCs de ambiente reagem no cliente |
| Itens | taco/barra/spray na MESMA tabela de props (categoria COMBAT_PROP), em pontos de apoio e — desde 2026-10-18 (`freeCombatProps`) — direto da roda de ações; largar/trocar/guardar; os do apoio voltam ao apoio |
| Grupos | genéricos (POLITICAL/SUPPORTERS/NEUTRAL/CUSTOM); torcidas com nomes fictícios e camisas sem escudo; fogo amigo pela regra do evento; nenhuma diferença mecânica (testado com lados trocados) |
| Missões e progressão | 10 missões, 11 conquistas, níveis 1–10, recompensas cosméticas novas (camisas 208–211, designs); XP só por objetivo/missão/conquista/evento; persistente (lotes); caminho pacífico chega ao nível 6 ([MISSIONS.md](MISSIONS.md), [PROGRESSION.md](PROGRESSION.md)) |
| Eventos | agenda recorrente no servidor (SCHEDULED → REGISTRATION → STARTING → ACTIVE → FINISHED/CANCELLED); caminhada Central → Candelária (vista do alto pelas células), corridas de bicicleta e patinete (mesmo runner, checkpoints autoritativos, DQ por teleporte), confronto de grupos (protótipo) ([EVENTS.md](EVENTS.md), [RACES.md](RACES.md)) |
| Debate | palco em texto: fila, turnos com cronômetro (dados), moderação/denúncia/mute do chat, reações da plateia (não é pesquisa) ([DEBATES.md](DEBATES.md)) |
| HUD | Acontecendo agora, Agenda da avenida, rastreador de missão, PROGRESSO, HUD de confronto, MÃOS, controles de toque contextuais, "Reduzir efeitos visuais" |
| Telões | AdSlots (fundação, só conteúdo interno: agenda, eventos, avisos, arte) ([AD_SLOTS.md](AD_SLOTS.md)) |
| Testes | **587** automatizados (152 novos); `test:db` **18/18**; combat_mp **27/27**; items_zones_mp **35/35**; missions_mp **25/25**; events_mp **32/32**; debate_mp **24/24**; walkthrough **36/36**; chat **24/24**; reconexão **18/18**; espectador **16/16**; aéreo **17/17**; social **12/12**; trio **24/24**; pichação **26/26**; veículos **24/24**; persistência E2E **21/21**; build OK |

**Desempenho** (M5 Pro, máquina parada; `docs/screenshots/loadtest_round9*.json`, `crowd_bench_round9*.json`)

| | Rodada 8.1 | Rodada 9 |
|---|---|---|
| Servidor 500 densos (mesmas condições da 8.1): tick · CPU · banda/jogador | 8,1 ms · 32 % · 20,37 KB/s | 9,2 ms · 36 % · 20,59 KB/s |
| Servidor 500 densos realista (20 % social, grupos, chat, 8 % em confronto) | — | 9,3 ms · 39 % · 21,08 KB/s · validação de golpe 0,54 ms |
| Servidor 50 densos realista | — | 1,1 ms · 10 % · 5,77 KB/s |
| Cliente 500 LOW / MEDIUM / HIGH (realista, FPS sem vsync) | 408–434 / 197 / 70–74 | 405 / 197 / 71 (1528 draw calls) |
| Cliente 50 LOW / MEDIUM / HIGH | — | 456 / 241 / 78 |
| Estresse de confronto (todos em pares, denso) 100 / 200 / 400 / 600 / 800 | — | tick 2,1 / 4,0 / 7,4 / 12,8 / 19,1 ms · CPU 19 / 27 / 38 / 52 / 67 % · ELU 0,65 em 800 · banda/cliente 4,8 → 21 KB/s |
| Cliente com 100 lutadores perto (LOW / HIGH) | — | 449 / 81 FPS |
| Espectador aéreo 500 bots | 1,15 KB/s | spectator_aerial_mp 17/17 |
| Soak rodada 9 (32 min: missões, eventos, debate, treino de confronto, itens, quedas, espectador aéreo; 100 bots com 8 % em confronto) | — | 0 erros · 58 FPS · heap 66 → ~93 MB nos 4 primeiros min, depois 88–97 MB (deriva +0,16 MB/min) · GPU ~780–800 MB após 15 min · listeners 142 constantes · intervals 2–3 · ragdolls vivos 0 · DOM acompanha só os remotos (`docs/soak/round9.json`) |

**Limitações**: posições/NPCs de ambiente são locais por cliente; bots de carga não aplicam o próprio recuo (geram
correções no servidor); validação de golpe usa a grade de 110 m (≈ 0,3–0,5 ms por resolução); agenda/"Acontecendo agora"
nas capturas O/P vêm do roteiro de debate (agenda simulada para layout); NEGATIVA usa o gesto `talk`; o palco fica na
zona RIO_BRANCO; inscrição em evento não migra para a sessão nova no login duplicado; limites de pichação e retenção
de EventMembership sem limpeza; sem exclusão de conta; sem som.

## Rodada 8.1 — hardening de identidade, limpeza e espectador aéreo

| Item | Estado |
|---|---|
| Mute por IDENTIDADE | `MuteRelationship(ownerUserId, mutedUserId, mutedNicknameAtTime)`; alvo resolvido NO SERVIDOR (mensagem recebida, entidade no mundo ou `ref` da própria lista); `ref` opaco (HMAC) — nenhum userId sai para o cliente; filtro no servidor em GERAL, PROXIMIDADE, GRUPO e histórico; sobrevive a troca de apelido, logout/login e reinício do servidor; migração dos mutes antigos por apelido ([CHAT.md](CHAT.md)) |
| Denúncias | `targetUserId` + `reportedNicknameAtTime` (cópia do apelido na hora) no chat e na pichação |
| Limpeza | `CleanupService`: sessões vencidas/revogadas e códigos vencidos/usados (carência 60 min), tickets, limites de taxa e mapas do chat em memória; a cada `CLEANUP_INTERVAL_MINUTES` (10), primeira passada sem bloquear a subida; lotes idempotentes (várias instâncias); índices em `expiresAt`/`revokedAt`/`consumedAt`; log só com contagens; `npm run dev:cleanup` ([DATABASE.md](DATABASE.md)) |
| Espectador aéreo | camadas NEAR/MID/FAR/AGGREGATE pela altitude (histerese); FAR/AGGREGATE recebem células agregadas de 40 m (`spec_cells`, binário, ≤ 6 KB/s), calculadas uma vez para todos; jogadores reais e multidão de ambiente separados; impostores determinísticos pela seed da célula; minimapa usa as células ([SPECTATOR.md](SPECTATOR.md)) |
| Testes | **435** automatizados; `test:db` **15/15**; chat **24/24**; reconexão **18/18**; espectador **16/16**; espectador aéreo **17/17**; walkthrough **36/36**; persistência E2E **21/21**; build OK |

**Desempenho** (M5 Pro; mesmas condições da rodada 8: 60 % sociais, 3 grupos, 30 msgs/min)

| | Rodada 8 | Rodada 8.1 |
|---|---|---|
| Servidor 500 densos: tick · CPU · banda/jogador | 7,6 ms · 29 % · 20,36 KB/s | 8,1 ms · 32 % · **20,37 KB/s** |
| Servidor 50 densos: banda/jogador | 4,96 KB/s | **4,92 KB/s** |
| Cliente 500 LOW / HIGH (FPS sem vsync) | 436 / 75 | 408–434 / 70–74 (2 repetições)¹ |
| Espectador no chão (Central) 50 / 500 bots | — | 1,9 / 8,9 KB/s · 60 FPS |
| Espectador no alto (AGGREGATE) 50 / 500 bots | (500 entidades) | **0,3 / 1,15 KB/s** · **60 FPS** · 0 entidades, 916 impostores |
| Soak de câmeras 22 min (215 trocas, 200 bots) | — | heap 51 → 73 MB nos 2 primeiros min, depois plano (±1,3 MB); tendência pós-aquecimento **+0,04 MB/min**; GPU ~389 MB estável; 0 erros |

¹ Uma primeira medição deu 393/69 com outros apps pesados abertos na máquina (`docs/screenshots/crowd_bench_round8_1.json`);
repetida em seguida dá os valores da tabela. Draw calls e triângulos são os mesmos da rodada 8: o jogador não desenha
nada novo.

**Limitações**: posições dentro de uma célula aérea são ilustrativas (contagem, grupos e densidade são reais); multidão
de ambiente no alto é estimada pelos dados do evento; mute de visitante sem conta vale só na conexão; a lista de
mutados mostra o apelido da hora do mute; métricas da limpeza só no log (sem endpoint de admin); limites da pichação e
retenção de EventMembership sem limpeza; sem exclusão de conta.

## Rodada 8 — identidade, lados, chat, espectador e mundo persistente
Detalhes: [IDENTITY.md](IDENTITY.md) · [AUTH.md](AUTH.md) · [ACCESS_CONTROL.md](ACCESS_CONTROL.md) · [DATABASE.md](DATABASE.md) ·
[CHAT.md](CHAT.md) · [SPECTATOR.md](SPECTATOR.md) · [HUD.md](HUD.md) · [PRIVACY_ARCHITECTURE.md](PRIVACY_ARCHITECTURE.md)

| Item | Resultado |
|---|---|
| Home | própria, fundo da avenida, contagem do servidor ("N jogadores na avenida · multidão simulada ~360"), ASSISTIR GRÁTIS / PARTICIPAR / ENTRAR |
| Espectador | sem conta, mesmo mundo, sem corpo; 6 câmeras (livre limitada, Central, Campo de Santana, Candelária, trio/palco, aérea); clique → mundo em 3,3 s local · 5,2 s a 20 Mbit/s · 6,6 s a 10 Mbit/s — `spectator_mp` **16/16** |
| Conta | e-mail + senha (scrypt), verificação por código (DevelopmentMailProvider), login, logout, sessão HttpOnly restaurada, recuperação de senha, apelido único com reservados/variações; Google preparado só como interface |
| Banco | PostgreSQL local (docker-compose) + Prisma 7, migrations versionadas; `DataStore` único (Prisma / memória) |
| Acesso | VISITOR/REGISTERED/PLAYER/SUSPENDED/BANNED derivados; AccountAccess (DEV_GRANTED/PAID/STAFF) só pela CLI do operador (`npm run dev:grant-access`) ou pagamento (só mock); PaymentProvider + MockPaymentProvider, sem PIX/PSP |
| Avatar | editor do sistema modular, SURPREENDA-ME, salvo no servidor (validador único), igual em outro navegador |
| Grupos | GRUPO 13 / GRUPO 22 / NEUTRO por evento (dados); só aparência; neutralidade testada |
| Chat | GERAL / PROXIMIDADE (grade espacial, servidor escolhe destinatários) / GRUPO; anti-flood adaptativo; mutar, ocultar, denunciar (Report com evidência) — `chat_mp` **22/22** |
| Reconexão | período de graça de 20 s, uma entidade só, volta em ~3,5 s com posição/item; login duplicado: sessão nova assume — `reconnect_mp` **18/18** |
| HUD | concha própria que some sozinha, minimapa com manchas de densidade, zonas, nomes por distância (≤ 14, PRÓXIMOS por padrão), ajustes, layout de toque |
| Pichação | autoria por conta (interna), visitante/espectador não picha, denúncias viram Report |
| Testes | **408** automatizados; walkthrough **36/36**; ações 12/12; trio 24/24; pichação 26/26; veículos 24/24; persistência E2E 21/21; banco (`test:db`) 11/11; build OK |

**Desempenho** (M5 Pro; 60 % dos bots com ações/itens, 3 grupos, 30 mensagens de chat/min na multidão)

| | Rodada 7 | Rodada 8 |
|---|---|---|
| Servidor 500 densos: tick · CPU · banda/cliente | 8,5 ms · 31 % · 20,3 KB/s | 7,6 ms · 29 % · 20,4 KB/s |
| Cliente 500 bots LOW / MEDIUM / HIGH (FPS sem vsync) | 438 / 210 / 80 | 436 / 202 / 75 |
| Cliente 500 HIGH: CPU · GPU · draw calls | 11,9 · 7,6 ms · 1552 | 12,9 · 6,8 ms · 1518 |
| Soak 60 min (heap pós-GC; tendência últimos 30 min) | 61 → 81 MB, +0,04 MB/min | 62 → 84 MB, +0,05 MB/min (com chat + espectador) |

O "+0,49 MB/min" da rodada 7 era **aquecimento de cache**: nas duas medições de 60 min o heap sobe nos primeiros
~6 min e fica plano (docs/soak/).

**Limitações**: e-mail real (SMTP) e OAuth não implementados; limites de taxa/tickets em memória de um processo;
sem limpeza automática de sessões/códigos vencidos; sem exclusão de conta; sem tela dedicada para
"conta entrou em outra janela"; espectador com o mesmo raio de interesse dos jogadores; concessão nova vale na
próxima entrada.

## Rodada 7 — vida da manifestação (detalhes em [MANIFESTATION_SYSTEM.md](MANIFESTATION_SYSTEM.md), [EMOTES.md](EMOTES.md), [GRAFFITI.md](GRAFFITI.md))

| Critério | Resultado |
|---|---|
| Ações/emotes | 29 ações (13 gestos, 11 de manifestação, 5 danças) — registro único `src/social/actions.ts`; 39 clipes procedurais próprios; camada superior com máscara por osso (andar com bandeira/cartaz), crossfade 0,32 s |
| Roda de ações | G (desktop) / botão AÇÕES (toque): GESTOS · MANIFESTAÇÃO · DANÇA · ITENS (pegar/trocar design) |
| Multiplayer das ações | ids + início no relógio do servidor (mesma fase em todos); servidor valida; multidão distante: +5 B só de quem age — `social_mp` **12/12** |
| Itens | bandeira pequena/grande (tecido em shader, sem física, LOD), cartaz pequeno/grande/placa dupla (com espessura), faixa, megafone, apito, guarda-chuva, surdo, taco (só visual) — instanciados na multidão |
| CampaignDesign | designs neutros + campanhas como DADOS (`public/designs/campaigns.json`: exemplos 13 e 22, só nome/número/sigla/cores, marca "SIMULAÇÃO"); mesma geometria em bandeiras, cartazes, faixas, caminhões, telões, palco |
| Carro de som / trio elétrico | dirigíveis, autoritativos, pacíficos; trio com palco: jogadores sobem (até 20) e ficam presos à plataforma quando ele anda — `trio_mp` **24/24** |
| Caminhões, telões, palco | 4 caminhões de campanha (skins por design), 2 telões + telões do trio/palco (conteúdo próprio, sem vídeo remoto), palco junto à Candelária; LOD |
| Avatares | 31 peças variantes (regata, polo, camisa, bermuda, social, chinelo, sapato, 6 cabelos), 360 combinações de roupa; 100 aparências sorteadas → 100 distintas |
| Futebol carioca | 8 padrões (listras/aros/faixa/tricolor…) só com cores — sem escudos/marcas |
| Pichação/grafite | superfícies autorizadas (76), editor (traço, símbolos, texto filtrado), decalques em atlas, servidor autoritativo, denúncia/ocultar/admin, TTL, persistência local — `graffiti_mp` **26/26** |
| Concentração | RallyPoints (trio, carros de som, palco, caminhões): NPCs vão a pé; multidão de concentração instanciada (360 no ALTO) |
| Testes | **287** automatizados; walkthrough **36/36**; veículos 24/24; build OK |

**Desempenho** (M5 Pro; 60 % dos bots dançando/com bandeira/cartaz/gesticulando; evento padrão com NPCs sociais e multidão de concentração)

| | antes (avenida fechada) | rodada 7 |
|---|---|---|
| Servidor 500 densos: tick médio/máx | 7,7 / 12,6 ms | 8,5 / 10,5 ms |
| Servidor 500 densos: CPU · banda por cliente | 32 % · 17,3 KB/s | 31 % · 20,3 KB/s |
| Cliente 500 bots LOW / MEDIUM / HIGH (FPS sem vsync) | 466 / 262 / 100 | 438 / 210 / 80 (Rodada 6: 82) |
| Cliente 500 HIGH: CPU · GPU · draw calls · triângulos | 9,5 · 7,9 ms · 1431 · 4,78 M | 11,9 · 7,6 ms · 1552 · 4,57 M |
| Cliente 50 bots LOW / MEDIUM / HIGH | 474 / 315 / 125 | 472 / 239 / 97 |
| Memória ALTO (5 min de teleportes, heap pós-GC) | +0,02 MB/min | +0,49 MB/min (72 → 76 MB); GPU estável após o cache de peças |

**Pendências / limitações honestas**
- Sem barba (nenhum asset com licença compatível) e sem novos formatos de corpo (orçamento de download).
- A multidão instanciada não combina ação de braços com caminhada; LOD2/3 aproxima as roupas variantes por cor.
- Tecido de bandeira não colide com o corpo; o cós da calça ainda aparece levemente pela camisa de alguns corpos em
  certos ângulos; frestas mínimas na axila com o braço todo erguido no LOD1.
- Sem áudio (carro de som/trio mudos — nada de música comercial).
- Pichação: identidade anônima por aparelho até haver login; filtro de texto básico; sem painel de administração.
- Pedestres NPC continuam locais por cliente (a multidão real vem dos jogadores).

## Antes da rodada 7 — avenida fechada (detalhes em [SHARED_WORLD.md](SHARED_WORLD.md))
A Presidente Vargas está **fechada ao trânsito convencional**: não existe mais trânsito NPC. Os veículos são dos
jogadores, ficam estacionados e só se movem quando alguém os usa.

| Item | Situação |
|---|---|
| Trânsito NPC | **removido** (`TrafficSim`, `TrafficSystem`, rotas, geração e snapshot `traffic`; semáforos ficam visuais) |
| Veículos utilizáveis | 89 estacionados: 14 carros, 12 motos (nova, procedural), 38 bicicletas, 25 patinetes; nunca no meio da avenida (> 12 m do eixo) |
| Interação | `E — USAR <VEÍCULO>`; servidor autoritativo com estados `AVAILABLE` / `OCCUPIED` / `RESETTING`; um controlador por veículo; ao sair fica parado e disponível |
| Controles | carro: acelera, freia/ré, esterça, entra/sai · moto/bicicleta/patinete: acelera, freia, esterça, entra/sai |
| Limites urbanos | carro e moto 30 km/h, bicicleta 25, patinete 20 (servidor valida) |
| Modo pacífico | sem atropelamento, dano ou ragdoll: o veículo para antes de encostar (`vehicleBlock`, mesma regra no cliente e no servidor) |
| Cenário de via fechada | 4 ônibus estacionados (só cenário, com colisão), gradis atravessando as pistas nas duas pontas com passagens para pedestres, placas "VIA INTERDITADA" ([fotos](screenshots/round7/)) |
| Testes | **118** automatizados (103 − 4 do `TrafficSim` removido + 19 novos em `tests/closedAvenue.test.ts`); walkthrough multiplayer **36/36**; `vehicles_mp` **24/24**; build de produção OK |

**Servidor** (`server/tools/bots.ts`, `docs/screenshots/loadtest.json`; M5 Pro):

| Cenário | Tick médio / máx | CPU | Saída por cliente |
|---|---|---|---|
| 50 bots densos | 0,75 / 2,2 ms | 7,8 % | 6,8 KB/s |
| 500 bots densos | 7,7 / 12,6 ms (antes 9,5 / 19,5) | 32 % | 17,3 KB/s (antes 18,8) |
| 50 bots espalhados | 0,33 ms | — | 1,7 KB/s |
| 500 bots espalhados | 3,3 / 8,1 ms | — | 9,0 KB/s |

**Cliente** (`tools/qa/crowd_bench.mjs`, sem vsync): 50 bots — LOW 474 FPS, MEDIUM 315, HIGH 125;
500 bots — LOW 466, MEDIUM 262, HIGH **100 FPS** (antes 82; 1431 draw calls, heap 270 MB).

**Corrida fluida** (`tools/qa/run_hitch.mjs`, Chrome com janela real, tela de 120 Hz, 40 s correndo em multiplayer):
corrida a 5,8 m/s (~21 km/h; servidor valida até 6,4 m/s a pé); jogo em 60 FPS constantes (antes alternava 8/17 ms);
nenhum quadro longo (antes 50–100 ms quando um pedestre próximo ganhava o modelo detalhado: as texturas 2048²
subiam todas num quadro — agora limitadas a 1024 px e enviadas à GPU uma por quadro antes de aparecer).

**Roupa sem "rasgos"**: o corpo (mais musculoso) atravessava a camiseta nos ombros/costas e a calça atravessava a
camisa na cintura. Agora, ao carregar cada corpo/LOD, a pele e a calça que ficam sob a roupa são escondidas (raio pela
normal contra os triângulos da roupa, longe das bordas: sem buracos em golas e decotes — `src/characters/human/hideCovered.ts`,
calculado num Web Worker: ~6 ms na thread principal) e a camiseta é afastada 8 mm da pele (14 mm no LOD1). Conferido
nos 4 corpos, LOD0 e LOD1, de frente/costas, parado/andando/correndo.

**Notas honestas**
- Os carros estacionam **sobre a calçada, encostados no meio-fio** (as vagas são amostradas ao longo das fachadas).
  Funciona e não bloqueia a passagem, mas o ideal seria uma faixa de estacionamento no asfalto.
- O modo interação (`impactAllowed`) continua com o empurrão antigo; nenhuma mecânica nova de PvP foi criada.
- Veículos abandonados voltam à vaga depois de 5 min sem ninguém por perto (`PV_VEH_RESET_MS` para testes).

## Rodada 6 — resumo (detalhes em [WEB_PRODUCT.md](WEB_PRODUCT.md))
| Critério | Resultado |
|---|---|
| Memória | heap 320 → 140–183 MB no jogo (após GC 267 → 119 MB); sem crescimento contínuo em 5 min ([MEMORY.md](MEMORY.md)) |
| Aparelho → preset seguro | iPhone → MÉDIO 30 FPS + resolução dinâmica; integrada → MÉDIO/BAIXO; resolução dinâmica em todos |
| Safari (Mac, real) | 15–19 FPS → **58–60 FPS** no ALTO automático |
| iPhone real / Windows integrado / Firefox | **pendentes** — dependem de aparelho/ambiente (instruções em WEB_PRODUCT.md) |
| Carregamento 4G lento, 1ª visita | 27,6 s → 20,7 s até andar; 3,6 MB antes de jogar; 2ª visita 2,7 s |
| 500 bots | servidor 33 % de um núcleo; cliente HIGH 82 FPS (antes 6) ([CROWDS.md](CROWDS.md)) |
| Reconhecimento da avenida | 41 prédios com modelo próprio ([RECOGNITION_BUILDINGS.md](RECOGNITION_BUILDINGS.md)) |
| Testes | 103 automatizados; walkthrough multiplayer 28/28; build OK |


## Rodada 5 — antes / depois (mesmas poses, 10:30, HIGH)
| | |
|---|---|
| ![](screenshots/r5_compare/A.jpg) | A — personagem (antes: boneco de primitivas · depois: humano MakeHuman) |
| ![](screenshots/r5_compare/B.jpg) | B — personagem na Presidente Vargas |
| ![](screenshots/r5_compare/C.jpg) | C — Central do Brasil |
| ![](screenshots/r5_compare/D.jpg) | D — avenida |
| ![](screenshots/r5_compare/E.jpg) | E — Palácio Duque de Caxias |
| ![](screenshots/r5_compare/F.jpg) | F — Candelária |
| ![](screenshots/r5_compare/G.jpg) | G — veículos e pedestres |

Noite (21:30): `screenshots/r5_after/noite/` · LOW: `screenshots/r5_after/low/` · detalhes por área:
[CHARACTERS.md](CHARACTERS.md), [VEHICLES_VISUAL.md](VEHICLES_VISUAL.md), [VEGETATION.md](VEGETATION.md),
[LANDMARKS.md](LANDMARKS.md), [BUILDINGS_LIGHTING.md](BUILDINGS_LIGHTING.md).

### O que mudou
- **Personagens**: boneco de primitivas removido (fica só como reserva invisível). Humanos MakeHuman (CC0/CC-BY) com rosto,
  olhos, sobrancelhas, cílios, cabelo, camiseta/jeans/tênis como **camadas separadas** sobre um esqueleto de 53 ossos;
  4 corpos; LOD0 32–37 k triângulos, LOD1 ~12 k, LOD2 2,5 k (1 draw call), LOD3 600; animação de captura (Quaternius,
  CC0) retargetada; Idle↔Walk↔Jog↔Sprint com crossfade e passada casada com a velocidade; ragdoll no novo esqueleto.
  Masculino reforçado a pedido (músculo, ombros, gola careca).
- **Veículos**: sedã, hatch, SUV, táxi carioca e ônibus modelados (Blender procedural), vidros, faróis, rodas/pneus, 2 LODs,
  1 draw call por modelo/LOD.
- **Vegetação**: árvores ez-tree (MIT) com mistura de espécies do censo do Centro (oiti predominante, amendoeira, cássia,
  ficus, munguba, ipê, palmeira), 3 LODs (malha, simplificada, impostor), BatchedMesh.
- **Mobiliário**: postes de braço duplo, semáforos, abrigos, bancos, lixeiras Comlurb, bancas, balizadores refeitos.
- **Landmarks**: Central (torre de 110 m + antenas, relógio de 10 m, alas), Candelária (massa conforme OSM, fachada em
  duas ordens, torres, cúpula 62,3 m), Palácio Duque de Caxias (torre recentralizada — estava 28 m deslocada; granito
  cinza-rosado; ritmo art déco), **CCBB** dedicado. Texturas CC0 Poly Haven.
- **Prédios comuns**: fachadas por prédio (reboco, concreto, pedra, pastilhas, pele de vidro, azulejo), janelas variadas com
  recesso (paralaxe), aparelhos de ar, brises, térreos comerciais com letreiros genéricos, parapeitos, marquises, caixas d'água.
- **Chão**: rachaduras finas e esparsas, granito no meio-fio, pedra portuguesa, sinalização com medidas do manual brasileiro.
- **Luz/céu**: céu próprio (azul saturado, horizonte úmido, cúmulos), IBL com silhueta de cidade, neblina na cor do
  horizonte; data/hora reais preservadas.

### Métricas (M5 Pro, Chrome headless 1280×720, multiplayer com 10 bots, `tools/qa/bench_presets.mjs`; todos a 60 FPS)
| Preset | CPU ms (r4 → r5) | GPU ms (r4 → r5) | Draw calls | Triângulos | Heap JS |
|---|---|---|---|---|---|
| LOW | 1,5 → 1,9–2,3 | 2,9–3,2 → 3,3–4,4 | 131–346 | 269–566 k | 245–333 MB |
| MEDIUM | 1,7–1,9 → 2,8–2,9 | 3,3–4,3 → 4,4–4,6 | 220–469 | 567–921 k | 282–309 MB |
| HIGH | 3,0–3,3 → 5,1–5,4 | 11–13 → 9,1–11,9 | 617–1032 | 1,87–2,75 M | 429–485 MB |
| ULTRA | 3,1–4,4 → 6,1–6,9 | 10–12 → 9,2–11,2 | 633–1135 | 1,94–2,87 M | 442–461 MB |

Custo isolado dos 56 NPCs humanos (alternando 0↔56 na mesma sessão): +0,15 ms CPU, +43 draw calls, +57 k triângulos.
Download novo: personagens 8,9 MB no total (inicial ~2,5 MB: animações + LOD0 do próprio avatar + LOD3 dos 4 corpos; resto
em segundo plano), veículos 0,42 MB, vegetação 0,48 MB, texturas de landmarks 0,47 MB; código +40 KB gzip.

### Validação
- 71 testes automatizados; build de produção OK; walkthrough multiplayer com 3 clientes **28/28** (inclui empurrão,
  ragdoll no esqueleto novo, levantar, impacto, carro, colisão no servidor, acessório sincronizado).

### Teste crítico (respostas honestas)
1. **O personagem ainda parece feito de primitivas?** Não. É uma malha humana com anatomia, rosto e roupas separadas.
   Ainda sem animação facial; cabelos em "cards" com borda serrilhada de perto.
2. **A cena ainda parece low-poly/Roblox?** Em grande parte não (árvores, carros, céu, personagens, landmarks). Ainda
   abaixo de um jogo comercial: prédios comuns são volumes de caixa com fachada em shader (sem varandas reais), traseira
   do ônibus simples, folhas de espécies temperadas recoloridas.
3. **Quem conhece o Centro reconheceria a Presidente Vargas?** Pela Central (torre do relógio) e pela Candelária ao fundo
   do eixo da avenida, com canteiros e pistas largas, provavelmente sim. Os prédios da avenida ainda não são os prédios
   reais um a um (estilo atribuído por semente, OSM sem material/cor).

### Riscos
- **Heap JS dobrou** (≈150–250 → 245–485 MB): principal risco para celular. Precisa de perfil de memória (texturas
  retidas, geração de vegetação, cópias de geometria) antes de testar em aparelho real.
- CPU no HIGH/ULTRA subiu ~2 ms (animação de remotos/NPCs, vegetação, ajuste por LOD).
- Personagens: 8,9 MB de GLBs; KTX2/Basis para texturas reduziria memória de GPU (não feito).
- Safari/iPhone/Firefox/Windows continuam **não testados**.

_Atualizado em 2026-10-16 (rodada 4: vertical slice multiplayer jogável — somente local, sem deploy)._

## Tela inicial — montagem do personagem
| | |
|---|---|
| ![](screenshots/tela_inicial.jpg) | ![](screenshots/tela_inicial_mobile.jpg) |
| Prévia 3D (o mesmo personagem do jogo), poses e painel de visual | Celular: empilhado, botão de entrar sempre visível |

- Prévia 3D com arrastar para girar, botões ↶ ↷ e poses **Parado / Andando / Acenando / Dançando** (`src/ui/AvatarPreview.ts`).
- Cartões com **retratos renderizados** dos 4 personagens, atualizados com as cores escolhidas.
- Nome, tom de pele, cabelo, camisa, calça/saia, calçado, acessório e cor do acessório; botão "Aleatório".
  Tudo salvo no navegador e enviado ao servidor (o **acessório agora também é sincronizado** no multiplayer).
- Qualidade gráfica e controles em menus no topo. Fundo: render da própria avenida (`public/ui/start-bg.jpg`, 187 KB).
- Custo: JS inicial 5,1 KB gzip (antes 2,8 KB); a prévia usa o three.js já pré-buscado para o jogo e é descartada ao entrar.
- Sem login, sem times políticos e sem itens pagos (decisões do produto e ADR-008).

## Rodada 4 — vertical slice multiplayer
| | |
|---|---|
| ![](screenshots/vertical_slice/01_tres_jogadores.jpg) | ![](screenshots/vertical_slice/02_A_dirigindo.jpg) |
| A, B e C na mesma sala (avatares sincronizados) | A dirigindo o car0; B vê o carro onde ele está |
| ![](screenshots/vertical_slice/03_B_caida_ragdoll.jpg) | ![](screenshots/vertical_slice/04_impacto_veiculo.jpg) |
| Empurrão validado pelo servidor → ragdoll (Rapier) | Impacto de veículo (sem dano, sem conteúdo gráfico) |
| ![](screenshots/vertical_slice/palacio_duque_caxias.jpg) | GIFs: [dirigindo](screenshots/vertical_slice/dirigindo.gif) · [empurrão](screenshots/vertical_slice/empurrao.gif) · [impacto](screenshots/vertical_slice/impacto.gif) |
| Palácio Duque de Caxias dedicado (bloco + embasamento + torre ~82 m) | |

- **Servidor autoritativo com colisão**: a mesma geometria de paredes (`src/physics/walls.ts`, 64.604 segmentos,
  `collision.<hash>.bin`) é usada no cliente e no servidor; o caminho proposto é validado contra prédios, muros e limites.
- **Mundo compartilhado** ([SHARED_WORLD.md](SHARED_WORLD.md)): relógio global (NTP simplificado), semáforos como função
  do relógio (135/135 iguais), trânsito simulado no servidor (`TrafficSim` puro) e enviado em snapshots de 12 B/veículo.
- **Carro dirigível** (E entra/sai, W/S acelera/freia/ré): posse validada no servidor; dois jogadores não ocupam o mesmo carro.
- **Empurrar / impacto de veículo** validados no servidor (distância, ângulo, linha livre, cooldown, limite de taxa, modo,
  estado, imunidade de 5 s); **pacífico é o padrão**; queda com ragdoll Rapier e levantar.
- **Netcode** ([NETCODE.md](NETCODE.md)): predição, reconciliação por `seq`, interpolação adaptativa, AOI com `StateView`,
  movimento compacto, simulador de latência/jitter/perda.
- **Walkthrough com 3 clientes**: `node tools/qa/walkthrough.mjs` → **27/27** a 0 ms e **27/27** a 150 ms ± 30 ms.
- **Testes**: 65 automatizados (Vitest); o hook de pre-commit verifica exatamente o conteúdo staged.

### Métricas da rodada 4 (M5 Pro, Chrome headless 1280×720, com vsync, 10 bots, `tools/qa/bench_presets.mjs`)
| Preset | CPU (ms) | GPU (ms) | Draw calls | Triângulos | Heap JS |
|---|---|---|---|---|---|
| LOW | 1,5–1,6 | 2,9–3,2 | 117–341 | 243–379 k | 148–174 MB |
| MEDIUM | 1,7–1,9 | 3,3–4,3 | 195–474 | 548–755 k | 175–190 MB |
| HIGH | 3,0–3,3 | 11,1–13,1 | 467–1029 | 1,61–1,89 M | 246–250 MB |
| ULTRA | 3,1–4,4 | 10,3–12,0 | 540–1149 | 1,98–2,28 M | 241–254 MB |

Rede por jogador (detalhes em [PERFORMANCE.md](PERFORMANCE.md)): ~1,8–4,8 KB/s recebidos e ~0,67 KB/s enviados.

## Rodada 3 — antes / depois
| Antes | Depois |
|---|---|
| ![](screenshots/antes/ccbb.jpg) | ![](screenshots/depois/ccbb.jpg) |
| CCBB: sobrado genérico de 9 m | CCBB: bloco eclético de 31 m (override com fonte) |
| ![](screenshots/antes/central.jpg) | ![](screenshots/depois/central.jpg) |
| Central vista da avenida | Panteão de Caxias em granito + estátua equestre |

| Novidades | |
|---|---|
| ![](screenshots/depois/galeria.jpg) | ![](screenshots/depois/galeria_dentro.jpg) |
| Galerias reais dos prédios PA | Caminhando sob a colunata |
| ![](screenshots/depois/travessia.jpg) | ![](screenshots/depois/evento_classico.jpg) |
| Semáforos funcionais + travessia | Evento "clássico" genérico: banners e painel de LED |
| ![](screenshots/depois/bicicleta.jpg) | ![](screenshots/depois/multiplayer.jpg) |
| Bicicleta de estação real | Multiplayer local: B vê o Jogador_A |

### Métricas (Apple M5 Pro, Chrome 155, 1920×1080, 16:30, sem vsync; com vsync todos ficam em 60 FPS)
| Preset | Frame (ms) | Draw calls | Triângulos | Pedestres | Veículos |
|---|---|---|---|---|---|
| LOW | 1,8–2,0 | 152–318 | 171–276 k | 14 | 24 |
| MEDIUM | 2,0–2,3 | 251–447 | 454–543 k | 32 | 48 |
| HIGH | 4,4–4,9 | 560–944 | 1,22–1,43 M | 56 | 80 |
| ULTRA | 4,6–4,8 | 594–1072 | 1,51–1,93 M | 90 | 110 |
| Mobile (emulação iPhone 14) | 60 FPS | 130 | 144 k | 12 | 20 |

Cidade viva medida em 60 s num cruzamento (HIGH): até **24 pedestres atravessando** ao mesmo tempo e até **32 veículos parados
no vermelho**. 135 cruzamentos semaforizados, 791 linhas de retenção.

**Testes:** 46 automatizados (Vitest), build de produção OK, `npm audit` 0 vulnerabilidades (cliente e servidor),
QA e2e multiplayer com 2 navegadores (`tools/qa/multiplayer.mjs`).

## Histórico (rodadas 1–2)

| | |
|---|---|
| ![](screenshots/central.jpg) | ![](screenshots/central_praca.jpg) |
| 1. Central vista da Presidente Vargas | Central vista da Praça Cristiano Ottoni |
| ![](screenshots/avenue.jpg) | ![](screenshots/mid.jpg) |
| 2. Início da avenida rumo à Candelária | 3. Região intermediária (Passos/Saara) |
| ![](screenshots/candelaria.jpg) | ![](screenshots/candelaria_fachada.jpg) |
| 4. Candelária vista da avenida (abside + cúpula + torres) | Fachada leste (Rua 1º de Março / Praça Pio X) |
| ![](screenshots/corredor_aereo.jpg) | ![](screenshots/noite.jpg) |
| Vista aérea do corredor (debug) | Noite (horário real) |

## Novidades (Fase 1 — vida na avenida)
| | |
|---|---|
| ![](screenshots/transito.jpg) | ![](screenshots/pedestres.jpg) |
| Trânsito nas faixas reais da Pres. Vargas | Pedestres NPC nas calçadas |

- **Personagens com esqueleto real** (SkinnedMesh, 17 ossos, 1 draw call): **homem, mulher, idoso, idosa**,
  com tons de pele, cabelo e roupas variados. Idosos andam mais devagar e com postura curvada. Escolha na tela inicial (`?avatar=`).
- **Pedestres NPC**: 14 / 32 / 56 (BAIXO/MÉDIO/ALTO) ao redor do jogador. Andam só por calçadas, praças e canteiros, desviam
  de prédios, uns dos outros e do jogador, e param às vezes. Têm LOD de animação e de sombra.
- **Trânsito**: 24 / 48 / 80 veículos (carros, **táxis amarelos com faixa azul**, ônibus) nas **884 faixas geradas do OSM**
  (269 na Pres. Vargas), no sentido real e com mão direita (testado). Seguem o veículo da frente, **param para o jogador**, acendem os faróis à noite.
  O jogador não atravessa os veículos.
- Custo medido (M5 Pro, sem vsync): +0,1 a 0,3 ms por frame. Ainda não há semáforos com ciclo: os veículos não param no vermelho (passo 1.5).

## O que funciona
- `npm install && npm run dev` → http://localhost:5173 → tela inicial → **EXPLORAR** → spawn na Pres. Vargas,
  em frente à Central. A intro enquadra a torre do relógio e depois gira para a avenida.
- **Geografia real (OSM)**: 8.282 edifícios com footprint real (97 % com altura real), 896 trechos de rua,
  68 trechos da Pres. Vargas (pistas centrais e laterais com número de faixas), 318 travessias, 435 semáforos,
  647 árvores, trilhos da SuperVia, VLT, plataformas, gradis, Campo de Santana com lago.
- **Sistema de coordenadas** lat/lon ↔ mundo (1 u = 1 m), origem documentada, ida e volta < 1 mm.
- **Pipeline GIS reproduzível** (`npm run map:fetch`, `npm run map`) com dado bruto e processado separados.
- **Superfícies**: asfalto com união booleana, esquinas arredondadas, meio-fio de 15 cm com capa de granito,
  calçadas e canteiros em pedra portuguesa, praças com ondas pretas e brancas, gramados, brita e dormentes, água.
- **Sinalização**: faixas tracejadas, eixo amarelo duplo, faixas de pedestres zebradas, recortadas nos cruzamentos.
- **Landmarks dedicados**: Central do Brasil (bloco streamline do footprint real, torre art déco com
  setbacks, relógio de 4 faces com a hora real, mastro) e Candelária (abside, naves, transepto, tambor
  com estátuas e balaustrada, cúpula nervurada com lanterna até 62,3 m, duas torres com cúpulas bulbosas,
  frontão, portais, embasamento e escadaria).
- **Edifícios procedurais** com shader de fachada (5 estilos, paletas do Centro, comércio com portas de
  aço e letreiros, galerias no térreo, anti-moiré, janelas acesas à noite) e volumes de cobertura.
- **Mobiliário instanciado**: árvores com vento (3 tipos), postes de braço duplo, semáforos, bancos,
  abrigos de ônibus, lixeiras laranja da Comlurb, bancas de jornal, balizadores.
- **Iluminação física**: sol na posição astronômica real para **data e hora reais do Rio**, céu
  Preetham, nuvens, IBL, sombras, ACES, neblina; à noite, luar, janelas, luminárias e luzes reais nos postes próximos.
- **Personagem placeholder** humano procedural: idle, walk, run, pulo, giro e parada suaves.
- **Controles** WASD, Shift, Espaço, mouse com pointer lock, roda e Esc; **toque**: joystick, arrasto, pinça e botões.
- **Câmera 3ª pessoa** suave, com zoom limitado e colisão com prédios e chão.
- **Colisão** com prédios e landmarks, subida de meio-fio, plataformas e água bloqueiam, limite do mundo.
- **Chunks (250 m) + LOD** FULL/MEDIUM/FAR com histerese, streaming por distância e orçamento por frame.
- **Presets** BAIXO/MÉDIO/ALTO + detecção automática; **DEBUG (F3)**; **minimapa (M)**; **pontos de validação**
  (32) no HUD.
- **Bundle inicial ~9 KB**; motor carregado sob demanda; chunks com hash e cache imutável (`public/_headers`).
- **Testes**: 27 automatizados (incluindo faixas de tráfego e mão direita) (projeção, sol, presets, colisão/movimento, orientação das paredes,
  integridade e geografia dos dados). `npm run build` sem erros.

## FPS medido
Apple M5 Pro, Chrome 155, 1920×1080, 16:30 com sombras (detalhes em [PERFORMANCE.md](PERFORMANCE.md)):

| Preset | Com vsync | Sem vsync (frame) | Draw calls | Triângulos |
|---|---|---|---|---|
| BAIXO | 60 FPS | ~1,5–1,9 ms | 114–289 | 150–250 k |
| MÉDIO | 60 FPS | ~1,9–2,0 ms | 177–391 | 370–475 k |
| ALTO | 60 FPS | ~4,0–4,6 ms | 386–816 | 0,96–1,23 M |

Tempo até jogável (build de produção, localhost): **1,4 s**; tela inicial em **78 ms**.
Mobile (emulação de iPhone 14 no Chrome, BAIXO): 60 FPS, sem erros, joystick funcionando.

## Navegadores testados
| Navegador | Situação |
|---|---|
| Chrome 155 (macOS, desktop) | ✅ testado (automatizado: screenshots, métricas, build de produção) |
| Chrome, emulação de iPhone 14 | ✅ testado (toque, layout, preset automático) |
| Safari macOS | ⚠️ **não testado**: a automação exige ativar "Allow Remote Automation" no Safari. Código restrito a WebGL2 padrão; **teste manual necessário** |
| Safari iPhone | ⚠️ **não testado** em aparelho real. Teste manual necessário (prioridade) |
| Firefox | ⚠️ **não instalado** nesta máquina. Teste manual necessário |

## Incompleto / limitações conhecidas
- **Relevo**: o mundo é plano. Os morros (Providência atrás da Central, São Bento, Conceição) aparecem planos,
  com as casas no nível 0.
- **Túneis, viadutos e acessos de metrô** não modelados (excluídos do pipeline).
- **Landmarks**: volumetria reconhecível, mas a ornamentação é simplificada. Várias medidas são
  **estimativas** (ver MAP_VALIDATION). Detalhamento artístico no Blender recomendado.
- **Fachadas** procedurais: plausíveis, sem correspondência individual. Os prédios altos ainda ficam
  parecidos entre si (grade de janelas). Os prédios históricos nomeados não têm modelo próprio (classe B só no shader).
- **Personagens** procedurais estilizados (sem rosto detalhado/roupas com textura). Trocar por GLB rigado com o mesmo esqueleto.
- Cada personagem usa uma textura de ossos: com 56 pedestres, o total de texturas sobe de ~43 para ~100 (sem impacto medido).
- Avenida fechada (rodada 7): não há trânsito NPC; pedestres não atravessam na faixa (ainda).
- **Postes** da Pres. Vargas em parte procedurais; espécies de árvores genéricas.
- Copas de árvore estilizadas (sem folhas/alpha cards).
- Sem veículos, pedestres ou áudio (fora do escopo desta etapa).
- Desempenho em GPU fraca e celular real **não medido**.
- O teleférico da Providência aparece como laje elevada isolada (dado OSM `min_height`).
- A geração das texturas roda na thread principal (~0,5–1 s no loading).

## Próximos passos sugeridos
1. **Validação humana** com [MAP_VALIDATION.md](MAP_VALIDATION.md): posição e altura da torre da Central,
   orientação da Candelária, larguras da avenida.
2. Testar em Safari (macOS e iPhone) e Firefox; medir em notebook Intel e em celular real.
3. Relevo (MDT aberto) para os morros do entorno.
4. Landmarks no Blender (GLB + Meshopt), com LOD; modelos dedicados para mais prédios B
   (Palácio Duque de Caxias, Correios, Itamaraty, prédios PA da avenida).
5. Mais variedade de fachadas (pele de vidro dos anos 70/80, pastilhas, marquises) e copas com folhagem real.
6. Texturas e malhas em Web Workers; occlusion queries.
7. Personagem rigado definitivo; depois, `RemotePlayer` e servidor (ver [CROWD_ARCHITECTURE.md](CROWD_ARCHITECTURE.md)).
