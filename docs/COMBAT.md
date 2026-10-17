# Confronto e pulo (rodada 9)

Estilo **arcade**: condição abstrata (0–100), fôlego (stamina), empurrão, cambaleio e queda que levanta sozinha.
Sem sangue, sem lesão, sem morte, sem armas de fogo/explosivos. Grupos não têm nenhuma diferença mecânica.
Quem fica em modo pacífico e fora de eventos de confronto **nunca** sofre impacto, em nenhuma zona.

## Peças

| Onde | O quê |
|---|---|
| `public/gameplay/combat.json` | DADOS: ajustes (stamina, condição, queda, proteção, folgas, taxa, buffer), ações, itens, bonecos de treino |
| `src/combat/types.ts` · `policy.ts` | contrato compartilhado (estados PHYS, bits FX, mensagens) e política zona + evento + estado |
| `src/combat/data.ts` | leitura/validação da tabela, combos, arco, constantes do pulo (`JUMP`) — pura, cliente e servidor |
| `server/src/combat/CombatSystem.ts` | o sistema ÚNICO de confronto (sem Colyseus): pedido → validação → janela ativa → impacto; bonecos |
| `server/src/combat/JumpValidator.ts` | pulo no servidor: no chão, cooldown, janela no ar, modelo de chão para o `y` |
| `server/src/PresidenteVargasRoom.ts` | só a ligação (bloco `// rodada 9 — confronto`): mensagens, tick, entrada/saída, `CombatHost` |
| `src/combat/CombatClient.ts` | cliente: entrada com buffer, animação prevista, reação ao resultado, pulo, bonecos |
| `src/combat/CombatHud.ts` · `combat.css` | HUD discreto (docs/HUD.md) e botões de toque contextuais |
| `src/combat/DummyVisual.ts` | boneco de treino procedural (poste + lona + braços em T; não é pessoa) |
| `src/characters/human/proceduralClips.ts` | clipes `cbt_*` (padrão SPECS, docs/EMOTES.md "como acrescentar") |

## Ações (dados)

| id | chave | tipo | prep → ativa → recup. (ms) | alcance · arco | fôlego | cooldown | impacto |
|---|---|---|---|---|---|---|---|
| 1 | soco | golpe | 120 → 100 → 230 | 1,35 m · 70° | 8 | 380 | −12 condição, empurra 0,35 m, cambaleia 380 ms |
| 2 | soco_2 (combo de 1) | golpe | 100 → 100 → 260 | 1,35 m · 70° | 8 | 350 | −12, 0,4 m, cambaleia 420 ms |
| 3 | chute | golpe | 220 → 120 → 380 | 1,6 m · 60° | 16 | 800 | −20, 0,9 m, cambaleia 600 ms |
| 4 | chute_final (combo de 2) | golpe | 200 → 140 → 450 | 1,65 m · 64° | 18 | 900 | −28, 1,6 m, **queda** |
| 5 | empurrao | empurrão | 150 → 120 → 350 | 1,9 m · 150° | 14 | 1000 | −10, 1,8 m, **queda** |
| 6 | esquiva | esquiva | 0 → 320 → 180 | — | 20 | 900 | invulnerável 320 ms, desloca 2,2 m |
| 10 | golpe_taco (`bat`, prop 11) | golpe | 260 → 120 → 420 | 1,9 m · 90° | 18 | 900 | −26, 1,1 m, cambaleia 650 ms |
| 11 | golpe_barra (`bar`) | golpe | 300 → 120 → 480 | 1,8 m · 80° | 22 | 1100 | −32, 1,3 m, cambaleia 700 ms |
| 12 | spray (`spray`) | spray | 120 → 500 → 300 | 3 m · 40°, até 3 alvos | 10 | 2500 | desorientado 2,5 s (fx), sem perda de condição |

- **Combo** soco → soco → chute: o cliente pede sempre a ação BASE; o servidor troca pela variante (`comboFrom` +
  `comboOf`) se o pedido cai na janela (`comboWindowMs`) depois do fim da janela ativa da anterior. A variante pode
  encurtar a recuperação da anterior. Variantes pedidas direto são `acao_invalida`.
- **Itens**: `requiredItem` = tipo do prop (`src/social/props.ts`). O taco é o prop 11 real; barra e spray são do
  agente B (props/visuais/pegada) — as AÇÕES e a resolução no servidor são estas, chaveadas por `'bar'`/`'spray'`.
  Com item de confronto na mão o botão de soco vira o golpe do item; soco e empurrão exigem mãos livres
  (`bareHanded`), chute não.
- **Ajustes** (`tuning`): fôlego 100, +22/s depois de 0,7 s; condição 100, +4/s depois de 4 s sem levar golpe;
  queda 2,6 s + levantar 1,4 s (os mesmos da queda antiga); proteção de retorno 5 s; folga de alcance 0,45 m e de
  arco 15°; 5 pedidos/s; buffer de entrada 180 ms.

## Fluxo no servidor (`cbt {a, h, seq}`)

1. **taxa**: janela de 1 s, acima de `maxRequestsPerS` → `spam` (aviso no máximo 1/s);
2. **capacidade** `combat.act` (src/access/policy.ts; espectador → `denied {cap}`);
3. ação válida e combo resolvido (`acao_invalida`); **veículo/trio** (`em_veiculo`);
4. **estado** físico permitido (padrão só NORMAL; esquiva também de CAMBALEANDO) e **não estar no ar** (`estado`);
5. **zona do atacante**: área de paz ou zona PEACE → `zona_paz` (o cliente mostra "ZONA DE PAZ"); CONTESTED passa
   (só acerta com evento);
6. **item** na mão (`sem_item`), **fôlego** (`stamina`), **recuperação/cooldown** (`cooldown`);
7. aceito: gasta fôlego, `cbt_act {by, a, h, t}` para a **AOI** (quem tem o atacante no StateView), evento de
   gameplay `combat_action`; agenda a janela ativa no **relógio do servidor** (setTimeout no instante exato; o tick
   de 10 Hz é rede de segurança);
8. **janela ativa** (início e, sem acerto, fim): posição do atacante **no servidor naquele instante** (nunca a do
   cliente), candidatos SÓ da grade espacial (`grid.forEachInRadius`), alcance + folga, arco + folga, parede
   (`checkPath` de src/net/authority.ts), alvo caído/levantando/em veículo fica de fora; cada alvo decidido uma vez;
9. alvo **esquivando** (iFrames) → `dodged` (vale até alcance + deslocamento da esquiva) e `combat_dodge` para ele;
10. `combatAllowed(zona, atacante, alvo, evento, agora)` (src/combat/policy.ts): área de paz, PEACE, proteção,
    evento (provedor injetado `combat.combatEventFor(sid)` — agente D; padrão nenhum), consentimento (os dois em modo
    interação) → senão `cbt_hit r:'blocked'` só para os dois (e `zona_paz` para quem golpeou, se for o caso);
11. **impacto**: condição, empurrão (contra paredes), CAMBALEANDO (status 3; o servidor ignora movimentos e volta a
    NORMAL sozinho) ou **CAÍDO** (condição 0 sempre derruba) pelo caminho de queda existente (`knock` + ragdoll no
    cliente; levantar no tick da sala; rede de segurança no CombatSystem) → proteção de retorno (`immuneUntil`,
    fx PROTECTED) e condição cheia ao levantar; `cbt_hit` para a AOI do alvo;
12. contínuo: regeneração, fim do cambaleio, fx (PROTECTED/DODGING/DISORIENTED/ENGAGED só na troca), `cbt_self
    {st, cd, fx}` só para o dono, só quando muda, ≤ 5 Hz.

O `push` antigo (F, alvo escolhido pelo cliente, regras `canPush` da rodada 5) continua aceito por compatibilidade
(walkthrough), mas o impacto vem da definição EMPURRÃO desta tabela. A queda por veículo não mudou. A queda de golpe ou
empurrão agora vai só para a AOI do alvo (antes `knock` ia para todos).

**Zonas**: a política é `zoneDef(zoneOf(sid)).combatPolicy ?? 'PEACE'` (dados de zonas/áreas de paz = agente B).
Bonecos de treino têm uma **área de treino** (raio `areaR`) com política COMBAT onde a zona real é PEACE (áreas de paz
continuam valendo). Servidor de teste: `PV_COMBAT_ZONES=*|ID,ID` força COMBAT (carga/QA), `PV_PROTECT_MS` encurta
a proteção (testes de rede).

**Eventos de gameplay**: `combat_action {key}` (ação aceita, sem alvo), `combat_dodge` (esquivou de um golpe de
verdade), `dummy_knockdown` (derrubou o boneco). Nenhum XP por acerto em jogador.

## Boneco de treino

Alvo do servidor (não é NetPlayer, não conta como jogador, não entra na AOI nem nas métricas): perto do Campo de
Santana (`dummies[0]`, gramado do parque, área de treino de 14 m). Aceita golpe de qualquer modo (não precisa de
consentimento) fora de área de paz; cambaleia, cai com condição 0 (ou golpe de queda), levanta em 0,8 s depois de
`resetMs` e recupera a condição 4 s depois do último golpe. Visível por `cbt_dummy [id, x, z, h, st, condição]` para
quem está a ≤ 90 m (varredura 1 Hz pela grade + na troca de estado) e `cbt_hit {dummy: 1}`. Usado pela missão
tutorial (agente C) via `dummy_knockdown`.

## Pulo

Cliente: Espaço / PULAR → se no chão e fora do cooldown (o MESMO do servidor, `JUMP.cooldownMs` 700 ms depois do
pouso + 60 ms de folga) → impulso previsto (stepPlayer, 4,6 m/s) + `jump {seq}`. Servidor (`JumpValidator`): nega
`no_ar`, `cooldown`, `estado` (caído/cambaleando), `veiculo` (veículo ou trio) com `jump_denied {seq, reason}` (o
cliente corta a subida). Janela no ar = voo balístico (0,59 s) + 600 ms de rede; `y` aceito ≤ partida + altura balística
do stepPlayer no instante do movimento (tolerância −300/+150 ms; pico 0,68 m) + 0,25 m — não dá para "pairar". Sem pulo: **modelo de chão grosso** — o servidor não tem malha de chão, então o `y` de um movimento a pé fica
≤ y do último movimento aceito no chão + 0,2 m (meio-fio 0,15 m) e nunca acima do nível mais alto do mapa (plataforma
1,0 m). Descer é livre. Os outros veem impulso, voo e pouso pelo `loco = 3` + `y` interpolado (já existiam) e pelos
clipes `jump_start`/`jump_land` da biblioteca nas transições (HumanAnimator); predição/reconciliação inalteradas.

## Cliente

- **Entrada** (desktop; não colide com WASD/Shift/Espaço/E/K/F/G/M/H/P/F1/F3/Enter/Tab/1–4): **clique esquerdo** (com
  o mouse capturado — o 1º clique só captura) ou **R** = soco (ou golpe do item na mão); **clique direito** ou **Q** =
  chute; **C** = esquiva (na direção do movimento; parado: para trás); **F** continua empurrão. Ajuda: F1.
- **Buffer** de 180 ms: o golpe apertado durante a recuperação sai quando ela termina (previsão local da tabela).
- **Previsão**: só a animação (e o deslocamento da esquiva), e só com contexto de confronto; em zona de paz nada é
  previsto e o servidor responde `zona_paz`. O resultado SEMPRE vem do servidor: `cbt_hit` (cambaleio + empurrão no
  próprio com o mesmo deslocamento do servidor, bloqueio do movimento durante o cambaleio; clipe `cbt_stagger` nos
  remotos), `cbt_act` (remotos tocam o mesmo clipe; quem está perto ganha esqueleto na hora, como na queda).
- **Toque**: SOCO / CHUTE / ESQUIVA aparecem só com contexto de confronto (zona COMBAT/CONTESTED, área de treino,
  evento ou modo interação) e somem fora dele; os 4 fixos não mudam.
- **HUD**: docs/HUD.md ("HUD de confronto").

## Anticheat (o que o servidor ignora/nega)

Alvo, dano, posição e "acertei" vindos do cliente não existem no protocolo (campos extras ignorados; `cbt_hit` do
cliente não tem handler). Golpe a 100 m, atravessando zona de paz, item que não está na mão, sem fôlego, em
cooldown, 30 pedidos/s, teleporte e golpe (o movimento é preso pela velocidade e o golpe sai da posição do
servidor), espectador golpeando, pulo no ar / em cooldown / `y` forjado — todos cobertos por
`tests/combatServer.test.ts` (servidor real, cliente forjado). Unidade: `tests/combat.test.ts`.

## Latência

`tests/combatLatency.test.ts` (servidor real com `COLYSEUS_LATENCY` + `PV_JITTER`): o soco continua acertando e o
resultado chega em pedido → `cbt_hit` = **187 ms (RTT 30) · 219 ms (RTT 80) · 279 ms (RTT 150)** ≈ RTT + preparação
(120 ms): nada é decidido no cliente. A animação local não espera o servidor; o resultado chega ~RTT depois do fim da
preparação. Folgas de alcance (0,45 m) e arco (15°) cobrem o atraso de posição de ~150 ms.

## QA e medições

- `node tools/qa/combat_mp.mjs [base]` (2 navegadores + 1 iPhone emulado; servidor próprio na porta 2960):
  paz → soco negado / sem impacto; área de treino → soco, cambaleio, chute, esquiva (`dodged`), taco, queda,
  levantar, proteção (`blocked`), HUD, boneco, pulo visto pelo outro, botões de toque. Capturas reais em
  `docs/screenshots/round9/` (A_pulo, B_soco, C_chute, D_esquiva, I_hud_confronto, J_toque_confronto) e folhas de
  contato dos clipes (`clips_golpes.jpg`, `clips_itens.jpg`; `tools/qa/combat_sheet.mjs` + `/dev/human.html?cbt=<clipe>&t=<s>`).
- Carga: `server/tools/bots.ts --combat=F` (pares parados frente a frente, um pedido a cada 1,5–4 s) e
  `--combat-dense` (todos lutando, um pedido a cada 0,7–1,4 s); `server/tools/loadtest.ts` cenário `100c`
  (estresse) e `BOTS_COMBAT=F` nos cenários d/s; `/metrics` ganhou `combatAvgMs/MaxMs` (custo no tick),
  `hitValAvgMs/MaxMs/hitValsPerSec` (validação de cada janela ativa) e `cbtReqPerSec/cbtOkPerSec`.

**Medições** (M5 Pro COMPARTILHADO com outros agentes — carga média do sistema 15–100 durante as medições, então tick/CPU
são pessimistas; `docs/screenshots/loadtest_r9a_base.json`, `loadtest_r9a_combat.json`; 20 s por cenário, 60 % dos
bots com vida social, 3 grupos, 30 msgs de chat/min):

| Cenário | tick (média · máx) | CPU | banda/cliente | confronto no tick | validação de acerto | pedidos/s (aceitos) |
|---|---|---|---|---|---|---|
| 500 densos, sem confronto | 11,0 · 22,4 ms | 43 % | **20,4 KB/s** | 0,04 ms | — | — |
| 500 densos, 10 % em confronto (50 lutadores) | 13,4 · 26,8 ms | 53 % | 19,8 KB/s | 0,40 ms | 0,96 ms (máx 3,0) · 14/s | 18 (16) |
| 100 lutadores (estresse, `100c`) | 1,7 · 32,8 ms | 13 % | 5,0 KB/s | 0,35 ms | 0,37 ms (máx 5,7) · 63/s | 92 (68) |

Sem confronto a banda do jogador comum fica igual à da rodada 8 (20,4 KB/s): `fx` só muda na entrada/proteção,
`cbt_self` só quando algo muda, e só quem tem estado ativo passa pelo tick (conjunto "quente"). No estresse, 462 das
negativas são `estado` (lutador caído/cambaleando tentando golpear) — esperado; as correções vêm dos bots, que não
aplicam o empurrão/esquiva recebidos. A validação mais cara na multidão densa vem da grade espacial compartilhada
(células de 110 m: a consulta de 5 m visita a célula toda); 14 validações/s × ~1 ms ≈ 1,4 % de um núcleo.
