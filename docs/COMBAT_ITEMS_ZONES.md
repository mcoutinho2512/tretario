# Confronto (rodada 9) — itens no mundo, estados físicos, zonas, proteção e desorientação (parte do agente B)

> Para ser incorporado em `docs/COMBAT.md`. O sistema de golpes (CombatSystem: ações, alcance, stamina, condição,
> pulo, HUD de confronto, boneco de treino) é do agente A; esta parte entrega o que ele consome: itens, clipes,
> política de zona, áreas de paz, proteção de retorno e os visuais de estado.

Estilo arcade, valores de JOGO: sem lesão, sem sangue, sem morte, sem arma de fogo/explosivo. Nenhuma diferença
mecânica entre grupos. O cliente só manda intenções; o servidor decide.

## 1. Itens de confronto: a MESMA tabela de props

`src/social/props.ts` ganhou `category?: 'SOCIAL' | 'COMBAT_PROP'` (ausente = SOCIAL) — não há registro paralelo.

| id | kind | rótulo | pegada | carregar | clipes de ataque (para as CombatActionDefinitions) |
|---|---|---|---|---|---|
| 11 | `bat` | Taco | `hand_r`, osso da mão | `carry_bat` | `swing_bat` |
| 12 | `bar` | Barra de ferro | `hand_r`, osso da mão | `carry_bar` | `swing_bar` |
| 13 | `spray` | Spray de pimenta | `hand_r`, osso da mão | `carry_spray` | `spray_use` |

- Geometria procedural (`propGeometry.ts`): barra = tubo de aço de 0,8 m com empunhadura de borracha e tampas;
  spray = lata pequena GENÉRICA (laranja, faixa clara SEM texto, tampa-gatilho preta) — sem marca, sem rótulo.
- `FAR_PLACEMENT`: barra como o taco; spray `null` (pequeno demais de longe, como o apito). Itens de confronto
  têm `crowdWeight: 0` e são filtrados da multidão (`crowdSocial.ts`) — NPC nunca carrega.
- `isCombatProp(id)` e `SOCIAL_PROPS` (o que a roda de ações oferece a qualquer um).
- Clipes (`proceduralClips.ts`, camada `upper`): `swing_bat` 0,9 s, `swing_bar` 0,85 s, `spray_use` 1,2 s,
  `stagger` 0,8 s, `disoriented` 2,4 s (loop), `carry_bar`, `carry_spray`. Tocar um clipe avulso:
  `AvatarVisual.playCombatClip(name)` → `HumanAnimator.playClip(name, loop?)` (camada `fx`, por cima da locomoção e do
  item; `stopClip(name?)` encerra com crossfade; as ações sociais não apagam essa camada).
- Fragmento de dados `public/gameplay/combat_props.json`:
  `props: [{ propId, kind, actions: [], groundTtlMs }]` — o carregador de `combat.json` (agente A) mescla e preenche
  `actions`; `supply` (abaixo) é dos itens no mundo.

## 2. Equipar, guardar, pegar, largar, trocar

Item de confronto **não sai do nada**: só de um ponto de apoio ou do chão. Cada jogador POSSUI no máximo um.

| intenção | tecla | toque | mensagem | servidor |
|---|---|---|---|---|
| pegar (perto) / trocar | R | tocar em MÃOS | `item_pick {i}` | alcance 2,2 m da posição aceita; já possuindo, o atual cai aos pés; vai para a mão |
| largar | Z (R sem nada perto) | tocar em MÃOS | `item_drop {}` | 0,7 m à frente (sem atravessar parede); mão esvazia se era ele |
| guardar / sacar | X | roda (ITENS) | `prop {p: 0}` / `prop {p: c}` | `validateProp`: item de confronto só se `carried === p` |

- Negativas `item_denied`: `inexistente`, `longe`, `ocupado`, `sem_item`, `caido`, `em_veiculo`, `rapido` (200 ms),
  `invalido` — texto em `ITEM_DENIAL_TEXT`.
- **Queda**: quem fica DOWN/RAGDOLL larga o item possuído onde caiu (servidor, no tick); saída / graça vencida / sessão
  substituída também (o item não "passa" para a sessão nova).
- Indicador **MÃOS / ITEM ATUAL** (`src/ui/hud/HandIndicator.ts`, encaixe `HudShell.mountHand`): "Vazias", o item na
  mão (âmbar quando é de confronto), "Spray guardado", e a dica (T pegar · Z largar · X guardar). Some com o HUD;
  só escreve no DOM quando o texto muda.

### Itens no mundo (`server/src/items/GroundItems.ts`, `RoomItems.ts`)
- Estados `RACK` (na vaga do apoio) · `GROUND` (largado) · `CARRIED`. Total FIXO (soma dos estoques).
- Largado expira em `groundTtlMs` (taco/barra 90 s, spray 60 s) e **volta à vaga**; acima de `maxGround` (10)
  largados, o mais antigo volta já.
- `item_list` (plano `[id, prop, x·10, z·10, estado]`): itens a ≤ `aoiM` (70 m), comparados por assinatura e enviados
  **só quando mudam para aquele cliente**, fatiado (cada cliente a 2 Hz). Longe dos apoios = nada enviado (500 bots
  espalhados não mudam a banda normal).
- Pontos de apoio (`supply.racks`): Cidade Nova (2), Campo de Santana, Rio Branco — todos em CONFRONTO/DISPUTA, longe
  do spawn, do palco e do trio. Cliente: estrado de madeira procedural + itens deitados lado a lado
  (`src/items/GroundItemsView.ts`); largado tem um anel discreto no chão.

## 3. Estados físicos (visual)
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

## 4. Zonas: política de confronto (dados)

| zona | política | por quê |
|---|---|---|
| Cidade Nova | **COMBAT** | ponta oeste, longe do evento — quem quer confronto vai até lá |
| Central do Brasil | **PEACE** | entrada/spawn |
| Campo de Santana | **CONTESTED** | só durante evento de confronto ativo |
| Centro | **PEACE** | a passeata e o trio |
| Av. Rio Branco | **CONTESTED** | idem (o palco tem área de paz) |
| Candelária | **PEACE** | chegada do ato |

~60 % do eixo é PAZ, mais as áreas de paz. Fora de qualquer zona = PEACE.

**Áreas de paz** (`PeaceArea`):
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
salmão); a legenda do minimapa diz "· paz / disputa / confronto"; o minimapa tinge fraco a faixa das zonas de
confronto (vermelho) e disputa (âmbar) — camada estática, custo zero por quadro.

## 5. Proteção de retorno
- `server/src/combat/protection.ts`: `applyProtection(p, now, ms)` puro (`{fx, protectedUntil}`), `ProtectionService`
  por conexão (`apply/protectedUntil/isProtected/clear/tick`). Duração = `tuning.protectMs` de
  `public/gameplay/combat.json` se existir, senão 4000 ms.
- A sala aplica ao **entrar** e ao **reconectar**; `room.applyProtection(sid, now?, ms?)` para o CombatSystem
  (depois de levantar) e para o runner de eventos (retorno). Expira no tick (bit FX.PROTECTED desligado).
- Visual: casca translúcida com faixas lentas subindo (`src/combat/fxVisuals.ts` ProtectedAura — geometria e material
  únicos, brilho ≤ 0,16, pulso lento de pequena amplitude: sem piscar).

## 6. Desorientado (spray)
- Só para quem sofre: véu de tela CSS (`DisorientOverlay`) — desfoque 2,5 px, dessaturação, vinheta; entra e sai em
  0,6 s; sem flash, sem tremor. O DOM só muda na troca de estado.
- Reação no personagem (todos veem): `disoriented` em loop enquanto o bit FX.DISORIENTED está ligado (mãos diante dos
  olhos, cabeça baixa — nada de lesão).
- Acessibilidade: **Ajustes → "Reduzir efeitos visuais"** (`reduceEffects`): só um ícone pequeno ("Visão turva") e um
  tom leve. Guardado como as outras preferências do HUD (localStorage + perfil: `PlayerPreferences.reduceEffects`,
  `sanitizePreferences` no servidor).

## 7. QA
- Vitest: `tests/props.test.ts` (registro/pegadas/modelos), `tests/proceduralClips.test.ts` (clipes de confronto),
  `tests/zonePolicy.test.ts` (dados reais, anel móvel do trio, retorno de evento, integração com `combatAllowed`),
  `tests/combatItems.test.ts` (alcance, troca, expiração/volta, teto, saída/queda, protocolo, posse na mão,
  proteção, FallSync, preferência).
- `tools/qa/items_zones_mp.mjs` — 2 navegadores, servidor PV_TEST próprio (porta 2971, evento `cotidiano` para o
  empurrão): proteção, apoio, pegar/largar/pegar do chão, troca barra/spray, guardar/sacar, desorientação normal e
  reduzida, cambaleio, queda só por status, empurrão (uma queda só), larga ao cair, Rapier liberado, aviso de zona
  paz/disputa/confronto. Efeitos que o CombatSystem aplicará de verdade são forçados pelas mensagens `qa_fx` /
  `qa_status`, que **só existem com PV_TEST=1**.
- Capturas: `docs/screenshots/round9/` E_taco, F_barra, G_spray (+ desorientado normal/reduzido), H_queda_ragdoll,
  J_zona_de_paz, K_zona_de_confronto.
