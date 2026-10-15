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
