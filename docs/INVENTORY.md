# Inventário

Rodada 11 (agente B: inventário, equipamentos e acesso rápido; agente C: prévia 3D). Regras de slot e de servidor em
[EQUIPMENT_SYSTEM.md](EQUIPMENT_SYSTEM.md). Código em `src/inventory/` (contrato `types.ts`).

## O que é

Uma VISÃO do que já existe no jogo, montada a cada abertura dos registros únicos (`src/inventory/catalog.ts`) — nada
de conteúdo fictício, nada à venda (sem loja/PIX/compra: bloqueado só sai pela progressão existente). Abre pela tecla
**I** (keymap, remapeável) ou pelo botão **INVENTÁRIO** do HUD (e ☰ → Inventário, inclusive no toque); fecha com I, ×
ou Esc (pilha única, `EscSlot('inventory', 100)`). O mundo não pausa; o personagem fica parado (andar/correr/pular
bloqueados só enquanto aberto).

## Categorias (só as que têm conteúdo) — contagem real, corpo `homem`

| categoria | origem | itens | slot |
|---|---|---|---|
| ROUPAS | peças que o corpo veste (`garments.ts`, muda por corpo) + camisas estampadas (`designs.ts`, alvo `shirt`, menos as de torcida) | 26 (14 peças + 12 camisas; 4 bloqueadas: camisas 208–211) | HEAD/TORSO/LEGS/FEET |
| ACESSÓRIOS | `ACCESSORIES` (boné, sacola, bolsa, óculos, chapéu) | 5 | ACCESSORY |
| ITENS | seguráveis sem arte (megafone, apito, guarda-chuva, percussão) | 4 | HAND |
| MANIFESTAÇÃO | seguráveis com arte (bandeiras, cartazes, placa, faixa) | 6 | HAND |
| BANDEIRAS | artes de bandeira/cartaz/faixa (neutras, Brasil, grupos, evento, recompensas, futebol, campanhas dos DADOS) | 24 (4 bloqueadas: recompensas) | HAND |
| EQUIPAMENTOS | itens de confronto (taco, barra, spray) — posse do servidor (ou `freeCombatProps`) | 3 | HAND |
| TORCIDA | escolha da torcida + camisa + bandeira + faixa de cada uma (DADOS) | 16 | SUPPORTER/TORSO/HAND |
| VEÍCULOS (rodada 12) | veículo pessoal: patinete, bicicleta, moto, carro (`veh:<tipo>`) — USAR AGORA = aparece junto e monta (`pveh_req`; o servidor decide ponto/estado/taxa); "equipado" = montado no seu pessoal desse tipo; DESCER desequipa | 4 | VEHICLE |
| TÍTULOS | recompensas `title` de missões/conquistas | 3 (bloqueados até ganhar) | TITLE |
| COSMÉTICOS | — sem conteúdo hoje → não aparece | 0 | — |

Filtros: TODOS · EQUIPADOS · DESBLOQUEADOS · NOVOS ("novo" = desbloqueio não gratuito ainda não aberto, marcado no
aparelho — `localStorage pv3d.inv.seen`). Sem raridade. Cada item: nome, tipo, estado (equipado/disponível/bloqueado
com o motivo da progressão: "Nível 3", "Missão: ENTRE NO CLIMA", "Conquista: BOA CONVERSA") e ação no tooltip.

## Fluxo

categoria → item (clique; não refaz a grade) → prévia (3D para roupas/acessórios/camisas: o item vestido sobre a
aparência atual, girar arrastando, roda/+/− aproxima, FRENTE/COSTAS) → **EQUIPAR** (ou duplo clique) → o servidor
confirma → aparece no avatar. **DESEQUIPAR** quando cabe (acessório → nenhum, estampa → lisa, peça → a base do corpo,
mão → livre, título → nenhum, torcida → neutro) sem obrigar a escolher outro. Bloqueado: botão BLOQUEADO + aviso curto.

| equipar | caminho (o servidor decide) |
|---|---|
| roupa/acessório/camisa (conta) | `PUT /api/me/appearance {appearance, strict: true}` → 403 `bloqueado` se houver item bloqueado; aceito → `game.setAppearance` (a sala relê do banco) e a tela inicial recebe o visual (`registerInventoryAccount`) |
| roupa/acessório/camisa (visitante, servidor de teste) | mensagem `appearance` (a sala valida); o cliente compara com a própria `NetPlayer` e desfaz o que o servidor recusou |
| mão (item, arte, equipamento) | `prop {p, d}` pelo `SocialController` (validateProp) |
| título | `title {t}` (sala; conta grava em `Profile.titleKey`) — ou `PUT /api/me/title` |
| torcida | conta: `saveSupporter` de main.ts (PUT /api/me/supporter); visitante: `sup {group}` |
| veículo pessoal (rodada 12) | `pveh_req {kind, seq}` pelo `PersonalVehicleClient` (o painel fecha para ver surgir); `pveh_ok` / `pveh_denied` — docs/PERSONAL_VEHICLES.md |

## Acesso rápido 1–5

Só itens de gameplay — seguráveis, equipamentos, artes de mão (`prop:<id>`, `design:<key>`) e, rodada 12, veículos
pessoais (`veh:<tipo>`: a tecla pede o veículo, que aparece e monta; de novo, montado, desce; slot aceso = montado no
seu pessoal desse tipo); nunca roupa, acessório, título ou torcida (`quickbar.ts isQuickKey`). Teclas 1–5 (toggles `quick_1..5` do keymap; com a roda G aberta 1–4 são
dela) ou clique no slot; de novo no mesmo = guardar. Troca guarda o anterior (a mão é uma só; o item de confronto
possuído fica guardado, como no X). "FIXAR NO ACESSO RÁPIDO" no painel (botões 1–5); padrão: bandeira, cartaz,
megafone. Layout do aparelho: `localStorage pv3d.quickbar` (try/catch; saneado na leitura). Slot aceso = item na mão
confirmado (o mesmo que o indicador MÃOS e o avatar — `__pvInv.handSync()`).

## Custo e vazamento (tools/qa/inventory_mp.mjs → docs/bench/round11_inventory.json)

Chrome/Metal, 2 navegadores no servidor de teste. CDP `Memory.getDOMCounters` após GC, `__pv.memoryReport`, prévia:

| medida | antes | depois |
|---|---|---|
| abrir/fechar 100× — ouvintes JS | 318 | 319 |
| abrir/fechar 100× — nós DOM | 1849 | 1850 |
| abrir/fechar 100× — heap JS | 148,3 MB | 148,6 MB |
| abrir/fechar 100× — handles de prévia vivos / renderers da prévia criados | 0 / 1 | 0 / 1 (o mesmo renderer reaproveitado) |
| abrir/fechar 100× — programas do renderer do JOGO | 76 | 76 |
| 20 roupas + 20 acessórios — renderer da prévia (tex/geo/prog) | 19/10/11 | 39/22/11 na 1ª rodada (peças entram no cache) → **39/22/11 na 2ª** |
| 40 prévias — handles/renderers | 1 handle, 1 renderer | idem; ouvintes 325 → 324 |

Texturas do renderer do JOGO crescem com o mundo (multidão/chão em streaming) mesmo sem abrir nada; a sonda
`tools/qa/inventory_probe.mjs` (docs/bench/round11_inventory_probe.json) separa: parado +0…+17, 100 ciclos COM
prévia +1, 100 ciclos sem prévia +8 — o inventário não sobe recurso no renderer do jogo. O painel é criado uma vez;
ouvintes por delegação; a grade só é refeita quando muda categoria/filtro/estado; o lado direito só quando muda o
item/estado (o botão sob o cursor não é trocado no meio de um clique).

## QA e capturas

`PV_API=http://127.0.0.1:3821 npx vite --port 5202 --strictPort` → `node tools/qa/inventory_mp.mjs` (30 verificações:
categorias, I/Esc, 100 ciclos, 40 prévias, B vê roupa/acessório/item/torcida de A, acesso rápido por tecla e clique,
título ganho → público, painel da pessoa). Capturas em `docs/screenshots/round11/`: J_inventario, K_acessorios,
L_roupas, M_torcida, N_item_equipado, O_quickbar, P_preview_3d_inventario, H_jogador_selecionado, I_perfil_contextual.
`window.__pvInv` = `{ inv, info(), entries(), handSync(), players(), showPerson(nome), send() }`.


## Prévia 3D
Prévia reutilizável do avatar (editor de personagem e inventário): `createSharedPreview(container)` em
`src/ui/preview/sharedPreview.ts`, que devolve o `AvatarPreviewHandle` do contrato (`src/inventory/types.ts`) com extras
(`SharedPreviewHandle`: `ready`, `setPose`, `rotate`, `zoom`, `zoomLevel`, `portraits`, `info`).

```ts
const { createSharedPreview } = await import('../ui/preview/sharedPreview'); // chunk com three.js, sob demanda
const pv = createSharedPreview(el);   // el: contêiner posicionado; o canvas ocupa 100%
pv.show(aparencia);                   // aparência completa (ou o item vestido sobre a atual); bloqueados também aparecem
pv.view('back');                      // frente/costas (caminho mais curto); arrasto gira, roda/pinça aproxima
pv.setPose('acenando');               // parado | andando | acenando | dancando
pv.dispose();                         // ao fechar o painel
```

**Arquitetura**
- **Um** `WebGLRenderer` de prévia por página (singleton com contagem de uso). O canvas é movido para o contêiner do
  handle ativo (o último que chamou `show`/foi criado); só ele é desenhado. A cena de estúdio (luzes, ambiente PMREM,
  chão de sombra) é única. Nada de "outro mundo": a cena tem só o estúdio e o personagem.
- Cada handle tem só o seu `HumanCharacter` LOD0 (o mesmo do jogo) e o seu estado de câmera. Malhas, texturas, peças e
  clipes vêm do cache de `HumanAssets` (compartilhado com o jogo) e **nunca** são descartados pela prévia.
  `dispose()` libera só o que é do handle: materiais/esqueletos do personagem (`HumanCharacter.dispose`), o
  `ResizeObserver` e os ouvintes do contêiner (um `AbortController`).
- Sem handles, o renderer fica ocioso por `PREVIEW_IDLE_MS` (15 s) — abrir/fechar o editor não recria contexto — e
  então é descartado (`forceContextLoss`). `disposeSharedPreview()` libera na hora (a entrada no jogo chama).
- **Perda de contexto** (Safari em segundo plano, GPU reiniciada, limite de contextos do navegador): o núcleo é
  descartado e recriado com um canvas novo em ~250 ms; o personagem ativo volta a ser desenhado (os dados estão na CPU
  e no cache). Não depende da restauração parcial do three.js.
- A prévia não pré-compila no renderer do jogo (`HumanCharacter` com `warmup: false`): antes, cada corpo novo na prévia
  compilava os shaders também no contexto do jogo.

**Escolha: 2º contexto (singleton) × renderer do jogo** — medido em `docs/bench/round11_preview.json`
(Chrome/Metal, Mac M, prévia 1056×859 px de buffer):

| | custo |
|---|---|
| desenhar a prévia no próprio canvas | **1,85 ms/quadro** |
| desenhar no renderer do jogo num render target + `readPixels` + `putImageData` (levar ao DOM) | **15,76 ms/quadro** (8,5×; trava a GPU a cada quadro) |
| abrir o editor com o renderer já criado / criando o contexto | 217 ms / 244 ms (≈ 30 ms do contexto) |
| memória do 2º contexto (texturas do personagem reenviadas) | ≈ 93 MB de texturas estimados (`memoryReport`), só enquanto aberto + 15 s |
| quadro do jogo com o editor aberto por cima | 16,67 ms × 16,65 ms fechado (sem diferença mensurável) |

Na tela inicial não existe renderer do jogo; no jogo, a alternativa sem cópia seria recortar o canvas do jogo por
baixo do editor (viewport/scissor depois do pós-processamento), acoplando a interface ao pipeline gráfico. O custo do
2º contexto é pago uma vez por sessão do editor e liberado no ócio; o limite de contextos não é atingido (1 do jogo +
1 da prévia, reaproveitado).

**Vazamento** (`tools/qa/editor_preview.mjs`, CDP `Performance.getMetrics` após GC + `renderer.info` + `__pvPreview.memoryReport()`):

| | rodada 10 (`AvatarPreview`) | rodada 11 (`sharedPreview`) |
|---|---|---|
| abrir/fechar 30× — contextos WebGL criados | 0 novos, mas a prévia ficou **indisponível em 30/30 reaberturas** (canvas reaproveitado com contexto perdido) | 0 novos; 1 renderer reutilizado nas 30 |
| abrir/fechar 30× — ouvintes JS | 133 → 223 (+3 por abertura) | 143 → 142 |
| abrir/fechar 30× — geometrias/texturas/programas da prévia | — (sem prévia) | 19/27/11 → 19/26/10 |
| 20 roupas + 20 acessórios (2 rodadas) | — | 19/26/10 → 24/38/11 (peças novas no cache) → 24/38/11 na 2ª rodada |
| no jogo, 10× abrir/fechar | — | +1 contexto (o da prévia, reaproveitado); renderer do jogo sem crescer além do controle |

**QA / depuração**: `window.__pvPreview` = `{ info(), memoryReport(), loseContext(), dispose(), benchReadback(n) }`;
`window.__pvStart.preview` é o handle do editor aberto. Retratos (`portraits`) usam o mesmo renderer (render target),
sem contexto extra (`tools/qa/make_portraits.mjs`).
