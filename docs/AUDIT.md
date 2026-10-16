# Auditoria do repositório — 2026-10-15

Estado do projeto no commit `7cbcc2c`, antes da fase multiplayer/jogo.

## Tecnologias
| Camada | Tecnologia | Observação |
|---|---|---|
| Linguagem | TypeScript 5.6 (strict) | ~6.300 linhas em `src/`, `tools/`, `tests/` |
| Build/dev | Vite 7.3.7 | bundle inicial ~9 KB; motor carregado sob demanda |
| Renderização | three.js 0.170, WebGL2 | ACES, PBR, sombras, GTAO/SMAA no ALTO |
| Dados | OpenStreetMap (ODbL) via Overpass | pipeline Node/tsx + clipper-lib |
| Testes | Vitest 4.1 (24 testes) + QA com puppeteer-core 25 | `npm audit`: 0 vulnerabilidades |
| Servidor | **não existe** | só o cliente estático |

## Estrutura
```
src/core        Game (orquestração, loop, loading), settings (presets)
src/geo         projeção WGS84→ENU (1 u = 1 m), sol (NOAA), região/bbox
src/world       tipos, ChunkManager (streaming + LOD), builders (chão, prédios, props), landmarks
src/renderer    WebGL2, ambiente (céu, sol real, nuvens, IBL, noite), materiais, texturas procedurais
src/player      PlayerState (dado), PlayerController (física), AvatarVisual (placeholder de primitivas)
src/physics     CollisionWorld (segmentos 2D + mapa de alturas)
src/camera      3ª pessoa; src/input teclado/mouse/toque; src/ui; src/debug (F3, minimapa)
tools/          fetch_map_data → process_osm → build_world; qa/ (screenshots, mobile, pick, probe)
public/world    70 chunks JSON com hash (3,2 MB / ~740 KB gzip) + manifest
docs/           arquitetura, fontes, licenças, pipeline, performance, multidões, validação, status
```

## Como o cenário da Presidente Vargas é feito
1. **Geometria real** do OSM: 68 trechos da avenida (pistas centrais 4 faixas/sentido, laterais 3–4), 896 ruas, 8.282 prédios.
2. **Superfícies** por booleana (asfalto = união dos buffers das pistas; canteiros e calçadas = o restante), meio-fio de 15 cm.
3. **Prédios** extrudados do footprint real; **altura real em 97 %** (dado da Prefeitura importado no OSM). Fachadas
   **procedurais** (shader com 5 estilos), sem correspondência individual.
4. **Landmarks dedicados**: Central do Brasil e Candelária (procedurais, com proporções de fontes publicadas).
5. **Mobiliário**: árvores (858, OSM), postes (301; 157 procedurais), semáforos (435), bancos, abrigos, bancas.

### Fidelidade na frente da avenida (prédios a < 70 m do eixo)
- 130 prédios: 114 com altura real, 1 por nº de andares, **15 estimados**.
- 52 com galeria no térreo (**inferida por regra**, não mapeada).
- Só 12 têm nome no OSM (Banco Central, Ed. Paulo de Frontin, Embratel, Transpetro, Biblioteca Parque…), todos com fachada genérica.

### Entorno da Candelária (nomeados a < 220 m)
| Prédio | Altura no dado | Situação |
|---|---|---|
| Centro Cultural Banco do Brasil | 9 m (**estimativa**) | real tem ~20 m + cúpula. Precisa de modelo dedicado |
| Associação Comercial do RJ | 9 m (**estimativa**) | precisa conferir |
| Centro Cultural Correios | 16,7 m (real) | fachada eclética genérica |
| Igreja N. Sra. Mãe dos Homens | 16 m | igreja genérica |
| Sede da Transpetro / Skylux / CREA-RJ | 77 / 107 / 41 m (reais) | fachada genérica |

## Desempenho atual (Apple M5 Pro, Chrome, 1920×1080)
60 FPS com vsync em todos os presets. Sem vsync: ALTO ~4,2 ms/frame (≤ 816 draw calls, ≤ 1,2 M triângulos);
MÉDIO ~2 ms; BAIXO ~1,6 ms. Jogável em ~1,4 s. **Sem medição** em Windows/GPU integrada nem em iPhone real.

## Limitações encontradas
| # | Limitação | Impacto | Prioridade |
|---|---|---|---|
| L1 | Avatar de primitivas: ~20 malhas por personagem, sem esqueleto | inviável para NPCs/multiplayer (draw calls) e sem base para ragdoll | **alta** (bloqueia NPCs) |
| L2 | Cidade vazia: sem pedestres nem veículos | a Pres. Vargas real nunca está vazia; perde identidade | **alta** |
| L3 | Sem servidor/multiplayer | — | média (após base de entidades) |
| L4 | Fachadas genéricas; marcos do entorno sem modelo | fidelidade | **alta** (contínua) |
| L5 | Terreno plano (morros) | fidelidade de fundo | média |
| L6 | Semáforos estáticos, sem ciclo | necessário para trânsito | média |
| L7 | Texturas e malhas geradas na thread principal | engasgo de ~0,5–1 s no loading | baixa |
| L8 | Não testado em Safari/iPhone/Windows | risco de compatibilidade | **alta** (precisa de você) |
| L9 | `Game.ts` concentra muitas responsabilidades | dificulta crescer | média: introduzir camada de entidades |

## Conclusão
A base (geografia real, coordenadas em metros, chunks, LOD, colisão leve, estado do jogador separado do
visual) está sólida e preparada para crescer. O próximo passo de maior valor, sem quebrar o que funciona,
é um **sistema de personagens com esqueleto** (base de avatares, NPCs, multiplayer e ragdoll) e
**dar vida à avenida** (pedestres e trânsito). Ver [ROADMAP.md](ROADMAP.md).
