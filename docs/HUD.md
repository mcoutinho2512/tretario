# HUD, minimapa, zonas e nomes (rodada 8)

Identidade própria: **o cenário é o protagonista**. Pouca coisa fixa na tela, tudo discreto e translúcido, e o HUD
some sozinho quando o jogador anda (ou fica parado sem mexer no HUD). Rodada 9.1: uma **barra de ações** discreta no
centro inferior (só jogador) — ver [Barra de ações](#barra-de-ações-rodada-91).

| Módulo | O quê |
|---|---|
| `src/ui/hud/HudShell.ts` | casca do HUD: layout, auto-ocultar, HUD limpo, menu, encaixes de outros componentes |
| `src/ui/hud/Minimap.ts` | minimapa (canvas 2D): ruas do OSM, marcadores, calor da multidão, visão expandida |
| `src/ui/hud/densityGrid.ts` | grade de densidade (pura) usada pelo calor do minimapa |
| `src/ui/hud/SettingsPanel.ts` | painel de AJUSTES |
| `src/ui/hud/hudPrefs.ts` | preferências do HUD (navegador + `PUT /api/me/preferences` com sessão) |
| `src/ui/hud/throttle.ts` | `RateGate`, `TextSlot`, `setClass`, `AutoHide` — nada de DOM por quadro |
| `src/world/zoneTracker.ts` | rastreador de zona com histerese + `loadZones` (dados: `public/world/zones.json`) |
| `src/net/nameLod.ts` | LOD dos apelidos (puro); aplicado em `NetworkClient.updateLabels` |
| `src/ui/TouchControls.ts` | controles de toque (poucos botões, ao alcance do polegar) |
| `src/ui/hud/ActionBar.ts` | rodada 9.1: barra de ações (centro inferior) e popovers |
| `src/ui/hud/actionBarState.ts` | rodada 9.1: estado do popover, teclado, veículos perto, dica de controles (puro) |
| `src/ui/actionOptions.ts` | rodada 9.1: opções de itens/gestos dos registros — fonte única da roda G e da barra |
| `tools/qa/action_bar.mjs` | rodada 9.1: QA da barra (desktop + iPhone 14), capturas `docs/screenshots/round9_1/menu_barra_*` |
| `tools/qa/hud_shots.mjs` | capturas N–U + custo medido do HUD (`docs/screenshots/round8/hud_metrics.json`) |
| `tests/hud.test.ts` | LOD dos nomes, zonas com histerese, grade de densidade, portões/AutoHide, preferências |
| `tests/actionBar.test.ts` | popover (alternar, clique fora, teclado), veículos perto, dica, opções compartilhadas |
| `src/ui/hud/VehicleHud.ts` | rodada 10: HUD do veículo (velocidade + SAIR) |
| `src/ui/PersonPanel.ts` | rodada 10: painel compacto da pessoa (clique/toque em outro jogador) |

## Layout

```
┌ evento · estado ─────────── [aviso de zona] ─────────── minimapa ┐
│                                                          ⚙  ☰     │
│ [chat]           [espectador] / [ação contextual]        Ações G │
│              [Veículos^ Itens^ Pichar Confronto^ Gestos^ …]      │
└───────────────────────────────────────────── © OpenStreetMap ────┘
```

- **Alto à esquerda**: evento atual (faixa vermelha fina) e estado (modo pacífico/interação; avisos curtos de 2,5 s
  aparecem mesmo com o HUD esmaecido).
- **Aviso de zona** (alto, centro): "PRESIDENTE VARGAS / CAMPO DE SANTANA" com fade de 0,9 s, some em 3,4 s.
- **Alto à direita**: minimapa (clique/toque ou **M** expande) com a zona atual na legenda; ⚙ ajustes; ☰ menu
  (Perfil / personagem, Ajustes, Controles, Mapa expandido, HUD limpo, Sair da conta).
- **Baixo**: encaixe do chat (esquerda), encaixe do espectador + ação contextual (centro), "Ações G" (direita, desktop).
- **Teclas**: **H** ou **P** HUD limpo (só o cenário + atribuição do OSM; botão discreto "Mostrar HUD"), **M** mapa,
  **G** ações, **F1** controles, **F3** debug, **Esc** fecha menu/ajustes/controles.
- **Auto-ocultar** (padrão ligado): andando por 2,5 s ou 9 s sem interação → evento, estado, botões e dicas somem e o
  minimapa fica a 42 %. Volta ao mover o mouse solto, tocar no HUD, apertar uma tecla que não seja de movimento, abrir
  roda/menu/ajustes. Ação contextual e avisos nunca somem.
- **Celular** (390×844): joystick à esquerda; à direita PULAR (grande), AÇÕES, CORRER (pequenos) e USAR só quando há
  algo para usar (amarelo); CHAT no canto esquerdo. No máximo 4 botões fixos + USAR contextual; o resto no ☰ (alvos
  de 44 px). A ação contextual perde o "E —" no toque. Respeita `safe-area-inset-*`. Rodada 9.1: a barra de ações
  (ícones) substitui o botão AÇÕES.

## Minimapa

Norte para cima. Camadas:

1. **Estática** (uma vez): ruas de `manifest.minimapRoads`, Pres. Vargas (vermelho) e Av. Rio Branco (bege) em
   destaque, Campo de Santana (miolo da Praça da República), footprints da Central e da Candelária.
2. **Calor da multidão** (1,5 Hz): `CrowdDirector.requestSample(fn)` entrega UMA vez a lista de agentes do quadro
   (jogadores remotos, multidão distante da rede, NPCs e concentração). `DensityGrid` (células de 10 m) → borrão 3×3
   em duas passadas → mapa de cor → `ImageData` de 1 px por célula, ampliado com suavização. Manchas, nunca um ponto
   por pessoa.
3. **Marcadores** (a cada redesenho): Central do Brasil e Candelária (losango dourado), nomes das zonas (Campo de
   Santana no parque, Av. Rio Branco na esquina), **trio** (roxo, posição ao vivo do `rallyPoints`), carros de som,
   **palco**, pontos de evento; jogador (seta) + cone da câmera.

Redesenho a 10 Hz (4 Hz com o mapa expandido e o jogador parado). Visão compacta: ~575 m de lado (184 px; 118 px no
celular). Expandida: o corredor inteiro (eixo + 170 m), centralizada.

## Zonas

`ZoneTracker(zonas, eixo, { dwellMs = 1200, marginT = 0,006, marginM = 20 })`:
- a zona atual é **alargada** pela margem (no eixo e na lateral) — andar sobre a fronteira não troca;
- uma zona nova (ou "fora de todas") só vale depois de `dwellMs` contínuos como candidata;
- a primeira amostra entra direto (o aviso inicial diz onde o jogador nasceu); `reset()` faz o mesmo (troca de câmera).

O HUD amostra a 4 Hz a posição do **foco**: o jogador, a câmera livre (QA) ou o que `setFocusProvider` devolver
(câmera de espectador). `onZoneChange(fn)` avisa as trocas (rodada 9: missões).

## Nomes dos jogadores (LOD)

| Distância | Rótulo |
|---|---|
| 0–15 m | apelido completo |
| 15–30 m | simplificado (menor, até 10 caracteres; primeiro nome quando cabe) |
| 30–50 m | só perto do centro da tela, ou falando no chat / começando uma ação há < 4 s |
| > 50 m | nada |

No máximo **14** rótulos, por prioridade `dist × (1 + 0,6 × distância ao centro da tela)` (× 0,25 interagindo).
Histerese de 1,5 m nas fronteiras. Preferência **NOMES DOS JOGADORES: TODOS | PRÓXIMOS | NENHUM** (padrão PRÓXIMOS;
TODOS tira a restrição do centro até 50 m). Decisão (quem/qual faixa: `hidden`, classe, texto) a **5 Hz**; por quadro só
o `transform: translate3d` dos escolhidos, e só quando muda de pixel. Rótulos aparecem também sobre remotos
instanciados (antes só com esqueleto), nunca sobre quem está fora do orçamento da multidão (tier 0).

## Ajustes

> **Rodada 11:** o painel virou ABAS e os gráficos passaram a valer AO VIVO — ver [Rodada 11](#rodada-11--hud-desktop-escala-da-interface-e-ajustes-com-abas).
> O texto abaixo descreve as opções que continuam iguais.

Qualidade gráfica (até a rodada 10: grava a escolha e oferece "Recarregar para aplicar"), nomes dos jogadores, esconder o HUD sozinho, chat recolhido ao entrar.
Rodada 10: seção **Som** (substitui o "Som — Em breve"): Volume geral, Ambiente, Multidão, Veículos, Trio e carro de
som, Efeitos, Interface (0–100) e **Silenciar tudo** (suspende o áudio); salvo em `pv3d.audio` — `docs/AUDIO_SYSTEM.md`.
O antigo `HudPrefs.sound` ficou só por compatibilidade. `role=dialog`, foco no controle marcado, Esc fecha, controles nativos (rádio/checkbox) para leitor de tela.
Rodada 9: **Reduzir efeitos visuais** (`reduceEffects`, também no perfil): a desorientação vira só um ícone pequeno e
um tom leve (sem desfoque/vinheta) — `docs/COMBAT.md`.

Preferências: `localStorage['pv3d.hud']`. Com sessão (descoberta em `GET /api/me`), `names`, `chatCollapsed` e `reduceEffects` vão para
`PUT /api/me/preferences` (800 ms depois da última mudança); as do perfil vencem as locais ao entrar. Sem sessão/rota:
só local, em silêncio.

## Encaixes para outros componentes

```ts
game.hudShell.mountChat(panel)          // ChatPanelLike { el; toggle(open?); setCollapsed?(c) } — botão CHAT do celular chama toggle()
game.hudShell.mountSpectator(panel)     // HudPanel { el; setCollapsed?(c) } — acima da ação contextual
game.hudShell.mountCombat(panel, aviso) // rodada 9: HUD de confronto (acima do centro inferior) + aviso ZONA DE PAZ
game.hudShell.mountHand(panel)          // rodada 9: MÃOS / ITEM ATUAL (canto inferior direito, acima de Ações)
game.hudShell.setFocusProvider(() => ({ x, z }))  // câmera do espectador define zona/minimapa; null = jogador
game.hudShell.onZoneChange(({ from, to }) => …)   // ZoneDefinition | null
game.hudShell.hooks.openCharacterEditor = () => openCharacterEditor()  // menu "Perfil / personagem"
game.hudShell.hooks.logout = async () => …        // padrão: POST /api/auth/logout e volta à home
game.hudShell.flash('mensagem')                   // aviso curto
game.hudShell.mountNow(panel)           // rodada 9: "Acontecendo agora" (abaixo do evento/estado, esmaece com o HUD)
game.hudShell.mountOverlay(panel)       // rodada 9: painéis sobrepostos (agenda, debate); HUD limpo os esconde
game.hudShell.addMenuItem('Agenda da avenida', fn) // rodada 9: item no ☰ (antes de "Sair da conta")
game.hudShell.minimap.setTarget({ x, z, label })  // rodada 9: destino (anel dourado; seta na borda se fora da vista)
game.hudShell.mountActionBar(bar)       // rodada 9.1: barra de ações (Game.mountActionBar; não monta no espectador)
game.hudShell.prompt                    // rodada 9.1: texto atual da ação contextual (a barra reaproveita)
net.markSpeaking(entityId)              // o chat avisa quem falou: o rótulo dele ganha prioridade por 6 s
```

Sem gancho do editor, o menu dispara `window` `pv:open-character-editor` e mostra "Editor de personagem: em breve".

## Barra de ações (rodada 9.1)

Segunda porta de entrada, fácil de achar, para o que já existia (a roda **G** continua). Centro inferior, **só jogador**
(o espectador fica com a barra de câmeras). Identidade nossa: mesma pílula translúcida do HUD (`--hud-bg`,
`--hud-line`, system-ui), rótulos próprios em português e ícones SVG desenhados à mão no próprio `ActionBar.ts` (sem
pacote de ícones). Botões com `^` abrem um popover para cima; Esc, clique/toque fora ou o mesmo botão fecham.

| Botão | O que faz (sempre pelo caminho de sempre) |
|---|---|
| **Veículos ^** | "USAR BICICLETA / SUBIR NO TRIO / descer…" quando há algo ao alcance (o texto da ação contextual do HUD; clique = tecla **E**) + **Seu veículo** (rodada 12): Patinete · Bicicleta · Moto · Carro — escolher = o veículo PESSOAL **aparece junto e você já está montado** (`pveh_req`, docs/PERSONAL_VEHICLES.md); o mesmo de novo, montado, = descer. Nada de "o mais próximo está a 83 m". Ponto amarelo no botão quando há veículo usável perto |
| **Itens ^** | as mesmas opções da categoria ITENS da roda (`itemOptions`): Mãos vazias, bandeiras/cartazes/faixa/…, e os itens de confronto oferecidos (`ItemsClient.wheelExtra`); ◀ design ▶ para o item na mão; tocar no item na mão de novo o larga |
| **Pichar** | abre o editor de grafite se houver tapume/parede liberada perto (`graffiti.tryOpen`, o mesmo do **E**); senão aviso "Aproxime-se de um tapume ou parede liberada para pichar" |
| **Confronto ^** | Soco (R), Chute (Q), Esquiva (C), Empurrão (F) — entram como as teclas (`input.queueToggle`); "Pegar rápido" Taco/Barra/Spray (`requestProp`, apagado se o servidor não oferece). No botão, duas linhas finas de condição/fôlego enquanto o HUD de confronto está à vista (lidas de `CombatHud.state`, nada recalculado) |
| **Gestos ^** | gestos, manifestação e dança da roda (`actionOptions`), por seção; os que pedem item aparecem apagados |
| **Personagem** | `hudShell.openCharacterEditor()` — o mesmo do ☰ (sem conta: login) |
| **Mapa** | `hudShell.toggleMap()` |

- **Dica acima da barra** (`hud-fadeable`): desktop "W A S D mover · clique interage · botão direito + arrastar câmera ·
  G roda · Esc menu" (rodada 11: cursor sempre visível, sem pointer lock); toque "joystick mover · arraste para olhar".
  Os atalhos mostrados no popover de Confronto vêm do mapa de teclas efetivo (remapeamentos valem).
  Fica até 6 s depois do 1º movimento ou no máximo 3 min (`hintVisible`).
- **Auto-ocultar / HUD limpo**: a fileira esmaece com o HUD (e deixa de receber cliques enquanto invisível); volta com
  o mouse/toque como o resto. Popover aberto não deixa esmaecer. **H/P** esconde tudo.
- **Mouse**: abrir um popover solta o mouse; fechar **não** recaptura (clicar no cenário recaptura, como sempre). Depois
  de um clique o botão perde o foco (Espaço volta a ser pulo).
- **Teclado / leitor de tela**: `role=toolbar` com `aria-label` em cada botão, `aria-haspopup`/`aria-expanded`; popover
  `role=menu` com `menuitem`s. ←/→ trocam de botão, ↑/Enter/Espaço abrem e focam a 1ª opção, ↑/↓/Home/End andam
  (com volta), Esc fecha e devolve o foco ao botão. As teclas de navegação dentro da barra não andam/pulam o personagem.
- **Celular**: fileira só de ícones (44 × 44 px) logo acima do grupo de botões de toque (acima da ESQUIVA), sem cobrir
  joystick, PULAR, CORRER, CHAT nem os botões de confronto; o botão **AÇÕES** some (a barra assume o papel — fixos:
  PULAR, CHAT, CORRER). As opções abrem numa folha embaixo, até a barra (alvos de 44 px; cobre os botões só enquanto
  aberta; toque fora fecha). Com a barra, "Acontecendo agora" mostra só o 1º item (o resto na agenda do ☰).
- **Custo**: nada por quadro. `ActionBar.update` passa por um `RateGate` de 4 Hz (chamado em `HudShell.frame`) e só
  escreve quando muda (ponto do veículo, linhas do confronto em 20 passos, dica); o popover aberto só é refeito quando
  a assinatura do conteúdo muda (distâncias arredondadas por `distLabel`). QA: `__pv.actionBar()`.

QA `tools/qa/action_bar.mjs` (servidor de teste próprio; desktop 1280×720 + iPhone 14): 38 verificações — barra
visível/ausente no espectador, cada popover abre e fecha (clique, Esc, fora, teclado), item → `prop` confirmado pelo
servidor e largado pela barra, design pela barra, gesto confirmado, Soco/Chute sobem `combat().stats.acts`, Taco
rápido, Mapa, Pichar (dica e editor), Veículos (E — USAR monta/desce; rodada 12: lista = veículo pessoal, tools/qa/personal_vehicles_mp.mjs), Personagem, HUD limpo,
esmaecer/voltar, roda G, e no celular ícones ≥ 44 px, AÇÕES oculto e nenhuma sobreposição (caixas) com joystick e
botões. Capturas: `docs/screenshots/round9_1/menu_barra_desktop.jpg`, `menu_barra_popover.jpg`,
`menu_barra_celular.jpg`, `menu_barra_celular_popover.jpg`.

## Interação contextual e HUD de veículo (rodada 10)

Detalhes em [INTERACTION_SYSTEM.md](INTERACTION_SYSTEM.md). No HUD:

- **A pé**: a ação contextual (`hudShell.setPrompt`) vem do alvo do `InteractionSystem` — "E — ENTRAR NO CARRO",
  "E — MONTAR NA BICICLETA", "E — USAR O PATINETE", "E — SUBIR NO TRIO", "E — PEGAR TACO", "E — PICHAR A PAREDE" (no toque
  sem o "E —"; o botão USAR aparece com ela). Realce **só no alvo**: anel leve no chão + rótulo curto ("CARRO · Entrar",
  desktop "E · CARRO · Entrar"); no desktop, o objeto sob o cursor (mão em objeto, cursor de interação em pessoa). Pessoas
  não ganham realce sozinhas (só ao passar o mouse/clicar). HUD limpo (H/P) esconde o rótulo.
- **Em veículo** (`src/ui/hud/VehicleHud.ts`, `mountOverlay`): velocidade ("CARRO · 23 km/h", ≤ 5 Hz, só escreve quando
  muda) + **SAIR**/**DESCER**. Desktop: centro inferior, acima da barra; a ação contextual mostra as teclas do veículo.
  Toque: SAIR grande (84 px) no lugar do PULAR; PULAR, USAR e SOCO/CHUTE/ESQUIVA somem (`TouchControls.setRiding`);
  velocidade e "joystick ↑ acelera · ↓ freia/ré · ←→ vira" na coluna da direita, acima do SAIR, sem cobrir joystick,
  CORRER nem CHAT. Controles de veículo no toque: o próprio joystick (decisão documentada em INTERACTION_SYSTEM.md).
- **Com item**: a pílula MÃOS continua a fonte única do "equipado" (o mesmo `prop` confirmado pelo servidor que o corpo
  mostra).
- **Pessoa**: clique/toque em outro jogador abre o `PersonPanel` (centro inferior, acima da barra; no toque um pouco mais
  alto; botões ≥ 44 px): VER PERFIL, INTERAGIR, SILENCIAR, DENUNCIAR. Abrir solta o mouse; fechar recaptura (como os
  outros modais).
- **Onboarding**: "Toque ou clique nos objetos para interagir." uma vez por aparelho.

## HUD de confronto (rodada 9)

`src/combat/CombatHud.ts`, montado por `hudShell.mountCombat(hud, hud.peaceEl)` acima do centro inferior (detalhes do
sistema em [COMBAT.md](COMBAT.md)):

- **painel** (discreto, some sozinho): estado da zona (ZONA DE COMBATE / ÁREA DE TREINO / ZONA DE DISPUTA / ZONA DE PAZ,
  `· PROTEGIDO` com a proteção de retorno), barras de **CONDIÇÃO** e **FÔLEGO** (stamina) e o item de confronto na mão.
  Só aparece quando importa: golpe/acerto/esquiva nos últimos 8 s, fx ENGAGED do servidor, valores abaixo do máximo
  num contexto de confronto, ou item de confronto na mão numa zona de confronto. Fora disso, opacidade 0;
- **aviso "ZONA DE PAZ"**: pílula verde curta (1,6 s) quando o servidor nega um golpe com `zona_paz` — desde
  2026-10-18 (avenida toda COMBAT, sem áreas de paz) não aparece na avenida; fica para quando os dados religarem;
- **toque**: SOCO / CHUTE / ESQUIVA (`TouchControls.setCombatVisible`) aparecem com contexto de confronto — com
  `combatConsent: "none"` (dados atuais) **sempre** para jogador; na regra antiga só em zona COMBAT/CONTESTED, área de
  treino, evento de confronto ou modo interação — os fixos (PULAR, CHAT, CORRER; AÇÕES virou a barra na 9.1) não mudam;
- HUD limpo (H/P) esconde tudo.

Custo: `set()` roda a ≤ 10 Hz (RateGate) e só escreve o que mudou (TextSlot/setClass; barras por `transform` só quando
o valor inteiro muda). Parado e cheio: zero escritas. QA: `__pv.combat().hud` (`shown`, `peace`, `writes`).

## Custo medido

`tools/qa/hud_shots.mjs` (150 bots, 50 % com vida social, preset médio, M-series): minimapa **0,13 ms** por redesenho
(~11/s), densidade **0,30 ms** por amostra (1,5/s), decisão dos nomes **0,003–0,024 ms** (5/s), ~210 escritas de
transform/s (14 rótulos), zero escritas de texto por quadro (evento/estado/ação só quando mudam).

Bancada de multidão (`tools/qa/crowd_bench.mjs`, 500 bots, 60 % com vida social, sem limite de FPS, 1280×720; duas
medições do commit anterior intercaladas com a deste, máquina compartilhada → ruído de ±10 %):

| Preset | Antes (fps · CPU ms) | Antes, 2ª (fps · CPU ms) | Com o HUD novo (fps · CPU ms) |
|---|---|---|---|
| médio | 80,3 · 12,2 | 78,9 · 12,2 | **94,2 · 10,1** |
| alto | 37,3 · 25,4 | 32,7 · 29,2 | **33,0 · 27,5** |

Sem regressão mensurável; no médio ficou mais leve (antes: texto da ação contextual e do modo escrito a cada quadro,
projeção + `display` de todos os remotos por quadro e um `Vector3` novo por quadro). JSON: `docs/screenshots/crowd_bench_r8_hud.json`.

QA: `__pv.hudInfo()` (estado, custo, rótulos) e `__pv.hudSet({ clean, map, settings, menu, help, names, autoHide, poke })`.

## Rodada 9 — Acontecendo agora, agenda e painel do debate

Montagem: `src/ui/agendaDebateMount.ts` (`mountAgendaDebate`, chamado UMA vez em `Game.mountHud`; `attach(net)` ao
conectar). Formatação pura: `src/events/agendaFormat.ts` (`tests/agendaFormat.test.ts`). Capturas: `O_acontecendo_agora`,
`P_agenda`, `U_debate`, `V_plateia`, `Y_telao_evento` em `docs/screenshots/round9/`.

- **Acontecendo agora** (`NowHappening`, alto à esquerda, abaixo do evento/estado; `hud-fadeable` — some com o HUD):
  até **3** itens da mensagem `agenda` do servidor — acontecendo primeiro, depois inscrições abertas, depois o que começa
  em ≤ 15 min (`AGENDA_SOON_MS`, o mesmo corte do EM BREVE; inscritos primeiro em cada grupo). Linha: `DEBATE NO PALCO · acontecendo · 2/20` + zona;
  `CAMINHADA · começa em 03:42`; `CORRIDA DE BICICLETA · inscrições 9/20`. **Clique → direção, sem teleporte**: alvo no
  minimapa (anel dourado; mapa expandido) + aviso "TÍTULO: 320 m daqui · zona"; debate de longe abre o painel
  (`dbt_watch`). Relógio por intervalo de 1 s só enquanto há item; cada texto escreve no DOM só quando muda (TextSlot).
- **AGENDA DA AVENIDA** (☰ → "Agenda da avenida"; `AgendaPanel`, `role=dialog`, Esc fecha), seções (rodada 9.1,
  `agendaSections`): **AGORA** (inscrições abertas, começando, acontecendo) · **EM BREVE** (agendado que começa em
  ≤ 15 min — `AGENDA_SOON_MS` em `src/events/agendaFormat.ts`) · **MAIS TARDE** (os demais agendados) · **ENCERRADOS
  RECENTEMENTE** (encerrado/cancelado: o cliente não corta por tempo — aparece enquanto o servidor manda, pela janela
  recente do `EventRuntime`, 10 min). Estado ao vivo, botão **Participar / Sair** (`evt_join` / `evt_leave {inst}`; a
  resposta `evt_res` vira aviso). Só envia se a agenda veio do servidor (`serverDriven`): mensagem sem handler no
  servidor derruba a conexão (Colyseus). Alvos de 44 px; no toque, folha quase da largura da tela.
- **Fonte única** (rodada 9.1): tudo o que a agenda e o "Acontecendo agora" mostram — início/fim, estado, inscritos,
  capacidade, `joined` — vem SÓ da mensagem `agenda` do servidor (`AgendaFeed.attach`; não há alimentador local nem
  agenda simulada; o palco de debate entra na mesma mensagem pelo `EventHost.extraAgenda`). Contagens regressivas no
  relógio comum do servidor (`worldClock.now()`, `src/net/clock.ts`), nunca no `Date` local. As capturas `O`/`P` saem
  de um servidor de teste real (`tools/qa/debate_mp.mjs`: agenda dos dados com horários encurtados por
  `PV_AGENDA_FILE` + `PV_AGENDA_EPOCH=now`).
- **Painel do debate** (`DebatePanel`, `mountOverlay`; ☰ → "Palco de debate" também abre): ver `docs/DEBATES.md`. À
  direita abaixo do minimapa (desktop), folha no alto no celular (não cobre joystick/botões; nenhum botão fixo novo:
  continua ≤ 4 fixos), recolhível. Abre sozinho na plateia; contagem regressiva a 1 Hz só aberto com orador.
- **Palco no mundo** (`DebateStage`): marcas dos lugares (anéis no chão; orador em amarelo, com pulso por escala — nada
  de DOM por quadro).

Custo medido (QA `tools/qa/debate_mp.mjs`): "Acontecendo agora" = 2–3 renderizações em 2,1 s (1 Hz + mudanças); o
painel do debate só escreve quando chega `dbt` (≤ 2 Hz) ou no relógio (1 Hz).


## Rodada 11 — HUD desktop, escala da interface e ajustes com abas

Arquivos: `src/ui/hud/hud-r11.css` (todo o CSS da rodada, importado pelo `HudShell`), `src/ui/uiPrefs.ts` (escala e
reduzir movimento), `src/ui/notify.ts` (`notifyBlocked`), `src/ui/settingsApi.ts` (`openSettings`, `setControlsOpener`),
`src/ui/hud/SettingsPanel.ts` (abas), `tools/qa/desktop_graphics.mjs` (QA), `tests/round11Graphics.test.ts`.

### Layout desktop

```
┌ evento · estado ──────────── ● CONFRONTO ─────────────── minimapa ┐
│ missão                        (aviso de zona, só na troca)   ⚙ ☰  │
│ acontecendo agora (1–3)       (aviso de missão/conquista)          │
│                               (⊘ ação bloqueada, 1,8 s)            │
│                                                                    │
│                    ┌───── centro livre ─────┐                      │
│                    │  (avenida, multidão)   │                      │
│                    └────────────────────────┘                      │
│ [chat]              [ação contextual / confronto]        MÃOS     │
│              [Veículos Itens Pichar Confronto Gestos …]   Ações G │
└────────────────────────────────────────────────── © OpenStreetMap ┘
```

- **Centro limpo**: nada persistente invade a área central (x 30–70 %, y 28–66 % da tela). O QA mede as caixas visíveis
  de cada bloco do HUD e falha se algum bloco sai da tela, invade o centro ou cruza outro bloco.
- **Alto ao centro, um fluxo só** (`.hud-tc`, coluna flex): indicador de zona → aviso de zona → avisos de progresso →
  ação bloqueada. Antes, o aviso de zona (9vh) e os avisos (96 px) eram absolutos e se sobrepunham em 1080 p.
  Entrada suave (0,35 s), saída imediata; com "reduzir movimento", sem animação.
- **Alto à esquerda** nunca passa de 28 % da largura da tela (o limite é dividido pela escala para compensar o zoom).
  "Acontecendo agora" ficou compacto: a regra `.hud button { font: inherit }` vencia o tamanho da agenda (as linhas
  saíam a 16 px em negrito); agora 12 px, e em telas com até 820 px de altura só o 1º item (o resto na agenda do ☰).
- **Dica de teclas do canto** (9 s) some quando há barra de ações (a barra já mostra a dica, e as duas disputavam o
  rodapé em 1366 × 768 a 125 %).

### Indicador de zona

Pílula pequena no alto ao centro, **sempre visível** (não esmaece com o HUD, não some no auto-ocultar): ponto colorido
+ palavra — **PAZ** (verde), **CONTESTADA** (âmbar), **CONFRONTO** (vermelho, fundo levemente avermelhado). A palavra
garante leitura sem depender da cor. Fora de zona nomeada vale a regra padrão (PAZ). `title` com o nome da zona e a
política por extenso. O aviso grande de zona (nome do lugar) continua aparecendo só na troca (3,4 s), menor (18–26 px)
e logo abaixo do indicador; em telas baixas perde a linha "PRESIDENTE VARGAS". A legenda do minimapa continua.

### Ação bloqueada — `notifyBlocked(texto)`

Contrato para qualquer sistema (inventário, veículos, confronto, interação): `import { notifyBlocked } from
'src/ui/notify'`. Toast curto (1,8 s) no fim da coluna do alto ao centro, sem modal, sem roubar o foco nem soltar o
mouse; o próximo substitui o atual (não enfileira); a mesma frase repetida em < 1,5 s é ignorada; antes do HUD montar,
guarda a última. Já usam: confronto negado por zona de paz (substitui o antigo selo "ZONA DE PAZ"), sem fôlego, golpe
sem o item. QA: `__pv.r11().blocked(texto)`; `hudShell.info().blocked`.

### Escala da interface (80 / 90 / 100 / 110 / 125 %)

Ajustes → **Interface**. Variável CSS `--ui-scale` em `<html>`, aplicada com `zoom` a cada filho direto de `.hud`
(blocos e painéis) — **nunca ao canvas** nem ao que é preso ao mundo por posição de tela em pixels (nomes, realce de
interação, véu de efeito, controles de toque) nem à atribuição do OSM. Painéis novos montados em `.hud` escalam
sozinhos. Medidas em JS dentro do HUD dividem por `uiZoom()` (popover da barra de ações, minimapa expandido — que
também ganha nitidez multiplicando o DPR do canvas pela escala). Navegador sem CSS `zoom` (Firefox < 126): fica em
100 %, sem quebrar. Persistida em `localStorage['pv3d.ui']` (`{scale, reduceMotion}`, try/catch, valor inválido →
escala válida mais próxima).

**Reduzir movimento** (padrão: `prefers-reduced-motion` do sistema): sem transições/animações no HUD
(`html.reduce-motion`), sem o giro de câmera da chegada (já começa olhando a avenida) e véus de tela no modo reduzido
(desorientação vira só ícone). A câmera não tem balanço; quem mexer nela consulta `isReduceMotion()`.
**Reduzir efeitos visuais** (rodada 9) continua, na mesma aba.

### Painel de AJUSTES com abas

Folha lateral de 440 px (desktop), abas **Geral · Áudio · Gráficos · Interface · Controles** (`role=tablist`, setas
←/→, Home/End; foco na aba ativa ao abrir). Esc pela pilha única (`EscSlot('ajustes', 100)`), sem
listener próprio. `openSettings(tab)` abre direto numa aba (menu do jogo do Esc); `setControlsOpener(fn)` registra a
tela de controles — a aba Controles delega para ela (sem registro: mostra a ajuda de teclas do HUD).

- **Geral**: nomes dos jogadores, esconder o HUD sozinho, chat recolhido.
- **Áudio**: a seção Som da rodada 10, igual (ver `docs/AUDIO_SYSTEM.md`).
- **Gráficos**: qualidade (Automática/Baixa/Média/Alta/Ultra) aplicada **na hora**; quando algo só muda ao recarregar
  (suavização nativa do canvas, fachadas já construídas, capacidade extra da multidão) o painel diz exatamente o quê e
  oferece "Recarregar agora". Limite de FPS (Automático/30/60/Sem limite), na hora. Leitura ao vivo (2 Hz, só com a
  aba aberta): FPS medido, limite, escala da resolução dinâmica. Aparelho detectado e o motivo. Ver `docs/PERFORMANCE.md`.
- **Interface**: escala, reduzir movimento, reduzir efeitos visuais.
- **Controles**: botão "Abrir controles e teclas" + resumo.

### Resoluções testadas (QA `tools/qa/desktop_graphics.mjs`)

1366 × 768, 1440 × 900, 1440 × 900 @2x (Retina), 1920 × 1080 e 2560 × 1440 × escalas 80/100/125 % (e 90/110 % no
1920), com a coluna do alto ao centro CHEIA (indicador + aviso de zona + aviso + ação bloqueada ao mesmo tempo, pior
caso) e multidão de bots: **17/17 sem sobreposição, sem corte e com o centro livre**. Resultado:
`docs/screenshots/round11/desktop_graphics.json`. Capturas em `docs/screenshots/round11/`: `W_1366x768`,
`X_1920x1080`, `Y_2560x1440`, `A_hud_desktop_d` (HUD reorganizado), `U_evento` (HUD num evento), `Q_configuracoes`
(painel, aba Interface), `S_graficos` (aba Gráficos depois de trocar o preset ao vivo).

## Rodada 11 — desktop first (docs/DESKTOP_CONTROLS.md)

- **Cursor sempre visível**, sem pointer lock: o aviso "Clique para controlar a câmera" saiu; o mouse é interface.
- **F1 / ☰ Controles / menu → CONTROLES**: `ControlsScreen` (`src/ui/hud/ControlsScreen.ts`) gerada do mapa único,
  agrupada, com remapeamento local; substitui a antiga caixa de ajuda fixa.
- **Esc sem nada aberto → menu do jogo** (`GameMenu`): CONTINUAR · CONFIGURAÇÕES · CONTROLES · ÁUDIO · GRÁFICOS · SAIR
  (confirmação); o mundo não pausa. `HudShell.openSettings(tab)` abre os ajustes na aba (painel com abas: agente D).
- **Esc fecha só o topo** (pilha única `src/ui/escStack.ts`): ☰, popover da barra, HUD limpo, ajustes, controles, menu,
  painéis — cada um uma camada; ninguém mais tem listener próprio de Esc.
- Dica inicial: "Clique interage · botão direito + arrastar gira a câmera · F1 controles · Esc menu".
- `anyModal` inclui o menu do jogo e a tela de controles; `onModal` só avisa (nada a capturar/soltar).

## Rodada 11 — inventário e acesso rápido (docs/INVENTORY.md)

- **Acesso rápido** (`src/inventory/QuickbarView.ts`, `mountOverlay`): centro inferior, acima da barra de ações —
  botão **INVENTÁRIO (I)** + 5 slots (teclas 1–5 ou clique; o cursor continua visível). Slot aceso = item NA MÃO (a
  mesma fonte do indicador MÃOS e do avatar — `__pvInv.handSync()`). Esmaece com o HUD; some no toque (lá o
  inventário fica no ☰ → "Inventário"). Escreve no DOM só quando a assinatura muda (4 Hz).
- Com o acesso rápido, a ação contextual/HUD de confronto (`.hud-bc`) sobem para 154 px (`.hud.has-quick`).
- **Painel do inventário** (`InventoryPanel`, `mountOverlay`): centralizado, camada 100 da pilha do Esc
  (`EscSlot('inventory', 100)`); não pausa o mundo; enquanto aberto, as teclas de andar/correr/pular não movem o
  personagem (`input.setMoveBlocked`) e o clique no cenário não interage.
- Avisos curtos (sem modal) pelo canal de sempre (`flash`): "Você não possui este item.", "<item>: bloqueado — Nível 3",
  "Taco não pode ser usado nesta zona." (zona de paz), "Título: …", "Torcida atualizada.".

## Veículo pessoal no HUD (rodada 12)

Barra (Veículos → Seu veículo), inventário (VEÍCULOS → USAR AGORA) e acesso rápido (`veh:<tipo>` fixado) PEDEM o
veículo pessoal; o servidor decide o ponto. Aviso curto de uma linha: "Patinete disponível" (montado) · "Carro
disponível — ali do lado (9 m): E para entrar" (+ alvo "Seu carro" no minimapa) quando a porta ficou longe para montar
sozinho · recusa: "Devagar — espere um instante…", "Sem lugar seguro aqui…", "Desça do veículo/trio primeiro",
"Levante-se primeiro", "Este evento não permite esse veículo". O HUD do veículo (velocidade + SAIR/DESCER) é o mesmo
da rodada 10. Detalhes: docs/PERSONAL_VEHICLES.md.
