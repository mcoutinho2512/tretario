# Inventário

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
