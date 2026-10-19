# Corpo no veículo — montagem, transições, saída segura (rodada 10, AGENTE C)

Antes: o avatar ficava "posado" sobre o veículo (clipes `drive`/`sit` + `pedal()` procedural), sem entrar/sair,
guidão nem pés no lugar; no carro ele ficava no centro, escondido atrás de vidros opacos.
Agora o corpo vai **fisicamente** para o banco, com entrada e saída visíveis, mãos no volante/guidão, pés nos
pedais/pedaleiras/plataforma, e o mesmo resultado para o motorista e para quem olha.

## Peças

| Arquivo | Papel |
|---|---|
| `src/vehicles/seats.ts` | **contrato** (SeatRole, MountPose, SeatAnchors, MountProfile, MountPhase) + `MOUNT_PROFILES` (dados por tipo), `MountRig` (dinâmica), `MountTracker` (fase), `seatOf`/`mountProfile` |
| `src/characters/human/vehicleClips.ts` | solver por avatar: raiz no banco + IK de 2 ossos + dinâmica por tipo; `mountWeights` (transições), `vehicleMatrix` |
| `src/vehicles/exitSafety.ts` | saída segura (pura) — servidor e cliente offline |
| `src/vehicles/Rideable.ts` | modelos com grupo `steer` (guidão/garfo/roda dianteira; volante no carro) e `crank` (pedivela); `RideableInstance.dyn` (inclinação, esterço, pedivela, velocidade, aceleração) calculado em `RideableSystem.sync` |
| `src/traffic/vehicleModels.ts` | `getVehicleSplit('sedan')` (carroceria sem vidro + vidro) e `vehicleGlassMaterial(near)` |
| `src/player/AvatarVisual.ts` | `updateRiding(..., src)` → caminho de montagem; `update()` faz a saída; `mountInfo`/`mountBusy`/`mountCost` |
| `src/characters/human/HumanAnimator.ts` | `updateRiding(pose, speed, dt, mount?: RideMount)` — clipe-base do perfil + gancho `solve` depois do mixer |

Convenção do referencial local (âncoras): **y para cima, z para a frente, +x = ESQUERDA do motorista** — a mesma do
modelo three.js com `rotation.y = heading` e de `localToWorld` (o comentário original do contrato dizia "x à direita";
foi corrigido, nada foi renomeado).

## Como funciona (todos os tipos)

1. **Fase** (`MountTracker`, puro e testado): derivada só da mudança do id do veículo — `none → entering → mounted →
   exiting → none`, com `enterMs`/`exitMs` do perfil. Local e remotos usam a mesma regra; **nenhum osso vai para a rede**.
   Avatar recém-criado (pool de remotos, reconexão) já montado começa direto em `mounted` (sem animação falsa).
2. **Raiz**: a pelve vai à âncora `hip` do banco; a raiz do avatar recebe a matriz do veículo **como este cliente o
   desenha** (posição, rumo e inclinação de curva) — o corpo não "escorrega" do banco, nem no remoto.
3. **IK leve de 2 ossos** (analítico, vetor polar, preserva o plano da articulação): braços até `handL/handR` (que
   giram com o esterço em torno de `steerPivot`/`steerAxis`) e pernas até `footL/footR`. O tronco inclina o necessário
   para as mãos alcançarem (ângulo resolvido no círculo do peito, limitado por `torso`); o pescoço compensa (olhar na
   via) e a cabeça vira um pouco para a curva; punho reto na pegada; sola alinhada ao pedal.
4. **LOD**: o IK roda só para quem está perto (`HumanAnimator.detail`, LOD ≤ 1); de longe só a raiz (pose do clipe).
   Ossos ajustados voltam à pose do clipe no quadro seguinte (`saveAdjusted`).
5. **Dinâmica visual** (`RideableSystem.sync`, pelo deslocamento — igual para todos): velocidade/aceleração estimadas,
   esterço (pelo giro; o motorista local usa a própria entrada → guidão gira até parado), inclinação nas curvas
   (`atan(v·ω/g)`, limitada por `leanMax`, só ocupado) e pedivela.

## Por veículo

| | Carro (sedan) | Moto | Bicicleta | Patinete | Cabine (carro de som / trio) |
|---|---|---|---|---|---|
| **Entrada** (`enterMs`) | anda até a porta (lado mais próximo), **senta na soleira de costas para fora** (mãos nos joelhos, pés no chão), gira e desliza para o banco; 900 ms; `sfx('veh_door')` | anda até o lado, passa a perna (mãos já no guidão), senta; 650 ms; `sfx('veh_mount')` | idem; 550 ms | idem, sobe na plataforma; 420 ms | como o carro, pela porta da cabine; 800/900 ms |
| **Pose** | sentado (clipe `drive`), motorista à esquerda; cabeça e tronco visíveis pelos vidros | `sit` + tronco inclinado, mãos nas manoplas, pés nas pedaleiras | `sit` + tronco inclinado, mãos no guidão recuado | em pé (`idle`) na plataforma, pé esquerdo na frente | `drive` no banco da cabine |
| **Animação** | volante gira com o esterço (mãos acompanham até ±0,9 rad); pé direito "pisa" ao acelerar | inclina na curva com a moto; tronco para a frente ao acelerar / para trás ao frear; **parada: pé esquerdo no chão** | **pedivela gira pela distância** (4,8 m por volta, ~70 rpm a 20 km/h) e os pés seguem os pedais (tornozelo varia no giro); **desliza = pedal parado**; inclina na curva | **impulso**: acelerando devagar (< 3,2 m/s) o pé de trás desce, empurra o chão para trás e volta; o joelho de apoio dobra; inclina pouco | mãos no volante (sem modelo de volante) |
| **Câmera** (`camera`) | 7,4 m / pivô 1,85 m | 4,9 / 1,55 (mais perto) | 4,6 / 1,5 (corpo inteiro) | 4,4 / 1,5 | 10 / 2,6 · 17 / 4,2 |
| **Controle** | só anda depois de sentar (`mountBusy`); resto inalterado | inalterado | inalterado | inalterado | inalterado |
| **Saída** (`exitMs`) | inverso: desliza para a soleira, gira para fora, levanta no ponto do servidor; 750 ms | inverso; 550 ms | 450 ms | 380 ms | 700/800 ms |

Celular (ponteiro grosso): a câmera fica 10 % mais longe montado — corpo e veículo não somem atrás dos controles.

**Rodada 11 — câmera ao dirigir no desktop (cursor sempre visível; `src/camera/vehicleCam.ts`, docs/DESKTOP_CONTROLS.md):**
dirige-se com W/S/A/D e o cursor continua na tela. A câmera acompanha o rumo suavemente (carro 2,2/s; moto, bicicleta,
patinete, carro de som e trio 1,5/s; parado sem olhar em volta, fica onde está). **Botão direito arrastando = olhar em
volta**: enquanto segura, nada puxa a câmera; ao soltar, espera 1 s (`RETURN_DELAY_MS`) e volta para trás do veículo
com suavização — mesmo parado. Chrome: 0,5 s depois de soltar ainda 1,26 rad fora do rumo; 2,4 s depois, 0,04 rad.
SAIR: botão do HUD do veículo (clicável) ou **E**. Testes: `tests/desktopInput.test.ts` (câmera de veículo).

### Carro visível
O sedan do trânsito tem vidros opacos e nenhum interior. O carro **dirigível** agora usa a carroceria sem os vidros
(`getVehicleSplit`) + vidro translúcido (opacidade 0,3, reflexo, duas faces) + interior simples: "banheira" escura
vista por dentro (`BackSide`, esconde o vazio da carroceria), bancos/encostos/painel/console (1 geometria) e volante
(grupo `steer`). De longe (> 45 m) o interior some e o vidro volta a ser opaco (sem custo). Carros do **trânsito
NPC** não mudam.

### Cabines do trio e do carro de som
As cabines são caixas opacas (eventModels.ts): o motorista fica posado no banco (pose `cab_seat`) mas não aparece de
fora. Abrir as cabines é pendência (modelo do evento, fora desta rodada).

## Assentos / passageiros
A arquitetura é por `seats[]` com `SeatRole` (o solver e o perfil não assumem um ocupante fixo), mas **só DRIVER
existe nesta rodada**: no servidor `NetVehicle.occupant` continua sendo o motorista (rede/banco/testes inalterados).
Passageiros exigiriam: lista de ocupantes no estado (`NetVehicle`), regras de entrada por assento, saída por assento e
AOI/reconexão por assento — **não é seguro fazer junto com o resto da rodada 10**; fica documentado como próximo passo
(acrescentar `PASSENGER_*` em `MOUNT_PROFILES` + um campo novo no fim do estado, sem renomear nada).

## Saída segura (servidor — `onExit`)
`findSafeExit(kind, pose, world, {vehicles, people})` testa em ordem: **porta do motorista**, **outro lado**,
**frente**, **trás**, **anel** de 12 direções a 1,2× e 1,8× em volta da carroceria. Vale o primeiro que:
- está dentro do mapa (`manifest.bounds`, 1 m de folga);
- tem caminho do **banco** até ele sem parede (`walls.raycast` a 0,6 m — nunca sai do outro lado de um muro);
- não cai dentro da carroceria do próprio veículo nem de outro (caixa + 0,35 m; bicicleta/patinete por raio);
- fica a ≥ 0,65 m de toda pessoa a pé por perto (multidão sólida — jogadores na grade do servidor; offline: pedestres).

Sem candidato livre: aceita perto de pessoa, depois perto de veículo; encurralado entre paredes, fica no banco. A
função é pura e determinística (mesma entrada → mesma saída); o servidor passa campos explícitos (o `Schema` do
Colyseus expõe campos por getter — espalhar `{...v}` perdia x/z; coberto por teste).

## Ocupação, abandono, reconexão
Inalterados e cobertos por teste: AVAILABLE/OCCUPIED/RESETTING; veículo abandonado longe da vaga volta (RESETTING →
vaga); queda **dentro da graça** → o jogador fica congelado no veículo (ninguém rouba), volta pelo token com
`resume.vehicle` e o cliente segue montado (sem nova animação de entrada, sem avatar/veículo duplicado); **fora da
graça** → `removePlayer` libera o veículo (AVAILABLE, que depois volta à vaga) e a nova sessão nasce a pé.
Modo pacífico/proteção: regras de impacto inalteradas (`vehicleBlock`, `impactAllowed`; zones.json/combatConsent não
mudaram).

## Testes e QA
- `tests/vehicleMount.test.ts` (15): perfis completos, carro visível pela geometria, `MountTracker` (fases, reentrada,
  troca de veículo, snap), saída segura (porta, parede → outro lado, parede + carro → frente/trás, multidão na porta,
  borda do mapa, encurralado, todos ocupados, Schema por getter, determinismo).
- `tests/vehicleMountServer.test.ts` (4, servidor real na faixa 3300–3399): corrida pelo mesmo carro (só um entra,
  o outro `ocupado`); saída com alguém parado na porta; reconexão dentro da graça; queda fora da graça + retorno à vaga.
- `tools/qa/vehicle_mount_mp.mjs` (2 navegadores + 5 robôs SDK): **26/26** — por tipo, B vê A entrando, montado
  (pelve no banco erro 0; mãos < 0,12 m), andando (corpo preso ao banco; pedalada medida pelo pedivela), saindo, e de
  pé no ponto do servidor. `tools/qa/vehicle_mount_probe.mjs`: sonda offline com fotos de cada fase.
- Screenshots: `docs/screenshots/round10/` — `H_entrando_carro_*`, `I_dirigindo_*`, `J_saida_carro_*`, `K_moto_*`,
  `L_bicicleta_*`, `M_patinete_*` (visão de A e do OUTRO jogador B), sequências `*_sequencia_visao_B.jpg`
  (pedalada, impulso, partida da moto) e `N_custo_5_montados_visao_B.jpg`.

### Custo medido (MacBook, Chrome headless, quality=high; `vehicle_mount_mp.json`)
5 robôs montados perto do observador (4 motos + 1 carro): solver **0,050 ms por corpo** (raiz + IK de 4 membros +
tronco), **0,15 ms por quadro** no total; CPU do quadro 5,99 ms a pé → 6,10 ms montados → 5,74 ms depois (dentro do
ruído). Corpos longe (LOD ≥ 2) só posicionam a raiz.

### Clipping observado
- Carro: na entrada/saída o corpo atravessa a porta (fechada no modelo — "porta sugerida"); sentado, nada atravessa.
- Moto: joelhos encostam no tanque em curvas fechadas (inclinação máxima); calça não atravessa o banco.
- Bicicleta: a coxa passa rente ao tubo superior no ponto mais alto da pedalada em corpos baixos.
- Patinete: no impulso o pé de trás pode ficar alguns cm acima do chão em corpos baixos (alcance da perna).
- Corpos muito diferentes (crianças): o IK limita o alcance — mãos/pés podem não tocar o alvo (erro registrado em
  `mountInfo.solver.err`).

## Pontos em arquivos compartilhados (para integrar)
- `src/core/Game.ts` (blocos `// rodada 10 — montagem`): `rideables.smooth` antes de `net.update`;
  `net.vehicleSource`; no ramo montado `v.steerHint = -ax.x`, acelerador zerado enquanto `avatar.mountBusy` e
  `updateRiding(..., v)`; `dismountLocal` offline com `findSafeExit`; QA `__pv.mount()`, `mountCostReset()`,
  `vehicleDyn(id)`.
- `src/player/AvatarVisual.ts`: parâmetro final opcional `src` em `updateRiding`; `update()` chama `updateExit` logo
  depois de `updateFall`; `resetForReuse` limpa a montagem; nada mexido em golpe/queda.
- `src/characters/human/HumanAnimator.ts`: só `updateRiding` (+ tipo `RideMount`).
- `src/net/NetworkClient.ts`: `vehicleSource` e o último argumento do `updateRiding` dos remotos; `mountDebug()` (QA).
- `server/src/PresidenteVargasRoom.ts`: `onExit` usa `safeExitFor` (novo método) → `findSafeExit`; `lastExit` (QA).
- `src/camera/ThirdPersonCamera.ts`: `setProfile` lê `MOUNT_PROFILES[kind].camera`.
- Áudio: só `sfx('veh_door' | 'veh_mount')` nas transições; nenhum `audioLoop` (os laços são do AudioWorld do AGENTE D).

## Veículo pessoal (rodada 12)
O veículo pessoal ("selecionou → aparece", docs/PERSONAL_VEHICLES.md) usa exatamente esta montagem: o servidor monta
pelo `mountVehicle` (o mesmo do `enter`) e desmonta pelo `dismountVehicle` (o mesmo do `exit`, saída segura) — inclusive
na troca de tipo (desce com segurança antes de o novo surgir). Como ele nasce a 0,9–1,6 m (patinete/bicicleta/moto) e
o carro com a porta virada para o avatar, o trecho a pé da entrada é curto; só monta sozinho quando a entrada está a
≤ 3 m (`PERSONAL_AUTOMOUNT_MAX_M`) — mais longe o corpo deslizaria nos ≤ 45 % do `enterMs`, então o veículo só aparece
e a entrada é pelo E. Remotos: `RideableSystem.addDynamic` cria a instância (mesmo modelo/cache) e o `MountTracker`
anima `entering → mounted` como em qualquer veículo.

## Pendências
- Passageiros (ver acima). Cabines do trio/carro de som opacas. Porta do carro sem animação de abrir.
- Remoto que estava fora da vista (corpo instanciado) e volta à vista já montado aparece direto sentado (sem a entrada).
- Dedos: a pegada usa a mão do clipe (sem curvatura dedicada no guidão).
