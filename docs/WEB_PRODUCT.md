# Rodada 6 — o jogo como produto web

## 1. Aparelho → configuração segura (src/core/device.ts, src/core/frameGovernor.ts)
| Aparelho detectado | Preset automático | FPS alvo | Resolução dinâmica |
|---|---|---|---|
| iPhone | MÉDIO (+ ajuste mobile) | 30 | sim |
| iPad | MÉDIO | 30 | sim |
| Android com GPU recente (Adreno 64x+/7xx, Mali-G7x) e ≥ 6 GB | MÉDIO | 30 | sim |
| Android de entrada | BAIXO | 30 | sim |
| Notebook com GPU integrada Iris Xe / Radeon APU (≥ 8 GB) | MÉDIO | 60 | sim |
| Intel UHD / pouca memória | BAIXO | 60 | sim |
| Mac Apple Silicon (Safari mostra só "Apple GPU") | ALTO | 60 | sim |
| Mac M-Pro/Max, GPU dedicada série 70/80/90 | ULTRA | 60 | sim |
| Renderização por software | BAIXO | 30 | sim |
A tela de qualidade mostra, por exemplo: *"iPhone detectado · preset recomendado: MÉDIO · 30 FPS · resolução dinâmica"*.
Resolução dinâmica: escala 0,55–1 sobre o pixel ratio, pelo intervalo real entre quadros (e tempo de GPU quando o
navegador mede). **Motivo medido:** Safari real no M5 Pro, janela Retina 2x, ALTO fixo = 15–19 FPS; com a escala
dinâmica (0,84–0,92) = 58–60 FPS.

## 2. Navegadores e aparelhos
| Ambiente | Como foi testado | Resultado |
|---|---|---|
| Chrome / Mac M5 Pro | automatizado | ULTRA, 60 FPS (headless 1280×720: 50 FPS com 3 agentes na máquina), 0 erros |
| **Safari real / Mac** | benchmark `?bench=1` aberto no Safari 27 | auto → ALTO, **58,7–60 FPS**, 1 % low 52–56, 0 erros |
| WebKit (motor do Safari, Playwright) | automatizado | funciona, 0 erros (headless lento: FPS não representativo) |
| WebKit emulando iPhone 15 | automatizado | detecta iPhone → MÉDIO 30 FPS, 29,4 FPS, 0 erros (GPU do Mac: **não** mede o iPhone) |
| Firefox | **não testado** | o Firefox do Playwright não inicia sob o sandbox desta sessão; ver "Pendente" |
| **iPhone real** | **pendente (precisa do aparelho)** | |
| **Windows com GPU integrada** | **pendente (precisa do aparelho)** | |

### Teste em aparelho real (sem deploy, rede local)
1. No Mac: `npm run dev` (o Vite já escuta na rede local).
2. No iPhone / notebook / Firefox, na mesma rede: `http://<ip-do-mac>:5173/?bench=1`
3. Espere ~1 min. O resultado aparece na tela e é **gravado automaticamente** em `screenshots/bench_results/` no Mac.
   Se a página recarregar sozinha no meio do teste, foi falta de memória (anotar).
Firefox no Mac: `npx playwright install firefox && node tools/qa/browsers.mjs` num terminal normal (fora do sandbox),
ou abrir a mesma URL de benchmark no Firefox instalado.

## 3. Carregamento (build de produção, servidor que segue `public/_headers`, `tools/qa/load_bench.mjs`)
| Rede | Visita | Home | Mundo visível | Pode andar | MB até jogar | MB após 30 s |
|---|---|---|---|---|---|---|
| localhost | 1ª, sem cache | 0,07 s | 5,7 s | 5,4 s | 5,1 | 7,8 |
| localhost | 2ª, com cache | 0,06 s | 2,4 s | 2,1 s | 0 | 0 |
| 4G (9 Mbps, 85 ms) | 1ª | 0,23 s | 6,2 s | 6,0 s | 3,6 | 5,9 |
| 4G (9 Mbps) | 2ª | 0,11 s | 2,7 s | 2,5 s | 0 | 0 |
| 4G lento (1,6 Mbps, 150 ms) | 1ª | 0,42 s | 20,9 s | 20,7 s | 3,6 | 6,5 |
| 4G lento | 2ª | 0,19 s | 2,9 s | 2,7 s | 0 | 0 |
Antes da rodada (4G lento, 1ª visita): 27,6 s e 5,1 MB antes de jogar. Mudanças: LOD0 do próprio avatar, LODs da
multidão e LOD0 dos NPCs só depois de jogável; retratos da home estáticos (4 KB cada) em vez de 4 personagens 3D.
O mundo completo **não** exige download grande: tudo até jogar = 3,6–5,1 MB; o restante chega em segundo plano.
Cache: código e chunks com hash = imutáveis; modelos/texturas sem hash = 1 dia + revalidação por ETag.
Em localhost a 1ª visita ainda leva ~5 s por trabalho de CPU (geração da vegetação, impostores, texturas procedurais,
compilação de shaders) — próximo alvo de otimização (Web Workers / cache de shaders).

## 4. Memória — ver [MEMORY.md](MEMORY.md)
Heap JS no jogo (HIGH, sem multidão): 320 MB → **140–183 MB**; após GC, 267 → 119 MB. Sem crescimento contínuo
em 5 min de teleportes. 196 MB eram cópias na CPU de dados já na GPU; 13 grupos de texturas duplicadas → 3.

## 5. Multidões — ver [CROWDS.md](CROWDS.md)
Servidor com grade espacial; 500 bots densos: 33 % de um núcleo, 18,8 KB/s por cliente (antes 77 KB/s).
Cliente no meio de 500 bots (sem vsync): LOW 397 FPS · MEDIUM 198 · HIGH 82 (antes 6 FPS) com draw calls estáveis.

## 6. Edifícios de reconhecimento — ver [RECOGNITION_BUILDINGS.md](RECOGNITION_BUILDINGS.md)
41 prédios com modelo próprio (Banco Central 130 m, "Balança Mas Não Cai", Kennedy, Belacap, Embratel, Biblioteca
Parque, Av. PV 1111, 30 blocos PA com galerias).
