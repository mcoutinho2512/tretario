# HUD, minimapa, zonas e nomes (rodada 8)

Identidade própria: **o cenário é o protagonista**. Pouca coisa fixa na tela, tudo discreto e translúcido, e o HUD
some sozinho quando o jogador anda (ou fica parado sem mexer no HUD). Não há barra inferior de botões.

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
| `tools/qa/hud_shots.mjs` | capturas N–U + custo medido do HUD (`docs/screenshots/round8/hud_metrics.json`) |
| `tests/hud.test.ts` | LOD dos nomes, zonas com histerese, grade de densidade, portões/AutoHide, preferências |

## Layout

```
┌ evento · estado ─────────── [aviso de zona] ─────────── minimapa ┐
│                                                          ⚙  ☰     │
│ [chat]           [espectador] / [ação contextual]        Ações G │
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
  de 44 px). A ação contextual perde o "E —" no toque. Respeita `safe-area-inset-*`.

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

Qualidade gráfica (presets existentes; grava a escolha e oferece "Recarregar para aplicar" — preset, resolução dinâmica
e LOD continuam decididos na carga), nomes dos jogadores, esconder o HUD sozinho, chat recolhido ao entrar, som
(reservado). `role=dialog`, foco no controle marcado, Esc fecha, controles nativos (rádio/checkbox) para leitor de tela.

Preferências: `localStorage['pv3d.hud']`. Com sessão (descoberta em `GET /api/me`), `names` e `chatCollapsed` vão para
`PUT /api/me/preferences` (800 ms depois da última mudança); as do perfil vencem as locais ao entrar. Sem sessão/rota:
só local, em silêncio.

## Encaixes para outros componentes

```ts
game.hudShell.mountChat(panel)          // ChatPanelLike { el; toggle(open?); setCollapsed?(c) } — botão CHAT do celular chama toggle()
game.hudShell.mountSpectator(panel)     // HudPanel { el; setCollapsed?(c) } — acima da ação contextual
game.hudShell.mountCombat(panel, aviso) // rodada 9: HUD de confronto (acima do centro inferior) + aviso ZONA DE PAZ
game.hudShell.setFocusProvider(() => ({ x, z }))  // câmera do espectador define zona/minimapa; null = jogador
game.hudShell.onZoneChange(({ from, to }) => …)   // ZoneDefinition | null
game.hudShell.hooks.openCharacterEditor = () => openCharacterEditor()  // menu "Perfil / personagem"
game.hudShell.hooks.logout = async () => …        // padrão: POST /api/auth/logout e volta à home
game.hudShell.flash('mensagem')                   // aviso curto
game.hudShell.mountNow(panel)           // rodada 9: "Acontecendo agora" (abaixo do evento/estado, esmaece com o HUD)
game.hudShell.mountOverlay(panel)       // rodada 9: painéis sobrepostos (agenda, debate); HUD limpo os esconde
game.hudShell.addMenuItem('Agenda da avenida', fn) // rodada 9: item no ☰ (antes de "Sair da conta")
game.hudShell.minimap.setTarget({ x, z, label })  // rodada 9: destino (anel dourado; seta na borda se fora da vista)
net.markSpeaking(entityId)              // o chat avisa quem falou: o rótulo dele ganha prioridade por 6 s
```

Sem gancho do editor, o menu dispara `window` `pv:open-character-editor` e mostra "Editor de personagem: em breve".

## HUD de confronto (rodada 9)

`src/combat/CombatHud.ts`, montado por `hudShell.mountCombat(hud, hud.peaceEl)` acima do centro inferior (detalhes do
sistema em [COMBAT.md](COMBAT.md)):

- **painel** (discreto, some sozinho): estado da zona (ZONA DE COMBATE / ÁREA DE TREINO / ZONA DE DISPUTA / ZONA DE PAZ,
  `· PROTEGIDO` com a proteção de retorno), barras de **CONDIÇÃO** e **FÔLEGO** (stamina) e o item de confronto na mão.
  Só aparece quando importa: golpe/acerto/esquiva nos últimos 8 s, fx ENGAGED do servidor, valores abaixo do máximo
  num contexto de confronto, ou item de confronto na mão numa zona de confronto. Fora disso, opacidade 0;
- **aviso "ZONA DE PAZ"**: pílula verde curta (1,6 s) quando o servidor nega um golpe com `zona_paz`;
- **toque**: SOCO / CHUTE / ESQUIVA (`TouchControls.setCombatVisible`) aparecem só com contexto de confronto (zona
  COMBAT/CONTESTED, área de treino, evento de confronto ou modo interação) e somem fora dele — os quatro fixos
  (PULAR, AÇÕES, CHAT, CORRER) não mudam;
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
  em ≤ 30 min (inscritos primeiro em cada grupo). Linha: `DEBATE NO PALCO · acontecendo · 2/20` + zona;
  `CAMINHADA · começa em 03:42`; `CORRIDA DE BICICLETA · inscrições 9/20`. **Clique → direção, sem teleporte**: alvo no
  minimapa (anel dourado; mapa expandido) + aviso "TÍTULO: 320 m daqui · zona"; debate de longe abre o painel
  (`dbt_watch`). Relógio por intervalo de 1 s só enquanto há item; cada texto escreve no DOM só quando muda (TextSlot).
- **AGENDA DA AVENIDA** (☰ → "Agenda da avenida"; `AgendaPanel`, `role=dialog`, Esc fecha): **Agora / A seguir /
  Encerrados há pouco** (≤ 45 min), estado ao vivo, botão **Participar / Sair** (`evt_join` / `evt_leave {inst}`; a
  resposta `evt_res` vira aviso). Só envia se a agenda veio do servidor (`serverDriven`): mensagem sem handler no
  servidor derruba a conexão (Colyseus). Alvos de 44 px; no toque, folha quase da largura da tela.
- **Painel do debate** (`DebatePanel`, `mountOverlay`; ☰ → "Palco de debate" também abre): ver `docs/DEBATES.md`. À
  direita abaixo do minimapa (desktop), folha no alto no celular (não cobre joystick/botões; nenhum botão fixo novo:
  continua ≤ 4 fixos), recolhível. Abre sozinho na plateia; contagem regressiva a 1 Hz só aberto com orador.
- **Palco no mundo** (`DebateStage`): marcas dos lugares (anéis no chão; orador em amarelo, com pulso por escala — nada
  de DOM por quadro).

Custo medido (QA `tools/qa/debate_mp.mjs`): "Acontecendo agora" = 2–3 renderizações em 2,1 s (1 Hz + mudanças); o
painel do debate só escreve quando chega `dbt` (≤ 2 Hz) ou no relógio (1 Hz).
