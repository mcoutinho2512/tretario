# Multidões (rodada 6): servidor e cliente preparados para a manifestação

O caso real do jogo é **muita gente junta**: centenas de jogadores a menos de 60 m uns dos outros na Pres. Vargas.
Esta rodada torna esse caso barato dos dois lados, sem mudar o modelo de autoridade nem a interpolação.

Resumo (Apple M5 Pro, servidor e bots na mesma máquina, Chrome headless com GPU via Metal):

| | Antes | Depois |
|---|---|---|
| Servidor, 500 bots densos | event loop 65 % ocupado, patches 25,7 ms (a 20 Hz), 77 KB/s por cliente | event loop **33 %**, patches 7,6 ms, **18,8 KB/s** por cliente |
| Cliente ALTO no meio de 500 | **6 FPS**, 9 193 draw calls, 22,5 M triângulos, CPU 120 ms/quadro | **~90 FPS** sem vsync, **~1 420 draw calls (constante em N)**, 5,0 M tri, CPU 10,5 ms |

## 1. Servidor: grade espacial, limite de detalhados e multidão distante

Arquivos: `src/net/spatialGrid.ts`, `src/net/crowdCodec.ts` (puros, testados em `tests/spatialGrid.test.ts`),
`server/src/PresidenteVargasRoom.ts`.

```
tick 10 Hz ──► grade espacial (células de 110 m, slots inteiros, O(N))
              ├─ AOI fatiada: metade dos clientes por tick (cada um a 5 Hz)
              │    candidatos ≤ 253 m na grade → regra antiga (entra ≤ 220 m, sai > 253 m)
              │    → os 48 mais próximos (quickselect) ficam na StateView (estado completo, patches a 20 Hz)
              │    → o resto vira "overflow"
              ├─ multidão distante fatiada: 1/5 dos clientes por tick (cada um a 2 Hz)
              │    tabela por slot (11 B por jogador, codificado UMA vez) → cópia de bytes por cliente → "crowd"
              └─ impacto de veículo: candidatos pela grade (trajeto do tick + 6 m), não todos os jogadores
```

- **Comportamento idêntico** sem limite: os testes rodam a versão rápida (`selectInterestSlots`), a de referência
  (`selectInterest`) e o algoritmo antigo todos-contra-todos, passo a passo com movimento, e exigem o mesmo resultado.
- **Limite com prioridade**: `PV_AOI_MAX` (48). Quem já está na vista conta a distância × 0,85 (sem troca constante
  na borda). O cliente pode pedir menos no join (`aoiMax`): BAIXO 16, MÉDIO 32, ALTO/ULTRA 48.
- **Menor frequência para os distantes**: os que ficam fora do limite chegam a 2 Hz (`PV_CROWD_HZ`) pela mensagem
  binária `crowd` (11 B: nid, x/y/z em dm, rumo 8 bits, velocidade, corpo/status/veículo; +12 B de aparência só na
  primeira vez para cada cliente). Até 600 por mensagem (`PV_CROWD_MAX`). `NetPlayer.nid` (u16) liga as duas vias.
- Entrada de jogador recalcula só a vista dele (antes: todos). `maxClients` = 600 (`PV_MAX_CLIENTS`).
- Métricas novas em `GET /metrics`: `cpuPct` (processo, % de 1 núcleo), `elu` (utilização do event loop),
  `patchAvgMs/MaxMs` (codificação+envio da StateView), `aoiAvgMs`, `crowdAvgMs`, `rssPeakMB`.

### Testes de carga (`cd server && npx tsx tools/loadtest.ts 20`)
Bots reais do SDK (decodificam o estado como um cliente), em processos de até 100, andando como multidão:
0,5–1,4 m/s, paradas de 1–6 s, variações de rumo, voltando à concentração. **Denso** = elipse 60 × 20 m no eixo da
avenida; **espalhado** = 2 km de avenida. Janela de 20 s medida depois que todos entraram. Simulação a 10 Hz
(orçamento de 100 ms por tick); patches a 20 Hz. Dados: `docs/screenshots/loadtest_final.json`.

| Bots | Cenário | Tick médio / máx (ms) | AOI (ms/tick) | Multidão (ms/tick) | Patch médio / máx (ms) | CPU (% 1 núcleo) | Event loop | RSS pico | Saída total | Por cliente (recebe) | Visíveis (detalhados) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | denso | 0,9 / 2,2 | 0,15 | 0,17 | 0,5 / 1,9 | 5 % | 3 % | 169 MB | 0,4 MB/s | 8,2 KB/s | 50 (49) |
| 100 | denso | 1,7 / 3,8 | 0,43 | 0,42 | 1,3 / 4,9 | 8 % | 7 % | 143 MB | 0,9 MB/s | 9,4 KB/s | 100 (49) |
| 250 | denso | 3,9 / 13,9 | 1,35 | 1,21 | 3,4 / 6,8 | 19 % | 16 % | 151 MB | 3,2 MB/s | 13,2 KB/s | 250 (49) |
| **500** | **denso** | **9,5 / 19,5** | 3,8 | 3,5 | **7,6 / 13,8** | **35 %** | **33 %** | 308 MB | 9,2 MB/s | **18,8 KB/s** | 500 (49) |
| 50 | espalhado | 0,8 / 2,7 | 0,13 | 0 | 0,5 / 1,7 | 4 % | 3 % | 159 MB | 0,2 MB/s | 3,3 KB/s | 12 |
| 100 | espalhado | 1,0 / 2,8 | 0,22 | 0 | 0,9 / 2,2 | 6 % | 5 % | 146 MB | 0,5 MB/s | 4,9 KB/s | 23 |
| 250 | espalhado | 2,6 / 10,8 | 0,68 | 0,51 | 3,0 / 4,9 | 16 % | 14 % | 148 MB | 2,0 MB/s | 8,4 KB/s | 58 (43) |
| 500 | espalhado | 7,0 / 17,3 | 2,18 | 1,98 | 8,9 / 15,9 | 37 % | 36 % | 220 MB | 5,2 MB/s | 10,6 KB/s | 116 (49) |

Antes (todos-contra-todos, sem limite; `loadtest_baseline.json`):

| Bots | Cenário | Tick médio / máx | Patch médio / máx | CPU | Event loop | Saída total | Por cliente |
|---|---|---|---|---|---|---|---|
| 250 | denso | 2,7 / 11,2 ms | 5,9 / 11,6 ms | 26 % | 20 % | 9,2 MB/s | 37,7 KB/s |
| 500 | denso | 6,8 / 24,6 ms | **25,7 / 41,5 ms** | 73 % | **65 %** | **37,7 MB/s** | **77 KB/s** |
| 500 | espalhado | 6,3 / 22,2 ms | 8,6 / 13,9 ms | 36 % | 31 % | 9,5 MB/s | 19,4 KB/s |

(Observação: antes, o tick parecia barato porque o custo da multidão estava todo no patch: cada cliente recebia
o estado completo dos 500. A primeira versão da grade, com objetos e ordenação completa, custava 42 ms por AOI no
caso denso; a versão por slots com quickselect custa ~6 ms para os 500 clientes — `tools/aoibench.ts`.)

**Limite de detalhados × banda** (500 densos, `loadtest_cap*.json`):

| `PV_AOI_MAX` | Por cliente | Saída total | Patch médio | Event loop |
|---|---|---|---|---|
| 16 | 14,3 KB/s | 7,0 MB/s | 5,4 ms | 28 % |
| 32 | 16,7 KB/s | 8,1 MB/s | 6,1 ms | 29 % |
| 48 (padrão) | 18,8 KB/s | 9,2 MB/s | 7,6 ms | 33 % |
| 64 | 20,8 KB/s | 10,2 MB/s | 10,3 ms | 44 % |

A partir de ~16 detalhados, o que domina a banda é a multidão distante (≈ 450 × 11 B × 2 Hz ≈ 10 KB/s).

**Onde quebra** (`loadtest_limite.json`, `PV_MAX_CLIENTS=1200`): 750 densos → event loop 64 %, tick 18,8 / 33,9 ms,
patch 16,4 ms (ainda funciona, sem folga para picos); **1000 densos → event loop 82–95 %**, patch 23–32 ms, tick
26–41 ms: saturado (numa rodada anterior, 95 %). A multidão distante está limitada a 600 por mensagem.
Conclusão: **500 confortável (1/3 do event loop), ~750 é o teto prático de UMA sala num núcleo**; acima disso,
sharding (salas por trecho) ou `PV_AOI_MAX`/`PV_CROWD_HZ` menores. Os bots rodam na mesma máquina e disputam CPU.

## 2. Cliente: orçamento único de humanos e multidão instanciada

Arquivos: `src/characters/crowd/crowdBudget.ts` (puro, `tests/crowdBudget.test.ts`), `CrowdDirector.ts`,
`CrowdRenderer.ts`; integração em `src/net/NetworkClient.ts`, `src/npc/PedestrianSystem.ts`, `src/player/AvatarVisual.ts`.

```
remotos detalhados (StateView, ≤ 48) ─┐
multidão distante ("crowd", 2 Hz)    ─┼─► CrowdDirector.submit(agente)  ──►  end(câmera):
pedestres NPC                        ─┘    (cada sistema aplica o tier         distância + frustum por esfera
                                            do quadro anterior)               assignTiers (orçamento do preset)
                                                                               CrowdRenderer.draw (instanciados)
```

| Faixa | Representação | Custo |
|---|---|---|
| 0–20 m | esqueleto próprio, LOD0 (≤ N₀ por preset) ou LOD1 | AnimationMixer, animação todo quadro (< 12 m) ou a cada 2 |
| 20–60 m | esqueleto LOD1 (< 35 m) / LOD2, só os mais próximos até o limite do preset | animação a cada 2–4 quadros, escalonada por id |
| além do limite ou > 60 m | **instanciado LOD2** (~2,5 k tri, perto) ou **LOD3** (~600 tri) com animação assada | zero CPU por personagem; ≤ 8 draw calls no total |
| além do teto total | não desenhado (os mais distantes / fora de vista saem primeiro) | — |

| Preset | Esqueletos | LOD0 máx. | LOD mais detalhado | Esqueleto até | Teto total | Instanciado LOD2 até |
|---|---|---|---|---|---|---|
| BAIXO | 8 | 0 (LOD1: 2, < 10 m — rodada 9.1) | LOD1 | 35 m | 200 | 10 m (rodada 9.1; antes só LOD3) |
| MÉDIO | 16 | 2 | LOD1 | 50 m | 350 | 30 m |
| ALTO | 24 | 6 | LOD0 | 60 m | 600 | 45 m |
| ULTRA | 32 | 10 | LOD0 | 80 m | 800 | 60 m |

- **Animação assada (VAT)**: na carga, o esqueleto de cada corpo toca idle (8 quadros), walk (16) e jog (12) e a
  posição *skinned* de cada vértice das malhas únicas LOD2/LOD3 é gravada numa textura half float (1024 de largura,
  ~1,2 MB por corpo no LOD2). O vertex shader lê por `gl_VertexID` e interpola entre quadros; a cadência segue a
  velocidade (mesma velocidade natural medida pelo HumanAnimator → sem patinar). Por instância: matriz, quadro
  A/B/mistura e 4 cores (pele, cabelo, camisa, calça) como multiplicadores da cor de vértice. Normais de repouso.
  O assado roda uma vez, assíncrono, depois do carregamento (tempo em `renderer.stats.bakeMs`); até lá só os esqueletos aparecem.
- **Ações sociais na multidão instanciada (rodada 7)**: os `crowdClip` de `src/social/actions.ts` (aceno, palmas,
  braço(s) erguido(s), 4 danças procedurais + dança da biblioteca) também são assados, com menos quadros
  (`CROWD_ACTION_FRAMES`: gestos 4–10, danças 12 no LOD2 / 8 no LOD3). Parado com `CrowdAgent.act` → clipe da ação,
  fase = `now − actAt` (+ deslocamento por agente nos loops), entrada/saída misturando o quadro do idle; andando →
  locomoção. Mesma `InstancedMesh` por corpo/LOD: nenhuma draw call a mais. Quadros gravados contíguos
  (quadro × V + vértice, sem sobra de linha) e cópia da CPU liberada após o envio. Memória das texturas: antes
  (3 ciclos) 7,3 MiB na GPU + 7,3 MiB na CPU; agora 19,0 MiB na GPU (LOD2 15,5 + LOD3 3,5) e 0 na CPU; preset BAIXO
  (só LOD3): 2,0 + 2,0 → 3,5 + 0 MiB. Ver `docs/EMOTES.md`.
- **Disputa única**: quem já tem esqueleto ganha vantagem (× 0,85); fora de vista perde (× 4), exceto a < 6 m;
  caído/em veículo tem prioridade (× 0,5). O instanciado continua desenhando enquanto o esqueleto carrega.
- **Esqueletos em pool por corpo** (NetworkClient): ninguém cria `HumanCharacter` para os 500 — só quando o
  orçamento concede; ao sair, volta ao pool (`AvatarVisual.resetForReuse`). Queda de remoto ganha esqueleto na hora.
- **NPCs cedem lugar**: pedestres ativos = mín(preset, máx(4, teto − humanos da rede)). Total limitado pelo preset.
- Rótulos de nome só nos que têm esqueleto (antes: 500 elementos DOM).
- O adiamento do LOD0 nos primeiros 6 s (master) vale também para o orçamento (`CrowdDirector.detailFloor`).
- QA: `?crowd=0` desliga o orçamento (comparação); `?crowdSkinned=N&crowdTotal=N` sobrescrevem o preset.

### Bancada (`node tools/qa/crowd_bench.mjs http://localhost:5192`)
Jogador no centro da concentração densa, câmera em 3ª pessoa olhando ao longo da avenida, 1280×720, **sem vsync**
(o número é folga, não o FPS de tela), 16:30 com sombras. Médias de 16 amostras após 7 s.
Dados: `docs/screenshots/crowd_bench.json` (depois do merge com o master: governador de quadros, LOD adiado).

| Bots | Preset | FPS | CPU (ms) | GPU (ms) | Draw calls | Triângulos | Heap | Detalhados (rede) | Distantes (rede) | Esqueletos | Instanciados desenhados |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | BAIXO | 478 | 1,9 | 1,7 | 284 | 0,51 M | 431 MB | 16 | 34 | 8 | 17 |
| 50 | MÉDIO | 250 | 3,7 | 2,4 | 557 | 1,35 M | 453 MB | 32 | 18 | 16 | 15 |
| 50 | ALTO | 111 | 8,4 | 6,3 | 1 265 | 3,8 M | 529 MB | 48 | 1 | 24 | 11 |
| 100 | BAIXO | 466 | 1,9 | 1,6 | 285 | 0,53 M | 453 MB | 16 | 84 | 8 | 46 |
| 100 | MÉDIO | 244 | 3,8 | 2,5 | 554 | 1,39 M | 480 MB | 32 | 68 | 16 | 40 |
| 100 | ALTO | 98 | 9,7 | 6,6 | 1 432 | 4,3 M | 533 MB | 48 | 52 | 24 | 38 |
| 250 | BAIXO | 462 | 1,9 | 1,6 | 286 | 0,58 M | 344 MB | 16 | 234 | 8 | 120 |
| 250 | MÉDIO | 232 | 4,0 | 2,6 | 563 | 1,50 M | 481 MB | 32 | 218 | 16 | 111 |
| 250 | ALTO | 94 | 10,1 | 6,3 | 1 426 | 4,5 M | 429 MB | 48 | 201 | 24 | 107 |
| 500 | BAIXO | 387 | 2,3 | 1,7 | 287 | 0,62 M | 469 MB | 16 | 484 | 8 | 162 |
| 500 | MÉDIO | 213 | 4,5 | 2,7 | 567 | 1,72 M | 508 MB | 32 | 468 | 16 | 227 |
| **500** | **ALTO** | **90** | 10,5 | 6,5 | **1 422** | 5,0 M | 488 MB | 48 | 452 | 24 | 242 |

Draw calls ficam **constantes de 50 a 500** (a multidão instanciada custa ≤ 8). No ALTO, ~600 dos ~1 400 draw
calls são os 24 esqueletos (LOD0/LOD1 têm 9–13 camadas, mais o passe de sombra); o resto é o cenário.
Com tudo instanciado (`crowdSkinned=0`, 100 bots, ALTO): 765 draw calls, CPU 5,6 ms.

Antes / sem o orçamento (ALTO, `crowd_bench_antes.json` e `crowd_bench_sem_orcamento.json`):

| Configuração | 250 bots | 500 bots |
|---|---|---|
| Antes: servidor sem limite + todo remoto com esqueleto | 17,7 FPS · 4 927 calls · 12,3 M tri · CPU 56 ms · pior quadro 2,0 s | **6,1 FPS** · 9 193 calls · 22,5 M tri · CPU 120 ms · pior quadro 2,8 s |
| Só o limite do servidor (48), cliente sem orçamento (`crowd=0`) | 63 FPS · 2 007 calls · CPU 15,4 ms | 60 FPS · 2 000 calls · CPU 16,4 ms (e os 450 distantes não aparecem) |
| Depois (limite + orçamento + instanciados) | 94 FPS · 1 426 calls · CPU 10,1 ms | **90 FPS · 1 422 calls · CPU 10,5 ms** (500 visíveis) |

## Rodada 9.1: personagens de perto

Relato do dono: de perto (2–6 m, junto de um carro de som) os bonecos pareciam LOD distante, "dava para ver através"
e o rabo de cavalo tinha manchas verdes/marrons. Sonda: `node tools/qa/char_probe.mjs <url> low,medium,high,auto
<pasta>` (build de produção, `?mem=1`) — por humano visível: esqueleto ou instanciado, LOD, triângulos, materiais por
camada (transparent/alphaTest/depthWrite/side), recorte da pele (`userData.cull`); resumo com
`tools/qa/char_probe_summary.mjs`. Dados: `docs/screenshots/round9_1/char_probe.json`.

**Causas**
1. A **concentração** (`src/social/RallyCrowd.ts`) era só instanciada (`maxTier: 1`): no ALTO, 12–15 humanos a < 6 m
   da câmera eram LOD2 instanciados (2,5 k tri, normais de repouso); no BAIXO, LOD3 (600 tri) a 2 m. O orçamento de
   esqueletos ficava quase vazio nessa cena (5–7 de 24).
2. **Malhas únicas** (LOD2/LOD3; instanciadas e com esqueleto): o material VAT era de um lado só (cartões de cabelo e
   bordas de roupa vistos por trás sumiam → chão através do personagem); a pele decimada atravessava camisa/calça
   (manchas); o cabelo assado em cor de vértice trazia a cor dos texels transparentes da textura (manchas verdes/marrons).
3. **Fallback LOD3**: o pedestre que entrava no orçamento mostrava o LOD3 com esqueleto até o LOD0 terminar de vestir
   (peças + recorte no Worker), por cima do instanciado.

**Correções**
- RallyCrowd: os mais próximos da câmera (até metade de `budget.skinned`, < 10 m; distância do quadro anterior) recebem
  `maxTier: 2` e disputam o esqueleto como todos; quem ganha usa um `HumanCharacter` de um pool por corpo (reaproveitado,
  ≤ 3 livres por corpo), com ação/item da agenda, reação a golpe (inclinação/cambaleio) e sombra só < 12 m.
  `__pv.rallyCrowd().near` (QA) lista os membros perto do jogador com tier/LOD.
- `garmentShader.patchLookShader({ inflate })`: camisa/calça afastadas pela normal depois do skinning/VAT (presa na
  gola); cabelo pela cor da camada; VAT `DoubleSide`.
- `HumanCharacter.showingDetail` + LOD2 interino: o esqueleto só substitui o instanciado com detalhe compatível.
- Movimento da multidão VAT: transição parado↔andar (0,15–0,55 m/s) e andar↔trote (2,0–2,4 m/s) misturando o quadro
  mais próximo dos dois ciclos; cadência dividida pela escala do agente (sem patinar). NPCs com esqueleto: variação por
  semente (`HumanAnimator.setVariant`), giro limitado (`src/npc/gait.ts`).

**Custo medido** (sem vsync): na concentração, ALTO 167 → 119 FPS a 4 m (CPU 5,7 → 8,3 ms, 569 → ~900 draw calls),
ULTRA 107 → 99 (4 m) e 108 → 75 (15 m). A bancada de bots densos não muda no ALTO/MÉDIO; BAIXO −6 % (LOD1 e VAT LOD2).
Sem teto, a concentração ocupava os 24–32 esqueletos (ALTO 70 FPS, CPU 15 ms) — por isso a metade do orçamento.

## 3. Limites e problemas conhecidos
- **Picos isolados no ALTO**: depois do merge, o pior quadro da janela chegou a 115–140 ms (uma vez por cena),
  provavelmente a liberação do LOD0 aos 6 s (download/parse/compilação de shader dos LOD0 enquanto a bancada mede).
  Antes do merge o pior quadro era 14–22 ms. Vale pré-compilar (`renderer.compileAsync`) os materiais LOD0.
- Instanciados usam **normais de repouso** e não têm ragdoll/empurrão visual nem acessórios (boné, bolsa…);
  quem cai ganha esqueleto se estiver a < 60 m.
- Sem **sombra** na multidão instanciada (só recebe). Os 24 esqueletos do ALTO projetam sombra a < 45 m.
- A multidão distante chega a 2 Hz com 650 ms de atraso; jogadores correndo a > 50 m parecem "atrasados".
- O servidor é um processo/núcleo; 1 sala. Teto prático ~750 na mesma concentração (ver tabela).
- Medido só no M5 Pro (headless, sem vsync). Falta medir em hardware fraco real.

## 4. Recomendações para aparelhos mais fracos
- **BAIXO** já pede 16 detalhados ao servidor (≈ 14 KB/s a 500 densos) e desenha 8 esqueletos LOD2 + até 192
  instanciados LOD3 em 4 draw calls: ~290 draw calls, 0,6 M triângulos, CPU 2,3 ms no M5 — é o perfil para
  notebooks com GPU integrada e celulares.
- Em celular, reduzir ainda: `crowdSkinned=4`, `crowdTotal=120`, multidão a 1 Hz (`PV_CROWD_HZ=1`, servidor) e
  pixel ratio dinâmico (o governador de quadros do master já faz isso).
- Próximo passo de GPU: **impostores** (cartões com atlas de 8 direções) além de ~120 m, para trocar 600 tri por 2;
  hoje o LOD3 instanciado já é barato (500 × 600 = 0,3 M tri).
- Próximo passo de rede: densidade agregada por célula (contagem + direção) para além de 220 m, e sharding.
