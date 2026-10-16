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

Detecção automática: dispositivo de toque vira BAIXO; GPU por `WEBGL_debug_renderer_info`
(Apple M, RTX, RX 6/7 → ALTO; Intel HD/UHD, Mali, Adreno → MÉDIO ou BAIXO); software renderer vira BAIXO.

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
