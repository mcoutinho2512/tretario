# Emotes, danças e poses de itens (rodada 7)

Ações sociais = **dados** em `src/social/actions.ts` (`ActionDefinition`) + **um clipe** com o nome de `clip`.
Itens = `src/social/props.ts` (`PropDefinition.carryClip` = pose de carregar). Os clipes que a biblioteca
`anims.glb` (Quaternius UAL, CC0) não tem são **procedurais, deste projeto**: `src/characters/human/proceduralClips.ts`.

## Como funciona

**Clipes procedurais.** Cada clipe é uma função de pose escrita sobre o idle (t = 0) do próprio esqueleto
"game_engine": rotações em eixos do espaço do esqueleto (x = esquerda, y = cima, z = frente; mesmos eixos do `rot()`
do animador), IK analítica de dois ossos para mãos e pés (alvos relativos a peito/ombro/cabeça/joelho, cotovelo e
joelho por vetor polar, plano da articulação preservado — sem torção espúria), dedos por flexão absoluta
(0 = mão aberta, 1 = punho), respiração e cabeça viva. A função é amostrada a 30 quadros/s em
`QuaternionKeyframeTrack` comuns (+ `pelvis.position` nos de corpo inteiro). Gerados **sob demanda** e em cache por
corpo (2–11 ms por clipe na primeira vez; o assado da multidão gera os 8 que usa na carga).
Natural, não robótico: senoides em camadas com frequências inteiras sobre o ciclo (emenda perfeita), ombro conduz e
punho atrasa (fases), ataque rápido/volta lenta nas batidas (`beatPulse`), entrada/saída suavizadas
(smootherstep), transferência de peso e quadril nas danças, pés plantados por IK (nada patina).

**Camada de ação (`HumanAnimator.setSocial`).** Depois do mixer da locomoção, as trilhas da ação são avaliadas
direto (interpolantes, sem mixer) e misturadas osso a osso com crossfade de 0,32 s (sentar: 0,8 s):
- `layer: 'upper'` — tronco, cabeça, braços, mãos e dedos; as pernas continuam andando/correndo. Parado, a camada
  controla a coluna toda; andando, a coluna baixa cede à passada (spine_01 30 %, spine_02 55 %, spine_03 80 %).
- `layer: 'full'` — corpo inteiro (danças, sentar, pulo, foto): substitui a locomoção; o contato com o chão usa a
  correção medida do próprio clipe (`clipFloor`) e a trava de pés vale também de longe enquanto a ação dura.
- `phase` = segundos desde o início (relógio comum): todos os clientes tocam a mesma fase; só ressincroniza quando
  chega um valor NOVO (pode chamar `setSocial` a cada quadro com o mesmo estado). Fase que volta ao começo
  (< 0,5 s) = ação disparada de novo.
- `variation` 0..7: deslocamento de fase e andamento ±3 % nos loops; ímpar espelha os gestos de uma mão
  (`mirror: true`, sufixo `~m`). Variação 0 = clipe canônico (jogador).
- `once`: toca `duration` e sai sozinha (o mesmo estado reenviado depois do fim não recomeça).
- Item na mão e nenhuma ação → pose de carregar (`carryClip`); ação de item (`prop_*`) substitui a pose de carregar.
- Ajustes da locomoção (base estreita do idle, corrida ereta) cedem à camada; `restorePose`/`adjusted` continuam
  valendo (quatérnios reaproveitados, sem lixo por quadro). Poses de veículo (`updateRiding`) não mudam.
- Custo medido (Chrome/M-series): +5–13 µs por `update` com ação ativa.

**Multidão instanciada (VAT).** Ver `docs/CROWDS.md`: os `crowdClip` são assados em `CrowdRenderer`
(`CROWD_ACTION_FRAMES`), escolhidos por `CrowdAgent.act`/`actAt`, sem draw call extra.

## Integração (quem chama o quê)

- Jogador/remoto/NPC com esqueleto: `HumanCharacter.setSocial({ act, phase, variation, prop, design })` (ou
  `AvatarVisual.setSocial`). `phase` = `(agora − início) / 1000` no relógio do servidor. O estado recebido antes de o
  esqueleto carregar é aplicado quando o animador nasce.
- NPCs com subconjunto de clipes (`clips: ['idle','walk','jog']`) funcionam: a ação busca a biblioteca completa
  (dança da biblioteca) e gera os procedurais a partir do idle.
- Multidão instanciada: preencher `CrowdAgent.act` e `CrowdAgent.actAt` (segundos, mesmo relógio passado em
  `CrowdRenderer.draw(agents, dt, now)`; padrão `performance.now()/1000`).
- QA: `HumanAnimator.socialDebug` (camadas ativas), `seekSocial(t)` (congela no instante t).

## Pegadas (combinar com `PropAttachment`)

Ossos de pegada: `hand_r`/`hand_l` (punho; a palma fica ~6 cm além, na direção de `middle_01`).
- **Cartaz** (`sign_*`, 0,5 m de largura): mãos nas bordas laterais, ~0,46 m entre os punhos, palmas para dentro.
  `carry_sign`: mãos ~0,45 m abaixo dos ombros, 0,3 m à frente → segurar o cartaz pelo **meio da altura** (fica junto
  ao peito, rosto visível). `prop_sign_raise/wave`: mãos acima da cabeça → pegada no **quarto inferior** do cartaz.
  No balanço as duas mãos giram juntas em torno do centro (distância entre elas constante).
- **Faixa** (`banner`, 2,4 m): mãos ~0,84 m (segurar) / 0,76 m (carregar) entre si, nas **pontas da borda de cima**;
  a faixa pende à frente do corpo.
- **Bandeira** (`flag_*`): mastro na mão direita; nas ações e em `carry_flag_large` a mão esquerda segura o MESMO
  mastro mais abaixo (mãos alinhadas na vertical, ~0,5 m entre elas; no balanço o mastro gira em torno da mão de
  baixo). `carry_flag_small`: só a direita, antebraço à frente, mastro de pé.
- **Megafone**: mão direita logo abaixo do queixo, à frente da boca (cabo); `carry_megaphone`: braço caído.
- **Percussão**: mãos (baquetas) sobre o tampo à frente da cintura, ~0,5 m abaixo dos ombros.
- **Guarda-chuva**: cabo à frente do peito, um pouco à direita (a haste passa ao lado do rosto).
- **Taco**: só carregar (pendurado ao lado do corpo) — sem ação de golpe.

`dev/human.html?proxy=1` desenha um cartaz/mastro/faixa/tambor aproximado com essas pegadas.

## Lista de clipes

| Clipe | Ação (id) | Camada | Tipo | Notas |
|---|---|---|---|---|
| `emote_wave` | wave (1) | upper | once 2,4 s | espelhável; antebraço balança no cotovelo, mão atrasa; multidão |
| `emote_clap` | clap (2) | upper | loop 2,4 s | 5 palmas, mão direita bate na esquerda; multidão |
| `emote_point` | point (3) | upper | once 2,0 s | espelhável; indicador, duas ênfases |
| `emote_cheer` | cheer (4) | upper | once 2,6 s | espelhável; punhos para o alto, socos |
| `emote_arm_up` | arm_up (5) | upper | loop 3,2 s | espelhável; multidão (também flag_raise/flag_wave/fist_up) |
| `emote_arms_up` | arms_up (6) | upper | loop 3,2 s | balanço; multidão (também cheer/sign_raise/sign_wave) |
| `emote_thumbs_up` | thumbs_up (7) | upper | once 1,8 s | espelhável; polegar radial |
| `emote_talk` | talk (8) | upper | loop 6,0 s | espelhável; gestos irregulares de conversa |
| `emote_photo` | photo (9) | full | loop 3,6 s | espelhável; peso numa perna, "V" junto ao rosto, mão na cintura |
| `emote_sit_ground` | sit (10) | full | loop 4,8 s | pelve a 0,14 m do chão, joelhos para cima, olha em volta |
| `emote_jump_cheer` | jump_cheer (11) | full | once 2,2 s | antecipação → voo 0,24 m → amortece |
| `emote_phone` | phone (12) | upper | loop 5,0 s | espelhável; celular à frente do peito, panorâmica lenta |
| `emote_rhythm_clap` | rhythm_clap (25) | upper | loop 2,0 s | 120 BPM, palmas acima da cabeça |
| `emote_fist_up` | fist_up (27) | upper | loop 2,0 s | espelhável; punho erguido, 2 batidas |
| `prop_sign_raise` | sign_raise (20) | upper | loop 2,4 s | cartaz acima da cabeça |
| `prop_sign_wave` | sign_wave (21) | upper | loop 2,4 s | cartaz inclina ±15° |
| `prop_flag_raise` | flag_raise (22) | upper | loop 3,0 s | mastro na vertical, duas mãos |
| `prop_flag_wave` | flag_wave (23) | upper | loop 2,4 s | arco de ±29° sobre a cabeça |
| `prop_megaphone` | megaphone (24) | upper | loop 4,0 s | ênfases de fala, mão livre gesticula |
| `prop_banner_hold` | banner_hold (26) | upper | loop 3,2 s | faixa erguida à frente do peito |
| `prop_drum` | drum (28) | upper | loop 2,0 s | colcheias alternadas a 120 BPM |
| `prop_whistle` | whistle (29) | upper | once 1,6 s | dois apitos |
| `carry_flag_small` … `carry_bat` | (itens) | upper | loop 4,0 s | uma por `carryClip` de `props.ts` |
| `dance_simple` | dance_simple (40) | full | 108 BPM, 8 tempos | passo-toque, braços em oposição |
| `dance_lively` | dance_lively (41) | full | 124 BPM | quique, toques de calcanhar, socos alternados |
| `dance_arms` | dance_arms (42) | full | 100 BPM | braços no alto em arco, quadril oposto |
| `dance_party` | dance_party (43) | full | 118 BPM | pulinhos, punho para cima alternando a cada 4 tempos |
| `dance` | dance_classic (44) | full | biblioteca | Quaternius UAL (CC0) |

## Como acrescentar uma ação

1. `src/social/actions.ts`: nova `ActionDefinition` com id NOVO (nunca reaproveitar), `clip`, `mode`/`duration`,
   `layer`, `allowMove`, `needs`, `crowdWeight` e, se a multidão distante deve fazer, `crowdClip`.
2. Clipe: se não existir na biblioteca, uma entrada em `SPECS` (`proceduralClips.ts`) com `dur` (para `once`, a
   duração vem do registro via `onceDur`), `layer` igual ao da ação, `mirror` se for gesto de uma mão sem item e a
   função `pose(c)` usando `c.bone/limb/twist/reach/plant/hips/fingers/thumbUp/life`. Loops: só frequências
   inteiras sobre `c.u`.
   **Golpes e reações (rodada 10, docs/COMBAT.md "Animação"):** `cbt: [preparação, janela, recuperação]` (s, iguais
   ao `combat.json`; `dur` = soma; crossfade por `clipFades`), `fadeIn`/`fadeOut` separados e `adaptive` (corpo inteiro
   parado, só tronco andando). Ferramentas novas do `Poser`: `aimHand` (item aponta numa direção pela pegada real
   `HAND_GRIP`), `secondGrip` (segunda mão no mesmo cabo), `plant(…, ballPivot)` (calcanhar girando na bola do pé),
   `plantTurn` (pé gira no chão), `baseKnee` (polo do joelho do idle: entrada/saída sem tirar o pé do lugar) e
   `updateFloorRel`/`floorRel` (mão apoiada no chão). Os parâmetros novos são opcionais: emotes, itens e danças
   antigos geram exatamente os mesmos quadros. Teste: `tests/combatAnim.test.ts`.
3. Se tiver `crowdClip` novo: quadros em `CROWD_ACTION_FRAMES` (`CrowdRenderer.ts`).
4. Conferir: `npm test` (o teste `tests/proceduralClips.test.ts` exige que todo clipe citado exista, só anime ossos
   do rig, emende e não afunde os pés), `node tools/qa/emote_sheet.mjs` (folha de contato dos 4 corpos, frente/costas;
   `STRIP=8` = quadros ao longo do ciclo; `CAM=upper|torso`) e `node tools/qa/emote_ground.mjs` (contato com o chão).
   Página: `/dev/human.html?act=<key>&prop=<kind>&t=<s>&var=<0..7>&lod=<0..3>&proxy=1`; `&crowd=2|3` mostra a
   multidão instanciada com cada clipe assado.

## Medições

**Contato com o chão** (`tools/qa/emote_ground.mjs`, 4 corpos, sola = osso + 1,2 cm): durante as ações de corpo
inteiro o pé mais baixo fica em 0,012 m (LOD0 e LOD2) — sem flutuar nem afundar; pulo: pés até 0,28 m no voo;
sentar: pelve a 0,142 m, pés no chão; na transição para sentar os pés sobem no máximo 4,5 cm e descem 0,5 cm
(LOD0). Gestos da camada superior não alteram o contato da locomoção.

**Roupa em poses extremas** (braços erguidos, danças, cartaz, bandeira, megafone, palmas; LOD0/LOD1, 4 corpos):
- corrigido: com o braço erguido a pele do braço atravessava a manga curta em frestas (homem/idosa, pior no LOD1).
  `sleeveCovered` (`hideCovered.ts`) esconde a pele do braço (peso no úmero ≥ 0,5) entre o ombro e 3,5 cm antes do
  punho da manga, pelo eixo do braço — complementa o recorte por raio (que continua igual). Mangas e braços abaixo do
  punho conferidos parados e em todas as poses: sem buraco.
- elevação do ombro (clavícula) nos braços erguidos limitada a 0,12 rad: mais que isso dobrava a camiseta no ombro
  (vincos escuros) no LOD1.
- restante (pré-existente, também no idle): o cós da calça jeans aparece através da barra da camiseta nas costas da
  mulher e da idosa (a camiseta segue a coluna, a calça a pelve; em repouso não se sobrepõem). Pequenos pontos
  claros na axila do LOD1 com o braço totalmente erguido.

Capturas: `docs/screenshots/round7/emotes_*.jpg` (folhas de contato, multidão instanciada, manga com braço erguido).
