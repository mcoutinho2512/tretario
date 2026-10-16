# STATUS — Presidente Vargas 3D

_Atualizado em 2026-10-16 (rodada 5: overhaul visual — de protótipo low-poly para 3D urbano semi-realista)._

## Rodada 5 — antes / depois (mesmas poses, 10:30, HIGH)
| | |
|---|---|
| ![](screenshots/r5_compare/A.jpg) | A — personagem (antes: boneco de primitivas · depois: humano MakeHuman) |
| ![](screenshots/r5_compare/B.jpg) | B — personagem na Presidente Vargas |
| ![](screenshots/r5_compare/C.jpg) | C — Central do Brasil |
| ![](screenshots/r5_compare/D.jpg) | D — avenida |
| ![](screenshots/r5_compare/E.jpg) | E — Palácio Duque de Caxias |
| ![](screenshots/r5_compare/F.jpg) | F — Candelária |
| ![](screenshots/r5_compare/G.jpg) | G — veículos e pedestres |

Noite (21:30): `screenshots/r5_after/noite/` · LOW: `screenshots/r5_after/low/` · detalhes por área:
[CHARACTERS.md](CHARACTERS.md), [VEHICLES_VISUAL.md](VEHICLES_VISUAL.md), [VEGETATION.md](VEGETATION.md),
[LANDMARKS.md](LANDMARKS.md), [BUILDINGS_LIGHTING.md](BUILDINGS_LIGHTING.md).

### O que mudou
- **Personagens**: boneco de primitivas removido (fica só como reserva invisível). Humanos MakeHuman (CC0/CC-BY) com rosto,
  olhos, sobrancelhas, cílios, cabelo, camiseta/jeans/tênis como **camadas separadas** sobre um esqueleto de 53 ossos;
  4 corpos; LOD0 32–37 k triângulos, LOD1 ~12 k, LOD2 2,5 k (1 draw call), LOD3 600; animação de captura (Quaternius,
  CC0) retargetada; Idle↔Walk↔Jog↔Sprint com crossfade e passada casada com a velocidade; ragdoll no novo esqueleto.
  Masculino reforçado a pedido (músculo, ombros, gola careca).
- **Veículos**: sedã, hatch, SUV, táxi carioca e ônibus modelados (Blender procedural), vidros, faróis, rodas/pneus, 2 LODs,
  1 draw call por modelo/LOD.
- **Vegetação**: árvores ez-tree (MIT) com mistura de espécies do censo do Centro (oiti predominante, amendoeira, cássia,
  ficus, munguba, ipê, palmeira), 3 LODs (malha, simplificada, impostor), BatchedMesh.
- **Mobiliário**: postes de braço duplo, semáforos, abrigos, bancos, lixeiras Comlurb, bancas, balizadores refeitos.
- **Landmarks**: Central (torre de 110 m + antenas, relógio de 10 m, alas), Candelária (massa conforme OSM, fachada em
  duas ordens, torres, cúpula 62,3 m), Palácio Duque de Caxias (torre recentralizada — estava 28 m deslocada; granito
  cinza-rosado; ritmo art déco), **CCBB** dedicado. Texturas CC0 Poly Haven.
- **Prédios comuns**: fachadas por prédio (reboco, concreto, pedra, pastilhas, pele de vidro, azulejo), janelas variadas com
  recesso (paralaxe), aparelhos de ar, brises, térreos comerciais com letreiros genéricos, parapeitos, marquises, caixas d'água.
- **Chão**: rachaduras finas e esparsas, granito no meio-fio, pedra portuguesa, sinalização com medidas do manual brasileiro.
- **Luz/céu**: céu próprio (azul saturado, horizonte úmido, cúmulos), IBL com silhueta de cidade, neblina na cor do
  horizonte; data/hora reais preservadas.

### Métricas (M5 Pro, Chrome headless 1280×720, multiplayer com 10 bots, `tools/qa/bench_presets.mjs`; todos a 60 FPS)
| Preset | CPU ms (r4 → r5) | GPU ms (r4 → r5) | Draw calls | Triângulos | Heap JS |
|---|---|---|---|---|---|
| LOW | 1,5 → 1,9–2,3 | 2,9–3,2 → 3,3–4,4 | 131–346 | 269–566 k | 245–333 MB |
| MEDIUM | 1,7–1,9 → 2,8–2,9 | 3,3–4,3 → 4,4–4,6 | 220–469 | 567–921 k | 282–309 MB |
| HIGH | 3,0–3,3 → 5,1–5,4 | 11–13 → 9,1–11,9 | 617–1032 | 1,87–2,75 M | 429–485 MB |
| ULTRA | 3,1–4,4 → 6,1–6,9 | 10–12 → 9,2–11,2 | 633–1135 | 1,94–2,87 M | 442–461 MB |

Custo isolado dos 56 NPCs humanos (alternando 0↔56 na mesma sessão): +0,15 ms CPU, +43 draw calls, +57 k triângulos.
Download novo: personagens 8,9 MB no total (inicial ~2,5 MB: animações + LOD0 do próprio avatar + LOD3 dos 4 corpos; resto
em segundo plano), veículos 0,42 MB, vegetação 0,48 MB, texturas de landmarks 0,47 MB; código +40 KB gzip.

### Validação
- 71 testes automatizados; build de produção OK; walkthrough multiplayer com 3 clientes **28/28** (inclui empurrão,
  ragdoll no esqueleto novo, levantar, impacto, carro, colisão no servidor, acessório sincronizado).

### Teste crítico (respostas honestas)
1. **O personagem ainda parece feito de primitivas?** Não. É uma malha humana com anatomia, rosto e roupas separadas.
   Ainda sem animação facial; cabelos em "cards" com borda serrilhada de perto.
2. **A cena ainda parece low-poly/Roblox?** Em grande parte não (árvores, carros, céu, personagens, landmarks). Ainda
   abaixo de um jogo comercial: prédios comuns são volumes de caixa com fachada em shader (sem varandas reais), traseira
   do ônibus simples, folhas de espécies temperadas recoloridas.
3. **Quem conhece o Centro reconheceria a Presidente Vargas?** Pela Central (torre do relógio) e pela Candelária ao fundo
   do eixo da avenida, com canteiros e pistas largas, provavelmente sim. Os prédios da avenida ainda não são os prédios
   reais um a um (estilo atribuído por semente, OSM sem material/cor).

### Riscos
- **Heap JS dobrou** (≈150–250 → 245–485 MB): principal risco para celular. Precisa de perfil de memória (texturas
  retidas, geração de vegetação, cópias de geometria) antes de testar em aparelho real.
- CPU no HIGH/ULTRA subiu ~2 ms (animação de remotos/NPCs, vegetação, ajuste por LOD).
- Personagens: 8,9 MB de GLBs; KTX2/Basis para texturas reduziria memória de GPU (não feito).
- Safari/iPhone/Firefox/Windows continuam **não testados**.

_Atualizado em 2026-10-16 (rodada 4: vertical slice multiplayer jogável — somente local, sem deploy)._

## Tela inicial — montagem do personagem
| | |
|---|---|
| ![](screenshots/tela_inicial.jpg) | ![](screenshots/tela_inicial_mobile.jpg) |
| Prévia 3D (o mesmo personagem do jogo), poses e painel de visual | Celular: empilhado, botão de entrar sempre visível |

- Prévia 3D com arrastar para girar, botões ↶ ↷ e poses **Parado / Andando / Acenando / Dançando** (`src/ui/AvatarPreview.ts`).
- Cartões com **retratos renderizados** dos 4 personagens, atualizados com as cores escolhidas.
- Nome, tom de pele, cabelo, camisa, calça/saia, calçado, acessório e cor do acessório; botão "Aleatório".
  Tudo salvo no navegador e enviado ao servidor (o **acessório agora também é sincronizado** no multiplayer).
- Qualidade gráfica e controles em menus no topo. Fundo: render da própria avenida (`public/ui/start-bg.jpg`, 187 KB).
- Custo: JS inicial 5,1 KB gzip (antes 2,8 KB); a prévia usa o three.js já pré-buscado para o jogo e é descartada ao entrar.
- Sem login, sem times políticos e sem itens pagos (decisões do produto e ADR-008).

## Rodada 4 — vertical slice multiplayer
| | |
|---|---|
| ![](screenshots/vertical_slice/01_tres_jogadores.jpg) | ![](screenshots/vertical_slice/02_A_dirigindo.jpg) |
| A, B e C na mesma sala (avatares sincronizados) | A dirigindo o car0; B vê o carro onde ele está |
| ![](screenshots/vertical_slice/03_B_caida_ragdoll.jpg) | ![](screenshots/vertical_slice/04_impacto_veiculo.jpg) |
| Empurrão validado pelo servidor → ragdoll (Rapier) | Impacto de veículo (sem dano, sem conteúdo gráfico) |
| ![](screenshots/vertical_slice/palacio_duque_caxias.jpg) | GIFs: [dirigindo](screenshots/vertical_slice/dirigindo.gif) · [empurrão](screenshots/vertical_slice/empurrao.gif) · [impacto](screenshots/vertical_slice/impacto.gif) |
| Palácio Duque de Caxias dedicado (bloco + embasamento + torre ~82 m) | |

- **Servidor autoritativo com colisão**: a mesma geometria de paredes (`src/physics/walls.ts`, 64.604 segmentos,
  `collision.<hash>.bin`) é usada no cliente e no servidor; o caminho proposto é validado contra prédios, muros e limites.
- **Mundo compartilhado** ([SHARED_WORLD.md](SHARED_WORLD.md)): relógio global (NTP simplificado), semáforos como função
  do relógio (135/135 iguais), trânsito simulado no servidor (`TrafficSim` puro) e enviado em snapshots de 12 B/veículo.
- **Carro dirigível** (E entra/sai, W/S acelera/freia/ré): posse validada no servidor; dois jogadores não ocupam o mesmo carro.
- **Empurrar / impacto de veículo** validados no servidor (distância, ângulo, linha livre, cooldown, limite de taxa, modo,
  estado, imunidade de 5 s); **pacífico é o padrão**; queda com ragdoll Rapier e levantar.
- **Netcode** ([NETCODE.md](NETCODE.md)): predição, reconciliação por `seq`, interpolação adaptativa, AOI com `StateView`,
  movimento compacto, simulador de latência/jitter/perda.
- **Walkthrough com 3 clientes**: `node tools/qa/walkthrough.mjs` → **27/27** a 0 ms e **27/27** a 150 ms ± 30 ms.
- **Testes**: 65 automatizados (Vitest); o hook de pre-commit verifica exatamente o conteúdo staged.

### Métricas da rodada 4 (M5 Pro, Chrome headless 1280×720, com vsync, 10 bots, `tools/qa/bench_presets.mjs`)
| Preset | CPU (ms) | GPU (ms) | Draw calls | Triângulos | Heap JS |
|---|---|---|---|---|---|
| LOW | 1,5–1,6 | 2,9–3,2 | 117–341 | 243–379 k | 148–174 MB |
| MEDIUM | 1,7–1,9 | 3,3–4,3 | 195–474 | 548–755 k | 175–190 MB |
| HIGH | 3,0–3,3 | 11,1–13,1 | 467–1029 | 1,61–1,89 M | 246–250 MB |
| ULTRA | 3,1–4,4 | 10,3–12,0 | 540–1149 | 1,98–2,28 M | 241–254 MB |

Rede por jogador (detalhes em [PERFORMANCE.md](PERFORMANCE.md)): ~1,8–4,8 KB/s recebidos e ~0,67 KB/s enviados.

## Rodada 3 — antes / depois
| Antes | Depois |
|---|---|
| ![](screenshots/antes/ccbb.jpg) | ![](screenshots/depois/ccbb.jpg) |
| CCBB: sobrado genérico de 9 m | CCBB: bloco eclético de 31 m (override com fonte) |
| ![](screenshots/antes/central.jpg) | ![](screenshots/depois/central.jpg) |
| Central vista da avenida | Panteão de Caxias em granito + estátua equestre |

| Novidades | |
|---|---|
| ![](screenshots/depois/galeria.jpg) | ![](screenshots/depois/galeria_dentro.jpg) |
| Galerias reais dos prédios PA | Caminhando sob a colunata |
| ![](screenshots/depois/travessia.jpg) | ![](screenshots/depois/evento_classico.jpg) |
| Semáforos funcionais + travessia | Evento "clássico" genérico: banners e painel de LED |
| ![](screenshots/depois/bicicleta.jpg) | ![](screenshots/depois/multiplayer.jpg) |
| Bicicleta de estação real | Multiplayer local: B vê o Jogador_A |

### Métricas (Apple M5 Pro, Chrome 155, 1920×1080, 16:30, sem vsync; com vsync todos ficam em 60 FPS)
| Preset | Frame (ms) | Draw calls | Triângulos | Pedestres | Veículos |
|---|---|---|---|---|---|
| LOW | 1,8–2,0 | 152–318 | 171–276 k | 14 | 24 |
| MEDIUM | 2,0–2,3 | 251–447 | 454–543 k | 32 | 48 |
| HIGH | 4,4–4,9 | 560–944 | 1,22–1,43 M | 56 | 80 |
| ULTRA | 4,6–4,8 | 594–1072 | 1,51–1,93 M | 90 | 110 |
| Mobile (emulação iPhone 14) | 60 FPS | 130 | 144 k | 12 | 20 |

Cidade viva medida em 60 s num cruzamento (HIGH): até **24 pedestres atravessando** ao mesmo tempo e até **32 veículos parados
no vermelho**. 135 cruzamentos semaforizados, 791 linhas de retenção.

**Testes:** 46 automatizados (Vitest), build de produção OK, `npm audit` 0 vulnerabilidades (cliente e servidor),
QA e2e multiplayer com 2 navegadores (`tools/qa/multiplayer.mjs`).

## Histórico (rodadas 1–2)

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

## Novidades (Fase 1 — vida na avenida)
| | |
|---|---|
| ![](screenshots/transito.jpg) | ![](screenshots/pedestres.jpg) |
| Trânsito nas faixas reais da Pres. Vargas | Pedestres NPC nas calçadas |

- **Personagens com esqueleto real** (SkinnedMesh, 17 ossos, 1 draw call): **homem, mulher, idoso, idosa**,
  com tons de pele, cabelo e roupas variados. Idosos andam mais devagar e com postura curvada. Escolha na tela inicial (`?avatar=`).
- **Pedestres NPC**: 14 / 32 / 56 (BAIXO/MÉDIO/ALTO) ao redor do jogador. Andam só por calçadas, praças e canteiros, desviam
  de prédios, uns dos outros e do jogador, e param às vezes. Têm LOD de animação e de sombra.
- **Trânsito**: 24 / 48 / 80 veículos (carros, **táxis amarelos com faixa azul**, ônibus) nas **884 faixas geradas do OSM**
  (269 na Pres. Vargas), no sentido real e com mão direita (testado). Seguem o veículo da frente, **param para o jogador**, acendem os faróis à noite.
  O jogador não atravessa os veículos.
- Custo medido (M5 Pro, sem vsync): +0,1 a 0,3 ms por frame. Ainda não há semáforos com ciclo: os veículos não param no vermelho (passo 1.5).

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
- **Testes**: 27 automatizados (incluindo faixas de tráfego e mão direita) (projeção, sol, presets, colisão/movimento, orientação das paredes,
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
- **Personagens** procedurais estilizados (sem rosto detalhado/roupas com textura). Trocar por GLB rigado com o mesmo esqueleto.
- Cada personagem usa uma textura de ossos: com 56 pedestres, o total de texturas sobe de ~43 para ~100 (sem impacto medido).
- Veículos não respeitam semáforos nem trocam de faixa; pedestres não atravessam na faixa (ainda).
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
