# Sistema de equipamentos (rodada 11)

Como o inventário (docs/INVENTORY.md) transforma "equipar X" num pedido que o SERVIDOR valida. Regras puras em
`src/inventory/equipRules.ts` (o servidor importa `lockedAppearanceItems` e `validateTitle`).

## Slots (`EquipSlot`, src/inventory/types.ts)

| slot | o que ocupa | campo de verdade | incompatibilidades |
|---|---|---|---|
| HEAD | cabelo | `hairStyle` | — (boné/chapéu sobre crespo é permitido, como no editor) |
| TORSO | parte de cima ou camisa estampada | `topStyle` + `shirtDesign` | estampa só no modelo camiseta: equipar estampa veste a camiseta; outra parte de cima tira a estampa |
| LEGS / FEET | parte de baixo / calçado | `bottomStyle` / `shoeStyle` | só o que o corpo veste (`resolveStyle`) |
| ACCESSORY | um acessório | `accessory` | um por vez (campo único) |
| HAND | item segurável, arte de mão ou equipamento de confronto | `NetPlayer.prop` + `design` | **uma coisa na mão**: o novo substitui o anterior; o de confronto possuído fica guardado (como o X) |
| TITLE | título equipado | `NetPlayer.title` / `Profile.titleKey` | um |
| SUPPORTER | torcida | `NetPlayer.sup` / `Profile.supporterGroup` | uma (neutro = desequipar) |
| BACK | reservado no contrato; nenhum item usa hoje | — | — |

Uma peça por slot é garantida pelo próprio estado (um campo por slot) — duas camisas ou dois itens na mesma mão são
impossíveis por construção. Arte de mão: se o item na mão aceita a arte, troca só a arte; senão pega o primeiro
item que aceita (bandeira → cartaz → faixa).

## O que o servidor recusa (cliente forjado / DevTools) — tests/inventoryServer.test.ts

| pedido forjado | resposta |
|---|---|
| `PUT /api/me/appearance {strict:true}` com camisa/peça/acessório bloqueado | 403 `bloqueado` + `items` (nada gravado); sem `strict` o validador troca pelo padrão (sem vantagem) |
| `prop` com arte bloqueada | `prop_denied 'bloqueado'` |
| `prop` com item de confronto sem posse (sem `freeCombatProps`) | `prop_denied 'sem_item'` |
| `prop` com item inexistente | `prop_denied 'item_invalido'` |
| `title {t}` / `PUT /api/me/title` com título não ganho | `title_res {ok:false, reason:'bloqueado'}` / 403 `bloqueado` |
| título não-texto ou longo demais | `invalido` / 400 `titulo_invalido` |
| `sup` inválido / em cooldown | regras da rodada 10 (`torcida_invalida`, `cooldown`) |

Mensagem `title` tem intervalo mínimo de 400 ms por conexão e exige `profile.edit`. Título salvo é revalidado na
entrada (grant inexistente → nenhum).

## Equipamentos de confronto

Taco, barra e spray aparecem em EQUIPAMENTOS e cabem no acesso rápido. Disponível = `freeCombatProps` (dados,
`combat_props.json`) ou o item que o servidor diz que a pessoa POSSUI (`item_self`); senão bloqueado com "Pegue num
ponto de apoio". Usar sem posse → "Você não possui este item." (o servidor recusaria igual). Em zona de paz o item vai
para a mão, mas o aviso diz "Taco não pode ser usado nesta zona." — o golpe continua decidido pela política de zona do
servidor (docs/COMBAT.md).

## Rede (novos campos públicos)

`NetPlayer.lvl` (u8, 0 = desconhecido) e `NetPlayer.title` (texto ≤ 48, '' = nenhum), acrescentados no fim do schema;
lidos pelo painel da pessoa (`publicProfile`). Privacidade: docs/PRIVACY_ARCHITECTURE.md.

## Missões

Equipar bandeira/cartaz pelo inventário ou acesso rápido manda o mesmo `prop` de sempre; o emissor `prop {kind,
slot}` (server/src/progression/emitters.ts) conta para ENTRE NO CLIMA (`bandeira`) e VOZ NA AVENIDA (`cartaz`).
