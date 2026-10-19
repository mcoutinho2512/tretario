# Performance

## Metas
| Plataforma | Meta |
|---|---|
| Desktop 1920×1080 | 60 FPS |
| Notebook intermediário | ≥ 45 FPS confortável |
| Mobile | 30 FPS (primeiro objetivo) |

## Medições (2026-10-15)

Máquina: **Apple M5 Pro (16 núcleos de GPU), macOS, Google Chrome 155**, WebGL2 via ANGLE/Metal,
1920×1080 (DPR 1, headless). Medido com `UNCAPPED=1 node tools/qa/screenshots.mjs` (vsync
desligado), 4 pontos do corredor, às 16:30 (com sombras).

| Preset | Ponto | FPS (sem vsync) | Frame (ms) | Draw calls | Triângulos |
|---|---|---|---|---|---|
| BAIXO | Central | 658 | 1,5 | 175 | 150 k |
| BAIXO | Avenida (início) | 538 | 1,9 | 289 | 251 k |
| BAIXO | Intermediário | 670 | 1,5 | 195 | 186 k |
| BAIXO | Candelária | 680 | 1,5 | 114 | 152 k |
| MÉDIO | Central | 540 | 1,9 | 237 | 366 k |
| MÉDIO | Avenida | 519 | 1,9 | 391 | 475 k |
| MÉDIO | Intermediário | 510 | 2,0 | 245 | 369 k |
| MÉDIO | Candelária | 537 | 1,9 | 177 | 387 k |
| ALTO | Central | 249 | 4,0 | 502 | 1,06 M |
| ALTO | Avenida | 241 | 4,2 | 816 | 1,23 M |
| ALTO | Intermediário | 236 | 4,2 | 538 | 1,02 M |
| ALTO | Candelária | 219 | 4,6 | 386 | 0,96 M |

Com vsync, todos os presets ficam travados em **60 FPS** (pior frame ≈ 17,6 ms).
Carregamento até jogável: **~1,2–1,6 s** em localhost.
Texturas: 30 (BAIXO), 31 (MÉDIO), 43 (ALTO, inclui alvos de pós-processamento).

> Aviso honesto: um M5 Pro é muito mais forte que um notebook intermediário, e o modo headless mede o
> intervalo de frames (CPU e submissão), não o tempo exato de GPU. Os números mostram a folga, não
> garantem o desempenho em hardware fraco. **Ainda falta medir** num notebook com Intel UHD/Iris
> e em celulares reais (iPhone/Android). Ver STATUS.

Mobile (emulação de iPhone 14 no Chrome, preset automático = BAIXO): 60 FPS, 119 draw calls e 127 k
triângulos. O joystick funcionou e não houve erros. Isso **não** substitui o teste em Safari/iPhone real.

### Com NPCs e trânsito (Fase 1)
| Preset | Pedestres | Veículos | Frame sem vsync | Draw calls | Triângulos |
|---|---|---|---|---|---|
| BAIXO | 14 | 24 | 1,6–1,9 ms | 113–286 | 180–272 k |
| MÉDIO | 32 | 48 | 1,9–2,1 ms | 171–379 | 440–526 k |
| ALTO | 56 | 80 | 4,3–4,7 ms | 394–792 | 1,24–1,38 M |

## Multiplayer (rodada 4, 2026-10-16)

### Cliente por preset com 10 bots (`node tools/qa/bench_presets.mjs`)
M5 Pro, Chrome headless 1280×720, **com vsync**, média de 12 amostras em 6 s. `central` = spawn em frente à Central
(10 bots visíveis); `candelaria` = (690, −150), sem bots por perto.

| Preset | Vista | CPU ms | GPU ms | Draw calls | Triângulos | Heap | Texturas | Geometrias | Rede ↓ |
|---|---|---|---|---|---|---|---|---|---|
| LOW | central | 1,56 | 3,24 | 341 | 379 k | 148 MB | 52 | 456 | 3,2 KB/s |
| LOW | candelária | 1,45 | 2,94 | 117 | 243 k | 174 MB | 49 | 345 | 1,7 KB/s |
| MEDIUM | central | 1,93 | 4,33 | 474 | 755 k | 175 MB | 66 | 535 | 3,2 KB/s |
| MEDIUM | candelária | 1,74 | 3,32 | 195 | 548 k | 190 MB | 67 | 404 | 1,5 KB/s |
| HIGH | central | 3,27 | 13,09 | 1029 | 1,89 M | 246 MB | 92 | 567 | 3,2 KB/s |
| HIGH | candelária | 3,04 | 11,07 | 467 | 1,61 M | 250 MB | 93 | 394 | 1,3 KB/s |
| ULTRA | central | 4,44 | 11,95 | 1149 | 2,28 M | 241 MB | 110 | 604 | 3,4 KB/s |
| ULTRA | candelária | 3,09 | 10,34 | 540 | 1,98 M | 254 MB | 123 | 445 | 1,1 KB/s |

Todos a 60 FPS (16,67 ms com vsync). O tempo de GPU do HIGH/ULTRA (10–13 ms) é o maior risco em GPU integrada fraca.

### Download
| Item | Bruto | gzip | Quando |
|---|---|---|---|
| `index` (tela inicial) | 6 KB | 2,8 KB | sempre |
| `three` | 522 KB | 133 KB | ao explorar |
| `Game` | 284 KB | 115 KB | ao explorar |
| `NetworkClient` (SDK Colyseus + netcode) | 182 KB | 58 KB | só com `?mp` |
| **Rapier (WASM embutido)** | **4,3 MB** | **1,65 MB** | só com `?mp`, pré-carregado em segundo plano |
| Colisão `collision.<hash>.bin` | 1,55 MB | 0,56 MB | ao explorar |
| `dist/` completo | 9,9 MB | — | — |

No servidor de desenvolvimento (Vite, sem minificação) o carregamento do trecho mede ~11,1 MB transferidos.

### Rede e servidor (`cd server && npx tsx tools/loadtest.ts 20`)
Bots do SDK enviando movimento a 15 Hz durante 20 s; o servidor simula 220 veículos.

| Bots | Distribuição | Cliente ↓ | Cliente ↑ | Msgs/s ↓ | Visíveis (méd/mín/máx) | Servidor ↑ total | Tick médio / máx | RSS |
|---|---|---|---|---|---|---|---|---|
| 2 | juntos | 1,76 KB/s | 0,67 KB/s | 18,7 | 2 / 2 / 2 | 3,7 KB/s | 0,86 / 2,04 ms | 118 MB |
| 5 | juntos | 2,28 KB/s | 0,67 KB/s | 19,0 | 5 / 5 / 5 | 12,1 KB/s | 0,85 / 1,62 ms | 126 MB |
| 10 | juntos | 3,11 KB/s | 0,67 KB/s | 19,5 | 10 / 10 / 10 | 32,2 KB/s | 0,84 / 1,90 ms | 131 MB |
| 20 | juntos | 4,80 KB/s | 0,67 KB/s | 19,0 | 20 / 20 / 20 | 95,5 KB/s | 0,87 / 1,93 ms | 139 MB |
| 20 | espalhados (2 km) | 2,42 KB/s | 0,68 KB/s | 18,9 | 4,8 / 2 / 8 | 45,7 KB/s | 0,92 / 2,03 ms | 157 MB |
| 50 | espalhados (2 km) | 3,62 KB/s | 0,68 KB/s | 19,4 | 12 / 4 / 19 | 159,4 KB/s | 1,10 / 2,52 ms | 160 MB |

- Com todos no mesmo lugar, o custo cresce ~0,16 KB/s por jogador visível; com AOI (espalhados) 50 jogadores custam
  menos por cliente que 20 juntos.
- Tick do servidor (trânsito + validação + AOI) fica em ~1 ms a 10 Hz: há folga de ~100× por núcleo.
- Navegador real no walkthrough (3 clientes): ~2,0–2,1 KB/s ↓ e ~0,53–0,57 KB/s ↑ por cliente; sob 150 ms ± 30 ms,
  ~1,55 KB/s ↓ e ~0,55 KB/s ↑, interpolação adaptativa entre 157 e 300 ms, **zero correções** indevidas.

## Presets (`src/core/settings.ts`)

| | BAIXO | MÉDIO | ALTO |
|---|---|---|---|
| Pixel ratio máx. | 1 | 1,5 | 2 |
| Sombra | desligada | 2048², raio 110 m | 4096², raio 170 m |
| LOD FULL / MEDIUM / FAR | 220 / 520 / 1400 m | 330 / 750 / 2200 m | 450 / 1000 / 3000 m |
| Copas detalhadas | 50 % | 85 % | 100 % |
| Mobiliário até | 140 m | 230 m | 340 m |
| Oclusão ambiente (GTAO) | — | — | sim |
| Anti-aliasing | — | MSAA nativo | SMAA |
| Neblina / far | 1500 / 1800 m | 2200 / 2600 m | 3000 / 3400 m |
| Pedestres / veículos | 14 / 24 | 32 / 48 | 56 / 80 |

Detecção automática: ver "Rodada 11 — … Detecção (regra)" abaixo (substitui a regra antiga).

## Rodada 11 — presets revisados, ULTRA, limite de FPS, troca ao vivo e detecção

Código: `src/core/settings.ts` (presets, `reloadOnlyChanges`), `src/core/graphicsLive.ts` (troca ao vivo),
`src/renderer/Renderer.ts` (`applyPreset`, `applyAnisotropy`, MSAA no alvo HDR), `src/renderer/Environment.ts`
(`setFar`, neblina sem perder a cor da hora), `src/core/frameGovernor.ts` (limite 30/60/0), `src/core/fpsChoice.ts`,
`src/core/device.ts` (capacidades). Testes: `tests/round11Graphics.test.ts`. Bancada: `tools/qa/bench_r11_presets.mjs`
→ `docs/bench/round11_presets.json`. Capturas: `docs/screenshots/round11/bench/`.

### Presets (rodada 11)

| | BAIXO | MÉDIO | ALTO | ULTRA |
|---|---|---|---|---|
| Pixel ratio máx. | 1 | 1,5 | 2 | 2 |
| Sombra | — | 2048², 110 m | 4096², 170 m | 4096², **260 m** |
| LOD FULL / MEDIUM / FAR | 220/520/1400 | 330/750/2200 | 450/1000/3000 | **650/1300/3400** |
| AO (GTAO) | — | — | sim | sim |
| Anti-aliasing | — | MSAA do canvas | SMAA | **MSAA 4× no alvo HDR** (sem SMAA) |
| Anisotropia (novo) | 2× | 4× | 8× | **16×** |
| Pedestres / raio | 14 / 70 m | 32 / 90 m | 56 / 95 m | 90 / 120 m |
| Multidão (total / esqueletos) | 200 / 8 | 350 / 16 | 600 / 24 | 800 / 32 |

ALTO ≥ MÉDIO em todos os campos (teste): sombra 2× mais resolvida e ~1,5× mais longe, oclusão ambiente, ~1,7× os
pedestres, personagens LOD0. Mudanças da rodada: **anisotropia por preset** (antes fixa por textura, 4–8×: o BAIXO
economiza amostragem, o ULTRA ganha nitidez do asfalto/pedra em ângulo raso — trocada direto no parâmetro da textura
na GPU, sem reenviar imagem) e o **AA do ULTRA**. Celular: anisotropia ≤ 4×, sem MSAA no HDR (`mobileAdjust`).
Bancada/QA: `?msaa=0|2|4|8` e `?smaa=0|1` trocam o AA para comparar custo.

### ULTRA: avaliado e MANTIDO (opção manual)

Comparação na mesma câmera (`tools/qa/r11_compare_shots.mjs`, `bench/longe_medio_alto_ultra.jpg`, `avenida_*.jpg`):
o ULTRA mostra (1) **sombra das fachadas ao longe** (260 m de caixa: o prédio da esquerda projeta sombra no vizinho,
no ALTO não), (2) **bordas limpas** — no ALTO o SMAA deixa listras verticais na fachada branca distante e nos postes;
o MSAA 4× resolve geometria fina, (3) **multidão distante mais densa** e LOD cheio até o próximo cruzamento. É
perceptível e o custo é mensurável (abaixo); por isso fica, mas **o automático nunca escolhe ULTRA**.
MSAA × SMAA medido nesta máquina (ALTO com `?msaa=4&smaa=0` × ALTO normal): em 1080p a diferença de tempo de GPU
ficou dentro do ruído; em 3840×2160 (1920×1080 @2x, sem resolução dinâmica) ~10 % a menos de FPS (22–23 × 24–25), e
o ULTRA usa ~165 MB a mais de memória de GPU que o ALTO (livro-razão) — o ALTO continua com SMAA.

### Bancada por preset × multidão (esta máquina)

Máquina: **Apple M5 Pro desta máquina** (24 GB), Chrome 155 headless, ANGLE/Metal, **sem vsync** (`?uncapped=1`:
vazão), 1920×1080 @1x, **resolução dinâmica desligada** (`&dynres=0`: custo do preset em resolução cheia), jogador no
meio da concentração densa (40 % dos bots com vida social), câmera em 3ª pessoa olhando a avenida, 16:30. Memória da
GPU = livro-razão real (`?mem=1`, carga separada). Os números não valem para outro hardware.

| bots | preset | FPS | CPU ms | GPU ms | draw calls | triângulos | heap JS | GPU (MB) |
|---|---|---|---|---|---|---|---|---|
| 50 | BAIXO | 415 | 2,3 | 2,6 | 300 | 0,50 M | 167 MB | 334 |
| 50 | MÉDIO | 221 | 4,4 | 3,4 | 619 | 1,29 M | 191 MB | 412 |
| 50 | ALTO | 83 | 11,8 | 8,8 | 1480 | 3,75 M | 214 MB | 694 |
| 50 | ULTRA | 70 | 13,6 | 10,8 | 1495 | 3,85 M | 378 MB | 857 |
| 250 | BAIXO | 378 | 2,8 | 2,8 | 311 | 0,55 M | 199 MB | 330 |
| 250 | MÉDIO | 197 | 4,8 | 3,8 | 615 | 1,40 M | 213 MB | 420 |
| 250 | ALTO | 76 | 12,7 | 12,4 | 1565 | 4,14 M | 240 MB | 685 |
| 250 | ULTRA | 56 | 17,1 | 16,1 | 1909 | 5,15 M | 314 MB | 858 |
| 500 | BAIXO | 306 | 3,4 | 4,0 | 313 | 0,58 M | 185 MB | 335 |
| 500 | MÉDIO | 177 | 5,3 | 6,7 | 616 | 1,44 M | 215 MB | 419 |
| 500 | ALTO | 72 | 13,3 | 13,0 | 1561 | 4,47 M | 333 MB | 694 |
| 500 | ULTRA | 53 | 18,1 | 16,4 | 1888 | 5,59 M | 371 MB | 849 |

Antes da rodada (master 077ffb4, mesma cena, 1ª passada com resolução dinâmica ligada — `antes` no JSON): BAIXO
411/387/373, MÉDIO 231/202/184, ALTO 86/82/73, ULTRA 79/61/60 FPS (50/250/500); GPU 336/420/682/680 MB. BAIXO–ALTO
ficam iguais dentro do ruído; o ULTRA paga o MSAA (−10 % de FPS com 50 bots, +175 MB de GPU). O ALTO é limitado por
CPU nesta cena (draw calls/esqueletos); a 60 FPS sobra folga em todas as multidões nesta máquina, o ULTRA fica no
limite com 250–500 bots. Avenida vazia (câmera livre a 9 m, sem bots): MÉDIO 337, ALTO 161, ULTRA 121 FPS.
Retina sem resolução dinâmica (1920×1080 @2x = 3840×2160): ALTO ~24 FPS — a resolução dinâmica (0,55–1) é o que
segura 60 em telas Retina; continua ligada para todos.

### Limite de FPS: 30 / 60 / sem limite (ao vivo)

Ajustes → Gráficos → **Limite de FPS**: Automático (30 no celular, 60 no desktop), 30, 60, **Sem limite**. Troca na
hora (`FrameGovernor.setLimit`), salvo em `localStorage['pv3d.fps']`; `?fps=30|60|0` sobrepõe (testes). Sem limite =
renderiza em todo `requestAnimationFrame`, isto é, na **taxa do monitor** (120/144 Hz) — sem laço ocupado; a
resolução dinâmica defende 60. Medido (QA `desktop_graphics.mjs`, Chrome com vsync 60 Hz): 30 → 30,0 FPS (33,3 ms),
60 → 60,0, sem limite → 60 (o monitor); sem vsync: sem limite → 442 FPS e 60 → 57,7 — o limite segura e o "sem limite"
segue o rAF.

### Troca de preset ao vivo

Escolher a qualidade no painel aplica **na hora** (3–12 ms de chamada; o 1º quadro depois recompila sombras/pós):
pixel ratio, sombra (mapa recriado), AO/SMAA/MSAA do pós, anisotropia, neblina/`far` (o céu acompanha), LOD,
mobiliário, telões, pedestres, orçamento e detalhe da multidão. Só ao recarregar (o painel diz qual e oferece
"Recarregar agora"): suavização nativa do canvas (contexto WebGL — só importa quando o preset desenha direto no canvas:
MÉDIO vindo de ALTO; ou BAIXO vindo de MÉDIO, para economizar), detalhe das fachadas já construídas, e a capacidade
extra da multidão quando sobe acima da criada na carga. QA: BAIXO→MÉDIO→ALTO→ULTRA→ALTO pelo próprio rádio, sem erro,
mesmo documento.

### Detecção (regra)

1. **O navegador não entra na decisão.** Nada de "Safari → mais baixo". Safari mascara o nome da GPU ("Apple GPU");
   Firefox com resistFingerprinting diz "Mozilla" — ambos viram a classe `masked`, decidida pelas **capacidades reais**.
2. GPU por nome quando disponível (`WEBGL_debug_renderer_info`): software → BAIXO 30 FPS; celular/tablet → MÉDIO/BAIXO
   a 30 (iPhone: memória por aba); integrada Intel/AMD → BAIXO (UHD antigo) ou MÉDIO (Iris Xe/780M); Apple Silicon
   (qualquer) e GPU dedicada → ALTO.
3. `masked`: Mac com `MAX_TEXTURE_SIZE` ≥ 16384 → ALTO (o mesmo que o Chrome dá na mesma máquina); outros sistemas → MÉDIO.
4. **Tetos pelas capacidades** medidas no contexto: `MAX_TEXTURE_SIZE` < 8192 → no máximo MÉDIO; < 4096 → BAIXO; sem
   `EXT_color_buffer_float` (alvo HDR do pós) → no máximo MÉDIO. Capacidade não medida não penaliza.
5. `deviceMemory` (só Chromium) ≤ 4 GB → um nível abaixo; ausente (Safari/Firefox) não penaliza.
6. **Automático nunca escolhe ULTRA** (opção manual; custo acima). **Resolução dinâmica ligada para todos** (rede de
   segurança: só reduz quando falta folga).
O painel mostra o aparelho detectado e o motivo; `tests/device.test.ts` e `tests/round11Graphics.test.ts` fixam:
Safari e Chrome na mesma máquina → mesmo preset, FPS e resolução dinâmica.

## Técnicas aplicadas
- **Poucos materiais**: 1 material para todos os edifícios (variedade no shader) e um por tipo de superfície.
- **1 draw call de edifícios por chunk**; chão agrupado por material por chunk.
- **Instancing** global para árvores e mobiliário (cerca de 25 InstancedMesh no total).
- **LOD por chunk** com histerese, construção com orçamento por frame e liberação de geometria distante.
- **Frustum culling** por malha de chunk. Oclusão: num cânion urbano, a neblina, o LOD FAR (só ≥ 12 m)
  e o descarte além do alcance cortam a maior parte. *Occlusion queries* de hardware (WebGL2
  `ANY_SAMPLES_PASSED`) por chunk ficaram para depois, se o mapa crescer.
- **Sombra** só no entorno do jogador (caixa ortográfica com snap); BAIXO sem sombra.
- **Anti-moiré** no shader de fachada: evita aliasing e o custo de detalhe ao longe.
- **Texturas procedurais** (sem download), com mipmaps e anisotropia 8.
- **Shaders pré-compilados** no loading (`compileAsync`) para evitar engasgos.

## Bundle e cache
- Inicial: `index.html` 2,2 KB + JS 4,5 KB + CSS 4,7 KB (gzip ≈ 5 KB). A tela inicial aparece na hora.
- Motor: `three` 512 KB (131 KB gz) e `Game` 207 KB (88 KB gz), pré-buscados em segundo plano e importados ao clicar.
- Mundo: 70 chunks, 3,15 MB JSON (~740 KB gz), baixados em paralelo por distância.
- Nomes com hash (`assets/*-[hash].js`, `world/chunk_*.<hash>.json`) → `Cache-Control: immutable` de 1 ano.
  `manifest.json` e `index.html` → `must-revalidate`. Arquivo `public/_headers` (Netlify/Cloudflare Pages).

nginx equivalente:
```nginx
location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; }
location ~ ^/world/chunk_ { add_header Cache-Control "public, max-age=31536000, immutable"; }
location = /world/manifest.json { add_header Cache-Control "public, max-age=0, must-revalidate"; }
gzip_types application/json application/javascript text/css;  # ou brotli
```
CDN: basta apontar a origem para `dist/`; o `BASE_URL` do Vite permite servir os assets de outro host.

## Compressão (avaliação)
- **Chunks em JSON + gzip/brotli** no MVP: decodificação nativa e rápida (JSON.parse ~1 ms/chunk); a
  geometria é extrudada no cliente (< 10 ms/chunk). Draco/Meshopt não compensam aqui, porque os chunks
  guardam footprints (2D), não malhas.
- **GLB + Meshopt** fica para os modelos artísticos dos landmarks (quando vierem do Blender) e para personagens.
- **KTX2/Basis** fica para texturas fotográficas futuras. Hoje as texturas são geradas em runtime (~0,5–1 s no loading).
- UI: sem imagens; ícone SVG inline.

## Próximas otimizações
1. Gerar as texturas num Web Worker (OffscreenCanvas), tirando ~0,5 s da thread principal.
2. Construir as malhas dos chunks em Worker (transferable buffers).
3. Occlusion queries por chunk no ALTO.
4. `BatchedMesh` para prédios + LOD por edifício (hoje o LOD é por chunk).
5. Medir em Intel Iris/UHD e em iPhone/Android reais e calibrar a detecção automática.
