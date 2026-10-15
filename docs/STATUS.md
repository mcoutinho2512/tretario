# STATUS — MVP Presidente Vargas 3D

_Atualizado em 2026-10-15._

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
- **Testes**: 24 automatizados (projeção, sol, presets, colisão/movimento, orientação das paredes,
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
- **Avatar** placeholder (primitivas). Trocar por personagem rigado em GLB.
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
