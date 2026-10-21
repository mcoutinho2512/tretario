# Veículo pessoal — "selecionou → aparece" (rodada 12, AGENTE B)

Antes: escolher PATINETE na barra de ações respondia "há um patinete a 83 m" e marcava o mapa. Agora, como o
taco/barra/spray: **selecionou → aparece**. Patinete e bicicleta surgem praticamente junto ao avatar, a moto muito
perto, o carro no ponto seguro mais próximo da pista — e o jogador já está montado. Nunca "seu carro está a 180 m".

## Peças

| Arquivo | Papel |
|---|---|
| `src/vehicles/personal.ts` | **contrato** (master): `PersonalKind`, `pveh_req` → `pveh_ok` / `pveh_denied`, `PERSONAL_RULES`. Acréscimos: `PERSONAL_AUTOMOUNT_MAX_M`, `PERSONAL_ID_PREFIX`, `PERSONAL_LABEL`, `PERSONAL_DENY_TEXT`, `isPersonalKind` |
| `src/vehicles/personalSpawn.ts` | ponto de surgimento **puro** (`findPersonalSpawn`, `personalCandidates`, `boxDist`, `entryDistance`) — servidor e modo offline |
| `server/src/vehicles/PersonalVehicles.ts` | política, taxa e ciclo de vida no servidor; **`spawnPersonalVehicle(ownerId, kind, at?, opts?)`** reutilizável (autônomos) |
| `server/src/vehicles/surfaceIndex.ts` | chão do mundo no servidor (pista × calçada × bloqueado + objetos do chão) a partir dos mesmos chunks do cliente |
| `server/src/PresidenteVargasRoom.ts` | bloco `// rodada 12 — veículo pessoal`: mensagem `pveh_req`, host do módulo; `onEnter`/`onExit` viraram `mountVehicle`/`dismountVehicle` (o MESMO caminho para os dois) |
| `src/vehicles/PersonalVehicleClient.ts` | cliente: pedido, resposta, veículos que surgem/somem, offline |
| `src/vehicles/Rideable.ts` | `addDynamic` / `removeDynamic` (mesmo modelo/cache das vagas), `owner`, `selfId` (pessoal de outro não é "usável") |
| `tests/personalVehicles.test.ts` · `tests/personalVehiclesServer.test.ts` | puro (ponto, taxa, troca, ociosidade, inventário) · sala real com clientes forjados |
| `tools/qa/personal_vehicles_mp.mjs` | 2 navegadores reais (Chrome); capturas `docs/screenshots/round12/L…P`, números em `docs/bench/round12_personal_vehicles.json` |

## Sem sistema paralelo

O veículo pessoal é um `NetVehicle` comum em `state.vehicles` com `owner = sessionId do dono` (`''` = veículo do
mundo). Mesma área de interesse (grade `vgrid` — ele entra na grade **na hora** e quem está perto recalcula a AOI, não
espera a fatia/1 Hz), mesmo movimento validado (`onMove`), mesma montagem (`mountVehicle`, que conta a missão
`vehicle_enter`) e a mesma saída segura da rodada 10 (`dismountVehicle` → `findSafeExit`). Os slots da grade de
veículos agora são reaproveitados (`vehFree`). O retorno à vaga (`resetAbandoned`) ignora pessoais (não têm vaga).

## Fluxo

```
cliente (barra / inventário / acesso rápido)  ──pveh_req {kind, seq}──▶  sala ─▶ PersonalVehicles.request
   taxa ─▶ espectador? ─▶ tipo ─▶ evento permite? ─▶ estado (a pé, não caído, não no trio, não em veículo do mundo)
   ─▶ dono a bordo do pessoal anterior? desce com segurança (exit_ok) ─▶ findPersonalSpawn ─▶ remove o anterior
   ─▶ cria NetVehicle (owner) ─▶ entrada perto? monta (mountVehicle) ─▶ pveh_ok {id, kind, x, z, heading, mounted, replaced?}
cliente: cria a instância JÁ pela resposta (não espera o patch) e, montado, `mountLocal` (animação da rodada 10)
remotos: onAdd do estado (owner) → mesma instância/modelo; o avatar remoto entra pela mesma MountTracker
```

## Ponto de surgimento (`findPersonalSpawn`)

Anéis de `spawnDist[kind]` até `spawnMaxDist[kind]` (passo 0,35 m patinete/bicicleta, 0,5 m moto, 0,8 m carro); em
cada anel, 16 direções em ordem de preferência (lados antes da frente — não nasce no caminho; atrás por último); para
cada direção, rumos paralelos ao avatar (carro também atravessado, porta do motorista virada para o avatar primeiro).
A **caixa** do veículo (`VEHICLE_BOX`, 9 pontos: centro, cantos, meios) precisa:

- estar dentro do mapa (margem 2 m);
- estar toda sobre chão permitido — **carro e moto: só pista** (`sidewalk: false` de `RIDEABLE_DEFS`); patinete e
  bicicleta: pista ou calçada. Nunca prédio, água, plataforma ou brita;
- não cruzar parede: avatar → centro e centro → cada ponto sem parede (gradil entre a calçada e a pista conta: o carro
  não "atravessa" para a pista do outro lado);
- não encostar em veículo (caixas orientadas, folga 0,35 m), pessoa (todos de `state.players` — humanos, autônomos,
  em graça — com `BODY.radius` + 0,15 m; o próprio dono com `BODY.radius` + 0,12 m: nunca nasce dentro dele) nem
  objeto (postes, bancos, pontos de ônibus, bancas — dos chunks; bonecos de treino; cenário de evento).

Nada até `spawnMaxDist` → `sem_lugar` ("Sem lugar seguro aqui — ande um pouco; carro e moto só na pista"). A moto
procura pista até 14 m, como o carro (antes 6 m: em praças, como a da Candelária e o ponto de uma torcida na Central,
dava "sem lugar"); longe da porta (> 3 m) ela aparece ao lado e o E monta.
A multidão de AMBIENTE (pedestres NPC do cliente) não existe no servidor: ela desvia sozinha.

### Chão no servidor
O cliente rasteriza as superfícies (`CollisionWorld`); o servidor faz ponto-em-polígono (par-ímpar, com furos) sobre os
mesmos chunks, numa grade de baldes de 16 m, e só quando alguém pede um veículo (nada por tick). Precedência igual à do
cliente; galerias contam como prédio (conservador). 8 401 polígonos e 1 673 objetos, carregados em ~50 ms uma vez por
processo — a sala aquece logo depois de criada (`clock.setTimeout(…, 0)`), fora do caminho do 1º pedido.

## Política

| Regra | Decisão |
|---|---|
| ativos por jogador | **1** (`maxActivePerPlayer`). Outro tipo **substitui**: se o dono está nele, desce com segurança (`exit_ok`) e o novo nasce perto de onde desceu; depois o anterior é removido (`pveh_ok.replaced`) |
| mesmo tipo de novo | montado nele: nada (devolve o atual). Não montado: surge de novo perto (troca de lugar) |
| em veículo do mundo / no trio | `estado` — desça primeiro |
| caído | `caido` · espectador: `espectador` · tipo fora de `PERSONAL_KINDS`: `tipo` · evento restringe (`EventDef.vehicles`): `evento` |
| **quem usa** | **só o dono**, nunca outros (`enter_denied 'pessoal'`; no cliente o pessoal de outro não aparece como alvo de E/clique nem em `nearest`). Motivo: sem disputa/roubo, sem "vaga" para guardar; quem quer um veículo pede o seu |
| taxa | todos os pedidos contam (até inválidos), ANTES de qualquer trabalho: `minIntervalMs` 2,5 s entre aceitos e no máximo `burstPer10s` = 4 pedidos em 10 s. Além disso o limite geral da sala (60 mensagens/s) |

### Carro: entra já ou interação? (decisão de UX)
A animação de montagem da rodada 10 anda até a porta em no máximo 45 % do `enterMs` (carro: 405 ms). Mais longe que
~3 m o corpo "desliza". Regra: **monta sozinho quando a entrada (porta/lado) está a ≤ `PERSONAL_AUTOMOUNT_MAX_M` = 3 m**
do avatar (o caso normal: o carro nasce a 3,2 m ao lado, porta virada para o avatar — QA: carro a 4,0 m do centro,
montado). Mais longe (avatar no meio de uma calçada larga, pista a 8–14 m) o carro **aparece ali**, o minimapa marca
"Seu carro" e o HUD diz "Carro disponível — ali do lado (9 m): E para entrar"; o E/clique usa o caminho normal do
`enter` (só o dono consegue). Vale para todos os tipos (patinete/bicicleta/moto quase sempre montam: 0,9–1,6 m).

## Ciclo de vida

| Situação | O que acontece |
|---|---|
| dono a bordo | fica (sem prazo) |
| dono desceu / está em outro veículo | some após `despawnIdleMs` (45 s; `PV_PVEH_IDLE_MS` em teste) — checado a 1 Hz |
| pediu outro tipo | o anterior some na hora (depois da descida segura) |
| queda de rede **dentro** da graça | o pessoal fica; o dono volta montado (`resume.vehicle`, rodada 10) |
| graça vencida / logout / sessão substituída | `removePlayer` → `release(owner)`: some na hora |
| servidor reinicia | nada é persistido (estado em memória) — volta só o mundo (vagas) |
| veículos do mundo (vagas) | inalterados: continuam, voltam para a vaga como antes |

## Números (mesma máquina, Chrome real, 2 navegadores — `tools/qa/personal_vehicles_mp.mjs`)

Seleção (clique/tecla) → `pveh_ok` em A (a instância é criada da resposta: **visível no mesmo quadro**) e quando B,
a 8 m, vê o veículo no estado (patch de 20 Hz + interpolação):

| Tipo | porta usada no QA | seleção → aparece (A) | B vê | distância avatar → veículo | montado |
|---|---|---|---|---|---|
| Patinete | barra → Veículos | 15 ms | 153 ms | 0,9 m | sim |
| Bicicleta | acesso rápido (tecla 4) | 5 ms | 66 ms | 1,1 m | sim |
| Moto | inventário → USAR AGORA | 2 ms | 66 ms | 1,6 m | sim |
| Carro (pedido da calçada larga) | barra → Veículos | 15 ms | 132 ms | 4,0 m (na pista) | sim |

Servidor real + cliente forjado (`tests/personalVehiclesServer.test.ts`, ida e volta): patinete 3,1 ms / 0,9 m ·
bicicleta 0,9 ms / 1,1 m · moto 1,0 ms / 1,6 m · carro 6,5 ms / 5,6 m (da calçada, pista a ~5 m). A busca do ponto
(servidor, mundo real): patinete/bicicleta/moto 0,15–0,4 ms (1º candidato) · carro da calçada 0,3–0,6 ms (65–69
candidatos) · pior caso, recusa `sem_lugar` com gradil entre a calçada e a pista: 2,2 ms (896 candidatos; chão e
parede do CENTRO testados uma vez por posição, não por rumo — antes 13,6 ms) — e no máximo 4 pedidos por jogador em
10 s (taxa, checada antes da busca).

Spam pelo console (100 pedidos forjados, 40/s): **máximo 1 pessoal ativo**, 99 recusas `taxa`. Abandono: some para A e
B em 5,7 s com prazo de 5 s (+ tick de 1 s).

Capturas: `L_patinete_aparecendo` (B, de lado: patinete surgindo junto de A, A subindo), `M_avatar_montado` (A
montado, HUD "Patinete disponível"), `N_bicicleta_imediata` (acesso rápido 4 aceso), `O_moto_imediata` (B vê A na
moto), `P_carro_imediato` (A no carro, na pista ao lado da calçada).

## Multiplayer

- Remotos veem surgir (onAdd com `owner` → `RideableSystem.addDynamic`), o avatar montar (MountTracker da rodada 10:
  `entering → mounted`), andar (interpolação de veículo remoto já existente), sair e o veículo sumir (onRemove →
  `removeDynamic`). Fora da área de interesse também some (e volta ao entrar de novo).
- Cada instância usa o modelo em cache (clone raso): nenhum buffer novo por veículo pessoal.

## Para o AGENTE C (autônomos)

```ts
room.r12pv.spawnPersonalVehicle(ownerId, 'bicycle', at?, { mount?: boolean })
// → { ok: true, id, kind, x, z, heading, mounted, replaced?, d, ms } | { ok: false, kind, reason }
```

Sem taxa (quem chama decide a frequência), com as MESMAS validações de chão/paredes/corpos/objetos e a mesma política
(1 por dono, troca remove o anterior, ociosidade). O dono pode ser qualquer entidade de `state.players` (não precisa de
conexão): `mountVehicle`/`dismountVehicle` toleram entidade sem `PlayerRT`. `release(ownerId)` remove na hora.

## Pendências
- Passageiro no pessoal (segue a pendência de assentos da rodada 10).
- Cor do pessoal: a paleta das vagas por hash do id (sem escolha do jogador).
- Pedestres de ambiente (só cliente) podem cruzar o veículo recém-surgido por um instante (eles desviam).
