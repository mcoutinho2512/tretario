# Confronto e pulo (rodada 9)

Estilo **arcade**: condição abstrata (0–100), fôlego (stamina), empurrão, cambaleio e queda que levanta sozinha.
Sem sangue, sem lesão, sem morte, sem armas de fogo/explosivos. Grupos não têm nenhuma diferença mecânica.

## Decisão do dono — 2026-10-18: "Avenida toda, sem nenhuma área de paz" + "bater em todos"

O dono jogou o beta e não conseguiu acertar ninguém (zonas de paz no eixo, NPCs da multidão fora de alcance, taco e
barra só nos apoios). Desde então, por **dados**:

| dado | valor | efeito |
|---|---|---|
| `public/world/zones.json` `zones[].combatPolicy` | todas `COMBAT`, sem `peaceAreas` | a avenida toda é zona de confronto |
| `zones.json` `derivedPeaceAreas` | `false` | spawn (40 m), palco, anéis do trio/carro de som e retornos de evento **desligados** (o código fica em `server/src/combat/zonePolicy.ts`; `true` religa) |
| `zones.json` `combatConsent` | `"none"` | **jogador pacífico também sofre impacto, em qualquer lugar**, sem K: golpes, empurrão F e carro/moto (`"both"` volta à regra antiga: os dois em modo interação) |
| `public/gameplay/combat_props.json` `freeCombatProps` | `true` | taco, barra e spray direto da roda de ações (ITENS), em qualquer lugar; apoios e chão continuam |

- O que ainda bloqueia impacto: **só a proteção de retorno de 5 s** (entrar, reconectar, levantar, retorno de evento) e
  as regras de evento (`friendlyFire`). Espectador continua sem golpe e sem item (capacidades).
- **Golpe sempre anima**: com `combatConsent: "none"` o servidor aceita todo pedido válido (não existe mais negativa
  `zona_paz` antes de aceitar) — `cbt_act` vai à AOI mesmo quando o impacto é bloqueado na janela ativa (proteção →
  `cbt_hit r:'blocked'`). O cliente sempre prevê a animação; SOCO/CHUTE/ESQUIVA de toque ficam sempre visíveis para
  jogador.
- **NPCs de ambiente** (pedestres e multidão de concentração) apanham no cliente — ver "Golpe em NPC" abaixo.
- **Neutralidade**: nada disso depende de grupo; todos têm a mesma mecânica (`tests/groupNeutrality.test.ts`).

As seções abaixo descrevem o mecanismo; onde falam de PEACE/CONTESTED/áreas de paz/consentimento, vale para quando os
dados religarem essas opções (os testes mantêm a regra antiga por parâmetro).

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
5. **zona do atacante** (só com `combatConsent: "both"`): área de paz ou zona PEACE → `zona_paz` (o cliente mostra
   "ZONA DE PAZ"); CONTESTED passa (só acerta com evento). Com `"none"` (dados atuais) não há negativa aqui: o golpe
   sai e anima, e o impacto é decidido na janela ativa;
6. **item** na mão (`sem_item`), **fôlego** (`stamina`), **recuperação/cooldown** (`cooldown`);
7. aceito: gasta fôlego, `cbt_act {by, a, h, t}` para a **AOI** (quem tem o atacante no StateView), evento de
   gameplay `combat_action`; agenda a janela ativa no **relógio do servidor** (setTimeout no instante exato; o tick
   de 10 Hz é rede de segurança);
8. **janela ativa** (início e, sem acerto, fim): posição do atacante **no servidor naquele instante** (nunca a do
   cliente), candidatos SÓ da grade espacial (`grid.forEachInRadius`), alcance + folga, arco + folga, parede
   (`checkPath` de src/net/authority.ts), alvo caído/levantando/em veículo fica de fora; cada alvo decidido uma vez;
9. alvo **esquivando** (iFrames) → `dodged` (vale até alcance + deslocamento da esquiva) e `combat_dodge` para ele;
10. `combatAllowed(zona, atacante, alvo, evento, agora, consentimento)` (src/combat/policy.ts): área de paz, PEACE,
    proteção, evento (provedor injetado `combat.combatEventFor(sid)` — agente D; padrão nenhum), consentimento
    (`"both"`: os dois em modo interação; `"none"`: ninguém) → senão `cbt_hit r:'blocked'` só para os dois (e
    `zona_paz` para quem golpeou, se for o caso);
11. **impacto**: condição, empurrão (contra paredes), CAMBALEANDO (status 3; o servidor ignora movimentos e volta a
    NORMAL sozinho) ou **CAÍDO** (condição 0 sempre derruba) pelo caminho de queda existente (`knock` + ragdoll no
    cliente; levantar no tick da sala; rede de segurança no CombatSystem) → proteção de retorno (`immuneUntil`,
    fx PROTECTED) e condição cheia ao levantar; `cbt_hit` para a AOI do alvo;
12. contínuo: regeneração, fim do cambaleio, fx (PROTECTED/DODGING/DISORIENTED/ENGAGED só na troca), `cbt_self
    {st, cd, fx}` só para o dono, só quando muda, ≤ 5 Hz.

O `push` antigo (F, alvo escolhido pelo cliente, regras `canPush` da rodada 5) continua aceito por compatibilidade
(walkthrough), mas o impacto vem da definição EMPURRÃO desta tabela. Com `combatConsent: "none"` o `canPush` não olha
o modo (`pacifico_alvo`/`pacifico_atacante` só na regra antiga) e a política única decide; idem `impactAllowed` do
carro/moto (`checkImpacts`/`vehicleBlockers`: quem está protegido continua bloqueando o carro, que para antes). A queda por veículo não mudou. A queda de golpe ou
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
- **Previsão**: só a animação (e o deslocamento da esquiva), com contexto de confronto (com `combatConsent: "none"`,
  sempre); na regra antiga, em zona de paz nada é previsto e o servidor responde `zona_paz`. O resultado SEMPRE vem do servidor: `cbt_hit` (cambaleio + empurrão no
  próprio com o mesmo deslocamento do servidor, bloqueio do movimento durante o cambaleio; clipe `stagger` pela mudança
  de status), `cbt_act` (remotos tocam o mesmo clipe; quem está perto ganha esqueleto na hora, como na queda).
- **Toque**: SOCO / CHUTE / ESQUIVA aparecem com contexto de confronto — com os dados atuais, **sempre** para
  jogador (espectador não tem confronto); na regra antiga só em zona COMBAT/CONTESTED, área de treino, evento ou modo
  interação. Os 4 fixos não mudam.

## Golpe em NPC de ambiente (cliente, 2026-10-18)

Pedestres (`src/npc/PedestrianSystem.ts`) e a multidão de concentração (`src/social/RallyCrowd.ts`, desenhada pelo
`CrowdDirector`) são **locais de cada cliente**: o servidor não os conhece e não valida o golpe neles — aceitável,
porque não afetam ninguém mais. `src/combat/npcHits.ts`:

- quando o golpe LOCAL chega à janela ativa (previsto ou confirmado por `cbt_act`; negado → cancelado), os sistemas
  entregam só os NPCs numa caixa de alcance + folga em volta do jogador e a escolha usa a MESMA definição de
  `combat.json` (alcance + `rangeSlackM`, arco + `arcSlackDeg`, `maxTargets`), mais perto primeiro, teto 3 por golpe;
- reação (`npcReaction` da ação ou derivada do impacto): **cambaleio** (soco, chute: recua o empurrão do golpe, clipe
  `stagger`), **queda** (chute final, empurrão, taco, barra: cai de costas, ~3,4 s deitado, levanta em 0,8 s e volta a
  andar) e **mãos nos olhos** (spray: clipe `disoriented`, curva-se). Sem ragdoll (um mundo Rapier por NPC não é
  barato): pose deitada pela inclinação do corpo — `rotation.x` no esqueleto e `CrowdAgent.tilt` na matriz do
  instanciado (o item some do instanciado enquanto reage). Prioridade 0,5 na disputa de esqueleto (como jogador caído);
- F sem jogador ao alcance: a definição EMPURRÃO nos NPCs à frente (offline, `pushNear` derruba igual).
- QA: `window.__pv.npcs()`; teste puro `tests/npcHits.test.ts`.
- **HUD**: docs/HUD.md ("HUD de confronto").

## Anticheat (o que o servidor ignora/nega)

Alvo, dano, posição e "acertei" vindos do cliente não existem no protocolo (campos extras ignorados; `cbt_hit` do
cliente não tem handler). Golpe a 100 m, item que não está na mão (sem `freeCombatProps`), sem fôlego, em
cooldown, 30 pedidos/s, teleporte e golpe (o movimento é preso pela velocidade e o golpe sai da posição do
servidor), espectador golpeando, pulo no ar / em cooldown / `y` forjado — todos cobertos por
`tests/combatServer.test.ts` (servidor real, cliente forjado). Unidade: `tests/combat.test.ts`.

## Latência

`tests/combatLatency.test.ts` (servidor real com `COLYSEUS_LATENCY` + `PV_JITTER`): o soco continua acertando e o
resultado chega em pedido → `cbt_hit` = **187 ms (RTT 30) · 219 ms (RTT 80) · 279 ms (RTT 150)** ≈ RTT + preparação
(120 ms): nada é decidido no cliente. A animação local não espera o servidor; o resultado chega ~RTT depois do fim da
preparação. Folgas de alcance (0,45 m) e arco (15°) cobrem o atraso de posição de ~150 ms.

## QA e medições

- `node tools/qa/combat_mp.mjs [base]` (2 navegadores + 1 iPhone emulado + 1 no CENTRO; servidor próprio na porta
  `PV_COMBAT_PORT`, padrão 2960): pacíficos ao lado do spawn se acertam (sem K) → área de treino → soco, cambaleio,
  chute, esquiva (`dodged`), taco do apoio, queda, levantar, proteção (`blocked`, mas o golpe anima para o outro), HUD,
  boneco, pulo visto pelo outro, botões de toque sempre visíveis, NPCs do CENTRO reagem a soco/chute e caem com o taco
  tirado da RODA (`L_npc_queda.jpg`). Capturas reais em
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

## Itens, estados físicos, zonas, proteção e desorientação

### 1. Itens de confronto: a MESMA tabela de props

`src/social/props.ts` ganhou `category?: 'SOCIAL' | 'COMBAT_PROP'` (ausente = SOCIAL) — não há registro paralelo.

| id | kind | rótulo | pegada | carregar | golpe (CombatActionDefinition.animation) |
|---|---|---|---|---|---|
| 11 | `bat` | Taco | `hand_r`, osso da mão | `carry_bat` | `cbt_bat` (golpe_taco, id 10) |
| 12 | `bar` | Barra de ferro | `hand_r`, osso da mão | `carry_bar` | `cbt_bar` (golpe_barra, id 11) |
| 13 | `spray` | Spray de pimenta | `hand_r`, osso da mão | `carry_spray` | `cbt_spray` (spray, id 12) |

- Geometria procedural (`propGeometry.ts`): barra = tubo de aço de 0,8 m com empunhadura de borracha e tampas;
  spray = lata pequena GENÉRICA (laranja, faixa clara SEM texto, tampa-gatilho preta) — sem marca, sem rótulo.
- `FAR_PLACEMENT`: barra como o taco; spray `null` (pequeno demais de longe, como o apito). Itens de confronto
  têm `crowdWeight: 0` e são filtrados da multidão (`crowdSocial.ts`) — NPC nunca carrega.
- `isCombatProp(id)` e `SOCIAL_PROPS` (o que a roda de ações oferece a qualquer um).
- Clipes (`proceduralClips.ts`): golpes `cbt_bat`/`cbt_bar`/`cbt_spray` (os mesmos tempos de preparação/janela
  ativa de `combat.json`); estados `stagger` 0,8 s (tocado pela MUDANÇA de `NetPlayer.status` → vale para todos e para
  quem chega depois) e `disoriented` 2,4 s (loop enquanto o bit FX.DISORIENTED está ligado); carregar `carry_bar`,
  `carry_spray`. Clipe avulso: `AvatarVisual.playCombatClip(name)` → `HumanAnimator.playClip(name, loop?)` (camada
  `fx`, por cima da locomoção e do item). Integração: um clipe por golpe/estado — os duplicados foram removidos.
- Dados: `public/gameplay/combat.json` `props` é a FONTE ÚNICA dos itens (propId, kind, ações, `groundTtlMs`);
  `public/gameplay/combat_props.json` traz só os pontos de apoio (`supply`).

### 2. Equipar, guardar, pegar, largar, trocar

Com `freeCombatProps: true` (dados atuais, 2026-10-18) a roda de ações (ITENS) oferece taco, barra e spray a qualquer
jogador, em qualquer lugar, como os itens sociais: `validateProp` aceita sem posse (`ActionActor.freeCombat`). O item da
roda não é item do mundo (não cai no chão, não conta no estoque; Z não o larga — X/roda guarda). Apoios e chão
funcionam como antes. Com `false`, vale a regra abaixo: item de confronto **não sai do nada**, só de um ponto de apoio
ou do chão. Cada jogador POSSUI no máximo um item do mundo.

| intenção | tecla | toque | mensagem | servidor |
|---|---|---|---|---|
| pegar (perto) / trocar | R | tocar em MÃOS | `item_pick {i}` | alcance 2,2 m da posição aceita; já possuindo, o atual cai aos pés; vai para a mão |
| largar | Z (R sem nada perto) | tocar em MÃOS | `item_drop {}` | 0,7 m à frente (sem atravessar parede); mão esvazia se era ele |
| guardar / sacar | X | roda (ITENS) | `prop {p: 0}` / `prop {p: c}` | `validateProp`: item de confronto se `carried === p` ou `freeCombatProps` |

- Negativas `item_denied`: `inexistente`, `longe`, `ocupado`, `sem_item`, `caido`, `em_veiculo`, `rapido` (200 ms),
  `invalido` — texto em `ITEM_DENIAL_TEXT`.
- **Queda**: quem fica DOWN/RAGDOLL larga o item possuído onde caiu (servidor, no tick); saída / graça vencida / sessão
  substituída também (o item não "passa" para a sessão nova).
- Indicador **MÃOS / ITEM ATUAL** (`src/ui/hud/HandIndicator.ts`, encaixe `HudShell.mountHand`): "Vazias", o item na
  mão (âmbar quando é de confronto), "Spray guardado", e a dica (T pegar · Z largar · X guardar). Some com o HUD;
  só escreve no DOM quando o texto muda.

#### Itens no mundo (`server/src/items/GroundItems.ts`, `RoomItems.ts`)
- Estados `RACK` (na vaga do apoio) · `GROUND` (largado) · `CARRIED`. Total FIXO (soma dos estoques).
- Largado expira em `groundTtlMs` (taco/barra 90 s, spray 60 s) e **volta à vaga**; acima de `maxGround` (10)
  largados, o mais antigo volta já.
- `item_list` (plano `[id, prop, x·10, z·10, estado]`): itens a ≤ `aoiM` (70 m), comparados por assinatura e enviados
  **só quando mudam para aquele cliente**, fatiado (cada cliente a 2 Hz). Longe dos apoios = nada enviado (500 bots
  espalhados não mudam a banda normal).
- Pontos de apoio (`supply.racks`): Cidade Nova (2), Campo de Santana, Rio Branco — todos em CONFRONTO/DISPUTA, longe
  do spawn, do palco e do trio. Cliente: estrado de madeira procedural + itens deitados lado a lado
  (`src/items/GroundItemsView.ts`); largado tem um anel discreto no chão.

### 3. Estados físicos (visual)
- `STAGGERED` (status 3): clipe `stagger` em camada (`AvatarVisual.setPhys`).
- `KNOCKED_DOWN` (1) / `RAGDOLL` (4): ragdoll Rapier existente; `GETTING_UP` (2): o levantar existente (slerp da pose
  do chão para a animada).
- **Queda por status** (antes só pela mensagem `knock`): `src/player/fallSync.ts` decide `start/refine/ignore` —
  quem chegar primeiro (knock ou NetPlayer.status) começa; o outro, dentro de 1,5 s, não recomeça (o `knock` atrasado
  só corrige o repouso). Vale para remotos (`NetworkClient.pushSnapshot`) e para o próprio (`onSelfStatusFall`).
- **Sem vazamento do Rapier**: `AvatarVisual` usa uma geração por queda; um `Ragdoll.create` que termina depois de
  outra queda, do reuso no pool, do descarte ou do fim da queda é liberado na hora. `Ragdoll.dispose` é idempotente e
  `Ragdoll.live` conta mundos vivos (QA: volta a 0 depois de levantar).
- Item na mão durante a queda: escondido (`PropAttachment.setVisible(false)`) e volta ao levantar — o de confronto o
  servidor já largou.

### 4. Zonas: política de confronto (dados)

**Desde 2026-10-18 todas as zonas são COMBAT** (decisão do dono, no topo). A tabela abaixo é a regra ANTERIOR (rodada 9),
mantida como referência para religar pelos dados:

| zona | política (até 2026-10-18) | por quê |
|---|---|---|
| Cidade Nova | **COMBAT** | ponta oeste, longe do evento — quem quer confronto vai até lá |
| Central do Brasil | **PEACE** | entrada/spawn |
| Campo de Santana | **CONTESTED** | só durante evento de confronto ativo |
| Centro | **PEACE** | a passeata e o trio |
| Av. Rio Branco | **CONTESTED** | idem (o palco tem área de paz) |
| Candelária | **PEACE** | chegada do ato |

Até 2026-10-18 ~60 % do eixo era PAZ, mais as áreas de paz. Fora de qualquer zona = PEACE (continua).

**Áreas de paz** (`PeaceArea`) — hoje desligadas (`peaceAreas` removidas dos dados, `derivedPeaceAreas: false`):
- fixas, em dados: `peaceAreas` dos telões (Campo de Santana, Centro);
- fixas, derivadas: spawn (`manifest.spawn`, 40 m), palco (`eventSpots` stage, `RALLY_SHAPE.stage.peaceR` 38 m à
  frente do palco);
- de evento: pontos de retorno do confronto (`agenda[].clash.respawn` → 16 m), ou o que um runner registrar
  (`zonePolicy.setEventAreas(key, areas)`);
- **móveis**: anel do trio (28 m) e do carro de som (18 m) — `RALLY_SHAPE[kind].peaceR`, lidos das posições dos
  veículos de evento a cada consulta (a mesma lista que monta a concentração das células do espectador aéreo).

**Servidor** (`server/src/combat/zonePolicy.ts`, instância `room.zonePolicy`):
`policyFor(zoneId) → ZoneCombatPolicy` e `peaceAt(x, z) → boolean` (também `room.policyFor` / `room.peaceAt`).
Uso pelo CombatSystem:
```ts
const party = (sid) => ({ zone: room.zoneOf(sid), inPeaceArea: room.peaceAt(x, z), …, protectedUntil: room.protection.protectedUntil(sid) });
combatAllowed((z) => room.zonePolicy.policyFor(z), party(a), party(b), eventRules, now);
```

**Cliente**: o aviso de zona mostra a política discreta ("ZONA DE PAZ" verde, "DISPUTA" âmbar, "ZONA DE CONFRONTO"
salmão — hoje sempre "Zona de confronto"); a legenda do minimapa diz "· paz / disputa / confronto" (hoje "· confronto");
o minimapa tinge fraco a faixa das zonas de confronto (vermelho) e disputa (âmbar) — camada estática, custo zero por
quadro. O cliente lê as mesmas regras da raiz de `zones.json` (`loadZoneFile` → `CombatRules`): `combatConsent` decide
previsão, botões de toque, F e o bloqueio previsto do carro; as áreas derivadas só existem no servidor.

### 5. Proteção de retorno
- Fonte ÚNICA: `Actor.immuneUntil` no servidor (o empurrão antigo, o atropelamento e o CombatSystem leem daqui); o
  bit FX.PROTECTED em `NetPlayer.fx` é escrito só pelo CombatSystem (que recalcula `fx` enquanto o jogador está
  "quente"). `room.applyProtection(sid, now?, ms?)` estende `immuneUntil` e acorda o CombatSystem.
- Duração: `tuning.protectMs` de `public/gameplay/combat.json` (5 s; `PV_PROTECT_MS` só em servidor de teste).
- Aplicada ao **entrar**, **reconectar**, **levantar** (CombatSystem) e no **retorno** de evento de confronto (runner
  de eventos, `EventHost.protect`).
- Visual: casca translúcida com faixas lentas subindo (`src/combat/fxVisuals.ts` ProtectedAura — geometria e material
  únicos, brilho ≤ 0,16, pulso lento de pequena amplitude: sem piscar).

### 6. Desorientado (spray)
- Só para quem sofre: véu de tela CSS (`DisorientOverlay`) — desfoque 2,5 px, dessaturação, vinheta; entra e sai em
  0,6 s; sem flash, sem tremor. O DOM só muda na troca de estado.
- Reação no personagem (todos veem): `disoriented` em loop enquanto o bit FX.DISORIENTED está ligado (mãos diante dos
  olhos, cabeça baixa — nada de lesão).
- Acessibilidade: **Ajustes → "Reduzir efeitos visuais"** (`reduceEffects`): só um ícone pequeno ("Visão turva") e um
  tom leve. Guardado como as outras preferências do HUD (localStorage + perfil: `PlayerPreferences.reduceEffects`,
  `sanitizePreferences` no servidor).

### 7. QA
- Vitest: `tests/props.test.ts` (registro/pegadas/modelos), `tests/proceduralClips.test.ts` (clipes de confronto),
  `tests/zonePolicy.test.ts` (dados reais, anel móvel do trio, retorno de evento, integração com `combatAllowed`),
  `tests/combatItems.test.ts` (alcance, troca, expiração/volta, teto, saída/queda, protocolo, posse na mão,
  proteção, FallSync, preferência).
- `tools/qa/items_zones_mp.mjs` — 2 navegadores, servidor PV_TEST próprio (porta 2971, evento `cotidiano` para o
  empurrão): proteção, apoio, pegar/largar/pegar do chão, troca barra/spray, guardar/sacar, desorientação normal e
  reduzida, cambaleio, queda só por status, empurrão (uma queda só), larga ao cair, Rapier liberado, taco direto da
  roda (`freeCombatProps`), aviso de zona (hoje "Zona de confronto" em toda a avenida; porta `PV_ITEMS_PORT`). Efeitos que o CombatSystem aplicará de verdade são forçados pelas mensagens `qa_fx` /
  `qa_status`, que **só existem com PV_TEST=1**.
- Capturas: `docs/screenshots/round9/` E_taco, F_barra, G_spray (+ desorientado normal/reduzido), H_queda_ragdoll,
  J_zona_de_paz (regra antiga), J_zona_central (2026-10-18: a Central já é confronto), K_zona_de_confronto,
  L_npc_queda (NPC deitado depois do taco).

## Integração (rodada 9)

- **Uma política só** (`src/combat/policy.ts` `combatAllowed`) para golpes, empurrão antigo (tecla F,
  `CombatSystem.pushPolicy`) e atropelamento por carro/moto (em zona de paz o carro PARA, como diante de quem é
  pacífico). Áreas de paz: as fixas de `zones.json` + as derivadas/móveis de `server/src/combat/zonePolicy.ts`
  (`peaceAt`: spawn 40 m, palco, anéis do trio 28 m e dos carros de som 18 m, retornos de evento).
- **Área de treino** (boneco): vale como COMBAT dentro de zona PEACE ou CONTESTED.
- **Eventos**: `room.combat.combatEventFor = evt.combatEventFor` (confronto de grupos: inscritos, zonas do evento,
  `friendlyFire` dos dados); derrubadas no evento pontuam pelo runner (`evt.onKnockdown`), nunca dão XP por golpe.
- **Consentimento**: dado `combatConsent` de `zones.json`. Hoje `"none"` (2026-10-18): pacífico também sofre impacto
  em qualquer lugar; K continua existindo, mas não decide confronto. Regra antiga (`"both"`): quem fica pacífico e fora
  de eventos de confronto nunca sofre impacto.
- **Teclas**: R soco · Q chute · C esquiva · F empurrão · T pegar/trocar item · Z largar · X guardar/sacar.

