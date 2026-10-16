# Sistema da manifestação (rodada 7)

Contratos ÚNICOS (não duplicar):

| Módulo | O quê |
|---|---|
| `src/social/actions.ts` | registro de ações/emotes (`ActionDefinition`, ids u8 estáveis) |
| `src/social/props.ts` | itens seguráveis (`PropDefinition`, pegada, pose de carregar, slot de design) |
| `src/social/designs.ts` | designs neutros + campanhas (dados em `public/designs/campaigns.json`) + camisas de futebol (só cores) |
| `src/social/designPainter.ts` | pintor de designs (canvas) e atlas por alvo |
| `src/social/rally.ts` | pontos de concentração (trio, carro de som, palco) |
| `src/social/actionRules.ts` | regras do servidor para ações/itens (puras) |
| `src/social/types.ts` | `SocialState` — o mesmo estado para jogador local, remoto, NPC e multidão instanciada |
| `HumanCharacter.setSocial` / `AvatarVisual.setSocial` | ponto único: animador (camada de ação) + `PropAttachment` (itens na mão) |
| `CrowdAgent.act/actAt/prop/design` | vida social na multidão instanciada |
| `src/graffiti/*` + `server/src/graffiti/*` | pichação/grafite: superfícies autorizadas, vetor compacto, regras/moderação, persistência — `docs/GRAFFITI.md` |

Rede: `NetPlayer.act/actAt/actVar/prop/design`; mensagens `act {a, v}` e `prop {p, d}` (servidor valida e grava).

## Itens, bandeiras e cartazes (`src/social/props/`)

Tudo procedural (geometria + canvas), sem modelos externos. O design nunca muda a geometria: só a textura.

| Arquivo | O quê |
|---|---|
| `props/grips.ts` | pegadas (puro, testado): modo de cada item (`bone` / `upright` / `two_hand` / `waist`), centro e eixos do punho medidos no rig, posição aproximada na multidão distante, ações que erguem/balançam, LOD do tecido |
| `props/propGeometry.ts` | modelos compartilhados por (tipo, `near`/`far`): parte rígida numa malha só (cor + rugosidade/metalicidade por vértice → 1 draw call) + partes com design (tecido, face de cartaz) com transformação e tamanho |
| `props/propMaterials.ts` | material único de corpo, shader de tecido, materiais de design com contagem de referências, vento global (`setPropWind`) |
| `PropAttachment.ts` | itens na mão de um personagem com esqueleto (via `HumanCharacter.setSocial` → `updateProps(dt)` depois da animação) |
| `props/PropInstancer.ts` | itens da multidão instanciada (tier 1) — gancho em `CrowdDirector.end` |
| `props/BigFlag.ts` | `createBigFlag` (mastro 7 m, bandeira 6 × 4,2 m) e `createStaticBanner` (faixa entre dois mastros) para palco, trio e avenida |

**Pegada.** Itens de uma mão (bandeira pequena, megafone, apito, taco) são filhos do osso `hand_r` com o quadro do
punho fechado (`HAND_GRIP`: o cabo sai pelo lado do polegar, +Z = dedos) — o balanço vem da animação. Itens de duas
mãos (cartazes, faixa, bandeira grande) têm o quadro RECALCULADO a cada quadro a partir das duas mãos (cadeia de
matrizes locais até o `root`, sem atualizar o esqueleto inteiro): servem para qualquer pose de carregar. Cartaz
pequeno = papelão pela borda de baixo; cartaz grande = placa de espuma num sarrafo; placa dupla = cavalete; faixa =
um mastro curto em cada mão, pano com a largura entre as mãos; bandeira grande = mastro passando pelas duas mãos;
percussão = surdo na cintura com alça até o ombro e baqueta na mão direita. Taco: **só visual** (nenhum golpe/dano).

**Tecido sem física.** Vertex shader: onda viajante a partir do mastro com amplitude crescendo para a ponta,
ondulação secundária e rajada lenta, queda com vento fraco, fase pela posição no mundo; normais pelas derivadas
analíticas; dupla face com o U espelhado no verso (texto legível dos dois lados). O pano gira em torno do mastro para
ficar a favor do vento relativo (vento global − velocidade do portador). LOD: perto = malha subdividida + 2 ondas;
esqueleto distante = poucos segmentos + 1 onda (`cheap`); multidão = instanciado com atlas.

**Multidão instanciada.** Uma `InstancedMesh` por tipo de peça (rígidas por tipo, tecido de bandeira, faixa, face
de cartaz, lona do guarda-chuva): ≤ 15 draw calls para qualquer número de agentes. Design pela célula do atlas por
instância (`aCell`); os atlas são refeitos quando o registro de designs cresce (campanhas chegam dos dados depois).
Ação de erguer sobe o item; de balançar, oscila. QA: `?crowdProps=0..1` dá itens a essa fração dos agentes.

**Como acrescentar um design**: nada de código — entrada em `designs.ts` (neutros) ou em
`public/designs/campaigns.json` (campanhas), com `targets` incluindo `flag`/`sign`/`banner`.
**Como acrescentar um item**: `PropDefinition` em `props.ts` (id novo) → pegada em `PROP_GRIPS` e posição em
`FAR_PLACEMENT` (o teste `tests/props.test.ts` falha se faltar) → construtor em `propGeometry.ts` (`BUILDERS`) →
pose de carregar no animador.

**Integração.** Personagem: `human.setSocial({..., prop, design})` e, depois de animar, `human.updateProps(dt)` (já
feito em `AvatarVisual` e nos pedestres). Multidão: preencher `CrowdAgent.prop/design/act`. Cenário:
`createBigFlag({ design })` → `scene.add(f.object)`, `f.update(dt, camera)` por quadro, `f.dispose()`.
Vento: `setPropWind(dirX, dirZ, força)`.

**Custo medido** (`dev/props.html` num Mac com Metal, `tools/qa/props_shot.mjs`; draw calls incluem o passe de sombra):

| Cenário | Draw calls | Triângulos | Memória |
|---|---|---|---|
| 1 bandeira grande na mão (perto) | +3 (rígida + sombra + tecido) | +2,7 k | textura do design 731 × 512 (~2 MB c/ mipmaps) |
| 1 cartaz pequeno na mão | +4 (rígida e face, + sombras) | +0,3 k | textura 384 × 512 (~1 MB) |
| 200 agentes instanciados com itens (397 instâncias) | +13 | +25 k | 3 atlas (~2,2 MB) |
| 2 bandeiras de cenário (6 × 4,2 e 4,5 × 3,1 m) + 1 faixa de 6 m | +8 | +9,5 k | uma textura 512 por design |
| no jogo (pedestres com `?crowdProps=1`) | +14 | +1,7 k | sem mudança de FPS (60) |

Página de desenvolvimento: `/dev/human.html?prop=flag_large&design=brasil&cam=wide` (com `&hold=0` desliga a pose de
segurar improvisada da página) e `/dev/props.html?n=200&held=sign_small&big=1&cam=crowd|big|held`.

Limitações: sem colisão do tecido com o corpo ou com outros itens; a faixa de UMA pessoa estica o pano entre as mãos
(entre duas pessoas: `createStaticBanner` posicionado pelo integrador); durante a queda/ragdoll os itens de duas mãos
ficam na última pose; a bandeira de cenário não projeta sombra do tecido.
