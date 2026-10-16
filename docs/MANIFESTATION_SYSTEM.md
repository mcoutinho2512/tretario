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

Rede: `NetPlayer.act/actAt/actVar/prop/design`; mensagens `act {a, v}` e `prop {p, d}` (servidor valida e grava).
