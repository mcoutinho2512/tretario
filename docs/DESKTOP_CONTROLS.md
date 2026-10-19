# Controles no desktop (rodada 11): cursor sempre visível

**Desktop first.** O mouse é interface: o cursor **nunca é ocultado** e o jogo **não pede pointer lock** em nenhum
momento (nenhuma chamada de `requestPointerLock`; `document.pointerLockElement` fica `null` do começo ao fim, em
jogo, painéis, veículo, combate, chat, menu e evento; verificado em `tools/qa/desktop_input.mjs`). Não há modo opcional
"capturar mouse" nesta rodada (ficou de fora de propósito: o jogo inteiro foi pensado para o cursor livre).

| arquivo | papel |
|---|---|
| `src/input/keymap.ts` | **fonte única** das teclas (`DEFAULT_KEYMAP`), controles de mouse (`MOUSE_CONTROLS`), limiar clique×arrasto, remapeamento (`applyRemap`, `keysFor`, `keymapConflicts`, `controlsRows`), regra de campo de texto (`isTypingTarget`) |
| `src/input/InputManager.ts` | lê teclado (pelo mapa efetivo) e mouse sobre o canvas; produz mover/olhar/zoom/toggles |
| `src/input/mouseGesture.ts` | PURO: clique × arrasto (esquerdo e direito), deltas de câmera, `isWorldTarget` (UI consome) |
| `src/input/inputPrefs.ts` | sensibilidade da câmera e eixo Y invertido (local, `pv3d.input`) — a tela de ajustes (agente D) escreve aqui |
| `src/camera/vehicleCam.ts` | PURO: câmera de veículo segue o rumo; olhar em volta e volta ~1 s depois de soltar |
| `src/ui/escStack.ts` | pilha única do Esc + `installEscKey()` (o único listener de Escape) + `EscSlot` |
| `src/ui/hud/GameMenu.ts` | menu do jogo (Esc sem nada aberto) |
| `src/ui/hud/ControlsScreen.ts` | tela de CONTROLES (F1 / menu) gerada do mapa, com remapeamento |
| `tests/desktopInput.test.ts`, `tests/desktopInputManager.test.ts` | mapa, remapeamento, conflitos, pilha do Esc, campo de texto, clique×arrasto, câmera de veículo, UI consome |

## Mouse

| entrada | faz | detalhe |
|---|---|---|
| **mover** | realce do objeto sob o cursor | seta normal; **mão** (`pointer`) sobre objeto interativo ao alcance; **cursor de interação** (`context-menu`) sobre outra pessoa ao alcance; objeto distante só é identificado ("CARRO · longe" / "chegue mais perto"), cursor normal |
| **clique esquerdo** | selecionar / interagir (`InteractionSystem.pointAt`) | só se soltar dentro de `CLICK_SLOP_PX` = 6 px e `CLICK_MAX_MS` = 400 ms; **nunca é soco** |
| **esquerdo arrastando** | gira a câmera (alternativa para trackpad) | passou do limiar = arrasto: **não clica** (arrastar por cima de um jogador não abre o painel) |
| **botão direito segurado + arrastar** | gira a câmera | responde desde o 1º pixel; cursor visível (vira mão fechada `grabbing` só durante o arrasto); soltou → volta a interagir na hora |
| **botão direito curto** | nada | **sem menu contextual**: a prioridade do botão direito é a câmera (decisão desta rodada) |
| **roda** | aproximar / afastar | |
| menu de contexto do navegador | bloqueado sobre o cenário | `contextmenu` com `preventDefault` só no canvas (HUD e campos continuam com o menu normal) |

Sensibilidade: `inputPrefs.set({ sensitivity })` (0,25–3 × 0,0024 rad/px) e `inputPrefs.set({ invertY })`; o
InputManager aplica na hora. A aba de ajustes é do agente D.

### UI consome antes do mundo

Os eventos de mundo (pointerdown/up, roda, menu de contexto) são escutados **no canvas** e só valem quando o alvo é o
próprio canvas (`isWorldTarget`). HUD, painéis, inventário, chat, rótulo de interação, menu e ajustes ficam por cima e
recebem o evento — clicar neles não ataca, não anda, não seleciona veículo e não gira a câmera. Um arrasto que começou
no cenário continua mesmo passando por cima do HUD (captura do ponteiro no canvas).

### Teclado × campos de texto

Regra global `isTypingTarget` (INPUT de texto, TEXTAREA, **SELECT**, contentEditable): com o foco num campo, nenhuma
tecla de jogo vale (InputManager, roda de ações, chat). Rádios, caixas e controles deslizantes dos ajustes **não** contam
como campo (F1/WASD continuam). Chat: **Enter** foca, **Esc** sai, WASD não move digitando, **clicar fora** (cenário ou
HUD) devolve o teclado ao jogo; canais GERAL / PERTO / GRUPO como antes (Tab troca).

## Mapa final de teclas (DEFAULT_KEYMAP)

| grupo | ação | tecla |
|---|---|---|
| MOVIMENTO | andar / acelerar · trás / frear e ré · esquerda · direita | W A S D (e setas) |
| | correr / mais rápido no veículo | Shift |
| | pular | Espaço |
| CÂMERA | girar | botão direito + arrastar (ou esquerdo arrastando) |
| | zoom | roda |
| INTERAÇÃO | usar / entrar / sair (atalho do clique) | E |
| | selecionar / interagir | clique esquerdo |
| VEÍCULOS | dirigir | W A S D |
| | olhar em volta (volta atrás do veículo ao soltar) | botão direito + arrastar |
| | sair | E ou o botão SAIR do HUD do veículo |
| COMBATE | soco / golpe do item · chute · esquiva · empurrão | R · Q · C · F |
| | modo pacífico / interação | K |
| ITENS | pegar · largar · guardar/sacar | T · Z · X |
| | inventário (agente B) | I |
| | acesso rápido 1–5 (agente B) | 1 2 3 4 5 |
| SOCIAL | roda de ações | G |
| | chat | Enter (fixo) |
| SISTEMA | mapa · HUD limpo · controles · desempenho | M · H/P · F1 (fixo) · F3 (fixo) |
| | fecha o painel do topo / menu do jogo | Esc (fixo) |

## Auditoria: o que mudou

| AÇÃO | TECLA ATUAL (rodada 10) | TECLA NOVA (rodada 11) | MOTIVO |
|---|---|---|---|
| girar a câmera | mouse com pointer lock (1º clique captura) | botão direito + arrastar (esquerdo arrastando também) | cursor sempre visível; o mouse vira interface |
| soco | clique esquerdo (capturado) ou R | **R** | clique esquerdo é seleção; nunca ataca por acidente |
| chute | botão direito (capturado) ou Q | **Q** | botão direito é a câmera |
| esquiva / empurrão | C / F | C / F | sem conflito, preservados |
| interagir | clique com o mouse solto (capturado: centro da tela) | clique esquerdo no ponto do cursor (sem modo "mira") | um só jeito, sem estado escondido |
| soltar o mouse | Esc | — | não há mais o que soltar |
| Esc | ~10 listeners sem ordem (vários fechavam juntos) | pilha única: fecha só o topo; vazio = menu do jogo | hierarquia previsível |
| inventário | — | I | novo (agente B); sem conflito |
| acesso rápido | — | 1–5 | novo (agente B); a roda de ações aberta continua com 1–4 para categorias (`InputManager.quickBlocked`) |
| controles (F1) | caixa de texto fixa | tela gerada do mapa, com remapeamento | uma fonte só; muda junto com o mapa |
| espectador | arrastar (listener próprio) | arrastar pelo InputManager (direito, ou esquerdo passando do limiar) | um gesto só; sem dupla rotação |

### Conflitos resolvidos

- **1–4 da roda × 1–5 do acesso rápido**: com a roda aberta, 1–4 trocam a categoria (a roda escuta a janela) e o
  InputManager **não** dispara `quick_N` (`quickBlocked = () => wheel.open`; contado em `__pv.input().stats.quickToWheel`).
- **Espectador 1–6 (câmeras)**: o espectador não tem acesso rápido (sem inventário); os toggles `quick_N` não são consumidos.
- **Esc no chat**: o listener único roda na fase de captura, antes do campo — o chat (camada 10) fecha; se houver um
  painel aberto por cima (camada maior), ele fecha primeiro.
- **Botão direito × menu contextual**: câmera venceu; o menu do navegador é bloqueado só no canvas.
- **PersonPanel**: antes fechava em qualquer pointerdown fora — agora só no **esquerdo**, para girar a câmera com o painel aberto.
- **Mapa padrão sem conflitos** (`keymapConflicts({}) = []`, testado).

## Esc com hierarquia

`src/ui/escStack.ts`: cada painel registra uma camada ao abrir (`EscSlot`/`pushEsc`) e sai ao fechar. Um Esc fecha
**só o topo** (maior prioridade; empate = o aberto por último). Prioridades: 300 confirmação (SAIR, captura de tecla) ·
200 diálogo (conta, editor de pichação) · 100 painel (inventário, ajustes, controles, menu do jogo, pessoa, agenda,
progresso) · 50 popover (☰, barra de ações, roda, HUD limpo, popovers da tela inicial) · 10 chat. Sem nada aberto,
abre o **menu do jogo**. Listener único: `installEscKey()` (captura na janela, `stopImmediatePropagation` quando trata).
Migrados: HudShell (☰, barra, HUD limpo), SettingsPanel, PersonPanel, ChatPanel, ActionWheel, ProgressionUI, AgendaPanel,
GraffitiEditor, accountDialog e os popovers da tela inicial (`main.ts`). QA: `__pv.input().esc` (camadas) e `.escLog`.

### Menu do jogo

Sobreposição (o mundo **não pausa**, a conexão continua): **CONTINUAR · CONFIGURAÇÕES · CONTROLES · ÁUDIO · GRÁFICOS ·
SAIR**. CONFIGURAÇÕES/ÁUDIO/GRÁFICOS chamam `HudShell.openSettings(tab)` (`'geral' | 'audio' | 'graficos' | 'interface'`);
enquanto o painel com abas do agente D não chega, abre o painel de ajustes atual (marcado `// rodada 11 — integrar aba`;
se o SettingsPanel ganhar `openTab(tab)`, ele é chamado). SAIR pede confirmação ("SAIR DO EVENTO" / "FICAR") e volta à
tela inicial.

## Tela de CONTROLES (F1 e menu)

Gerada de `DEFAULT_KEYMAP + MOUSE_CONTROLS` (`controlsRows`), agrupada **MOVIMENTO, CÂMERA, INTERAÇÃO, VEÍCULOS,
COMBATE, ITENS, SOCIAL, SISTEMA**. **Remapeamento** das teclas principais: clique na tecla → "Aperte…" → a nova tecla
(Esc cancela). Tecla já usada → aviso "X já é de 'Y'" com **Trocar mesmo assim / Cancelar** (trocar tira a tecla da
outra ação, que pode ficar sem tecla — avisado). Esc, Enter, F1, F3, Tab e Meta são reservadas. **Restaurar padrão**
apaga os remapeamentos. Persistência local (`saveKeyOverrides`, `pv3d.keys`); o InputManager relê na hora
(`reloadKeymap`) e a barra de ações mostra a tecla efetiva. A tecla principal muda; as secundárias (setas) ficam. No
toque, a tela mostra o resumo dos controles de tela.

## Câmera

- A pé: só gira com o arrasto (direito, ou esquerdo passando do limiar); a roda aproxima/afasta (`ThirdPersonCamera`
  inalterada: colisão com prédios e chão).
- **Dirigindo** (carro, moto, bicicleta, patinete — iguais; carro de som e trio também): a câmera acompanha o rumo
  suavemente (carro 2,2/s, demais 1,5/s; parado sem olhar em volta, fica onde está). **Botão direito arrastando = olhar
  em volta**: enquanto segura, nada puxa a câmera; ao soltar, espera **1 s** (`RETURN_DELAY_MS`) e volta para trás do
  veículo com suavização, mesmo parado. Medido no Chrome: 0,5 s depois de soltar ainda 1,26 rad fora do rumo; 2,4 s
  depois, 0,04 rad.
- SAIR: botão do HUD do veículo (clicável, `title` "Sair do veículo (tecla E)") ou **E**.

## Textos atualizados

"Clique para controlar a câmera" (lock-hint) removido; ajuda do HUD (agora a tela de controles), dica da barra
("W A S D mover · clique interage · botão direito + arrastar câmera · G roda · Esc menu"), rodapé dos ajustes, popover
de ajuda da tela inicial (`index.html`), dica de início do HUD e onboarding ("Toque ou clique nos objetos para
interagir. Botão direito + arrastar gira a câmera."), atalhos da barra de Confronto (lidos do mapa efetivo).

## Celular e espectador

Toque inalterado (joystick, arrasto = câmera, toque = interação pelo `TapTracker`): o gesto de mouse só considera
`pointerType === 'mouse'`. Espectador continua girando por arrasto (agora pelo InputManager).

## QA (`tools/qa/desktop_input.mjs`, Chrome real 1280×720 e 1920×1080)

**46/46** (`docs/screenshots/round11/desktop_input.json`): cursor visível e `pointerLockElement === null` em 14 pontos
(entrada, clique, arrasto, carro, moto, bicicleta, patinete, combate, menu, evento, espectador, 1920×1080); nenhuma chamada de `requestPointerLock`; botão direito + arrasto gira e
soltar para; menu de contexto bloqueado; esquerdo arrastando não clica; HUD consome clique/direito/roda; carro distante
identificado e não usado; hover → mão; clique entra; dirigir com W; olhar em volta + retorno; SAIR (clique) e E;
moto/bicicleta/patinete; R/Q/C agem e clique esquerdo não soca; chat (Enter, WASD não move, Esc, clique fora, canais);
Esc fecha só o topo e abre o menu; menu não pausa nem desconecta; SAIR confirma; controles agrupados; remapeamento
(N abre o mapa), conflito avisado, restaurar padrão; cursor de interação em pessoa; arrastar sobre o jogador não abre
o painel e o clique abre; girar com o painel aberto não fecha; Esc fecha o painel; espectador gira arrastando
(esquerdo e direito). Celular sem regressão: `tools/qa/interaction_mp.mjs` 44/44 (só o "Esc por garantia" do roteiro
passou a apertar Esc apenas com uma camada aberta — sem nada aberto, Esc agora abre o menu). Custo da seleção com 500 entidades:
`tools/qa/selection_500.mjs` (docs/INTERACTION_SYSTEM.md). O Chrome headless não desenha o
cursor do sistema: nas capturas, uma seta branca marca a posição do mouse.

Capturas: `docs/screenshots/round11/` — A_hud_desktop, B_cursor_sobre_carro, C_carro_selecionado, D_dirigindo_cursor,
E_moto, F_bicicleta, G_patinete, M_menu_jogo, R_controles, T_chat, V_confronto.
