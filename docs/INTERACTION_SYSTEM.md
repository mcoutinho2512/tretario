# Sistema de interação — "clicou/tocou → interagiu" (rodada 10)

Um único caminho para usar o mundo: tecla **E**, tecla **T**, botão **USAR**, barra de ações, **clique** (desktop) e
**toque** (celular) passam todos pelo `InteractionSystem`. O cliente só **pede** pelas mensagens que já existiam
(`enter`, `exit`, `board`, `unboard`, `item_pick`, editor de grafite, painel da pessoa); **o servidor decide**.

| Módulo | O quê |
|---|---|
| `src/interaction/types.ts` | contrato `Interactable` / `InteractionProvider` (rodada 10 acrescentou `distance?` e `prompt?` no fim) |
| `src/interaction/select.ts` | escolha PURA: alvo contextual, clique/toque pela projeção, textos (`tests/interaction.test.ts`) |
| `src/interaction/InteractionSystem.ts` | coleta, alvo contextual, hover, realce (anel + rótulo), `pointAt` (clique/toque), `useKey`, `useType` |
| `src/interaction/providers.ts` | provedores: veículos/trio, itens, pessoas, grafite |
| `src/input/tapGesture.ts` | toque × arrasto (`TapTracker`, puro) |
| `src/ui/PersonPanel.ts` | painel compacto da pessoa |
| `src/ui/hud/VehicleHud.ts` | HUD do veículo (velocidade + SAIR) |
| `src/interaction/interaction.css` | realce, painel, HUD do veículo |
| `tools/qa/interaction_mp.mjs` | QA desktop + iPhone 14 (44 verificações), capturas em `docs/screenshots/round10/` |
| `tests/interactionServer.test.ts` | sala REAL com clientes forjados (entrar, corrida pelo mesmo carro, itens, denúncia) |

## Como escolhe o alvo

Cada quadro (depois da câmera) os provedores entregam candidatos num raio de 30 m (objetos reaproveitados, nada
alocado por quadro). Dois usos:

1. **Alvo contextual** (E / USAR / barra / realce automático) — `chooseContext`:
   alcance (`distance ?? distância ao centro` ≤ `maxDistance`) → estado do jogador (`allowedStates`) → disponível →
   **maior prioridade** → empate: menor distância, com desempate leve pela mira (até 0,15 m a favor do que está à frente da câmera).
   Prioridade ≤ 15 (**pessoas**) nunca vira alvo contextual: não há realce em cada pessoa que passa.
2. **Clique/toque** — `pickScreen`: o candidato cujo centro projetado está mais perto do cursor/dedo, dentro do raio de
   clique em px (raio do objeto projetado, **nunca menor que 44 px de diâmetro no toque** e 28 px no mouse);
   praticamente empatados (≤ 5 % do raio) → maior prioridade. Fora do alcance → aviso "Chegue mais perto" (nada é
   enviado); ocupado → "em uso por outra pessoa".

| Provedor | Ação (rótulo) | Alcance | Prioridade | Estados | Mensagem |
|---|---|---|---|---|---|
| sair / descer | Sair (carro, carro de som, trio) · Descer (moto, bicicleta, patinete, plataforma do trio) | — | 100 | veículo, plataforma | `exit` / `unboard` |
| escada do trio | Subir | 2,2 m do pé da escada (`TRIO.boardRange`) | 55 | a pé | `board` |
| veículo | Entrar (carro) · Montar (moto, bicicleta) · Usar (patinete) · Dirigir (carro de som, trio pela porta da cabine) | 2,4 m pela `useDistance` (lateral da carroceria / porta da cabine — a MESMA de `RideableSystem.nearest`) | 50 | a pé | `enter` |
| item no chão/apoio | Pegar | 2,0 m (`PICK_HINT_M`, abaixo dos 2,2 m do servidor) | 40 | a pé | `item_pick {i}` |
| grafite | Pichar | superfície do prompt (2,4 m) | 20 | a pé | editor (`gf_new` ao terminar) |
| pessoa | Interagir | 8 m (painel fecha a 14 m) | 10 (só clique/toque) | a pé, plataforma | painel |

O verbo por tipo de veículo é **dado** (`VERB` em `providers.ts`), não um ramo por veículo. Textos do HUD:
"E — ENTRAR NO CARRO", "E — MONTAR NA BICICLETA", "E — USAR O PATINETE", "E — SUBIR NO TRIO", "E — PEGAR TACO"
(no toque sem o "E —"). Realce: rótulo curto "CARRO · Entrar" (desktop "E · CARRO · Entrar" quando é o alvo da
tecla), "CARRO · Em uso", "CARRO · chegue mais perto" e, além do dobro do alcance + 4 m (`farFor`), "CARRO · longe" —
o objeto distante é **identificado**, não usado (o servidor valida o alcance de qualquer forma).

## Mouse (desktop)

Rodada 11 — **cursor sempre visível, sem pointer lock** (docs/DESKTOP_CONTROLS.md):

- Passar o cursor sobre um objeto mostra o realce dele; cursor contextual: seta normal; **mão** (`pointer`) em objeto
  interativo ao alcance; **`context-menu`** (cursor de interação) em outra pessoa ao alcance; fora do alcance, seta.
- **Clique esquerdo** (solto dentro de 6 px / 400 ms) = `pointAt(x, y, 'click')` no ponto do cursor. Passou do limiar =
  arrasto de câmera, **não** clique (arrastar sobre um jogador não abre o painel). Não existe mais o modo "mira no
  centro da tela" (`'aim'` ficou na API, sem uso) e o clique **nunca** é soco.
- **Botão direito arrastando** gira a câmera: durante o arrasto não há hover/realce pelo cursor (`host.looking()`);
  soltou, volta na hora.
- HUD por cima (rótulo do realce, painéis, chat…) consome o clique antes do mundo.
- Projeção barata: um ponto por candidato (`Vector3.project`), sem raycast de malha; **uma** atualização de matriz da
  câmera por quadro (antes era uma por candidato); o retângulo do canvas é lido só no redimensionamento.
- Teclas: **E** = alvo contextual; **T** = o melhor item ao alcance (sem item, larga como antes); **Z/X** inalterados.

## Toque (celular)

- `TouchControls` separa **toque** de **arrasto** com o `TapTracker`: um dedo que anda **≤ 10 px** e solta em
  **≤ 350 ms** (pelo `timeStamp` do evento, não pela hora em que o quadro ocupado o tratou) é toque; passou do
  limiar, é arrasto de câmera e nunca mais vira toque. **Enquanto não passa do limiar, a câmera não gira** (um toque
  não mexe a câmera). Dois dedos de olhar (pinça) cancelam o toque; o dedo do joystick não conta (andar com o polegar
  esquerdo e tocar num objeto com o direito funciona). Dedo sem `touchend` há > 5 s é esquecido.
- Um toque no objeto interage — sem hover, sem duplo toque. O rótulo do realce também é tocável (≥ 44 px).
- O botão **USAR** continua (alvo contextual), assim como a barra de ações.
- **Em veículo**: PULAR, USAR e os botões de confronto somem (`TouchControls.setRiding`); aparece **SAIR** grande
  (84 px) no lugar do PULAR; velocidade e uma dica curta do joystick acima dele.

### Controles de veículo no toque — decisão

Auditado: o joystick já entrega `throttle = ↑/↓` e `steer = ←/→` analógicos para `stepRideable` (W/S/A/D no desktop),
com ré automática ao segurar ↓ parado no carro (`reverse`), e CORRER (ou o fim do curso do joystick) = mais rápido.
Decisão: **manter o joystick** (um polegar faz acelerar, frear/ré e virar, sem teclado) e **não** acrescentar pedais:
mais botões fixos poluiriam a tela e disputariam o polegar direito com SAIR. QA: joystick ↑ leva o carro de 0 a
~9 km/h no iPhone 14 emulado.

## Validação do servidor (o cliente só pede)

Testado na sala REAL com clientes do SDK mandando mensagens cruas (`tests/interactionServer.test.ts`):

| Caso | Resultado |
|---|---|
| perto → `enter` | `enter_ok`, `occupant` e `vehicle` no estado |
| longe (com `dist: 0`, `x/z` do carro e `near: true` forjados) | `enter_denied distancia` — o servidor usa a própria posição (`r.last`) |
| ocupado | `enter_denied ocupado` |
| A e B pedem o MESMO carro no mesmo instante | exatamente 1 `enter_ok`, o outro `ocupado` (mensagens processadas em série na sala) |
| id inventado / objeto / texto de 200 caracteres | `enter_denied inexistente`, **sem ecoar o payload** |
| "assumir" o carro alheio: `exit` de quem não está nele, `move` com campos extras/ocupante, `enter` com `occupant`/`force` | nada muda |
| `item_pick` longe (posição do cliente ignorada) / inexistente / id não numérico / já pego por outro | `longe` / `inexistente` / `invalido` / `ocupado` |
| `user_report` | ver abaixo |
| rodada 12 — `enter` no veículo PESSOAL de outro (`NetVehicle.owner`) | `enter_denied pessoal` (só o dono usa; no cliente o pessoal alheio nem vira alvo — `VehicleProvider` e `RideableSystem.nearest` pulam) |
| rodada 12 — `pveh_req` forjado (100×, tipos inválidos, espectador, caído) | ≤ 1 ativo, `taxa` / `tipo` / `espectador` / `caido` (`tests/personalVehiclesServer.test.ts`) |

**Brechas corrigidas nesta rodada** (`PresidenteVargasRoom.onEnter`):
- a resposta `enter_denied` ecoava o `id` cru do cliente (objeto/texto arbitrário): agora só texto ≤ 64 caracteres;
- veículo em `RESETTING` (voltando para a vaga) podia ser entregue: agora `indisponivel` (o cliente já o mostrava
  indisponível).

## Pessoa — painel e denúncia

Clique/toque em outro jogador a ≤ 8 m abre o `PersonPanel` (compacto, `role=dialog`, Esc/toque fora/× fecham, fecha
sozinho se a pessoa sai ou se afasta > 14 m):

- **VER PERFIL** — só dados públicos: apelido (`NetPlayer.name`) e torcida pelo `displayName` dos dados
  (`public/gameplay/supporters.json`, índice `NetPlayer.sup` = i+1; lido de forma tolerante — campo ausente = sem
  torcida). Nível não é público hoje, então não aparece.
- **INTERAGIR** — gestos sociais existentes (Acenar, Sinal positivo, Apontar, Comemorar, Bater palmas): o personagem
  vira para a pessoa e faz o gesto pelo caminho normal (`act`, validado pelo servidor). Não há botão de atacar.
- **SILENCIAR / DESSILENCIAR** — o mute por identidade do chat (`chat_mute {nid}`; o servidor resolve a conta).
- **DENUNCIAR** — categorias do chat → `user_report { nid, category }`. Servidor (`ChatService.reportUser`): exige
  `report.create`, alvo resolvido pelo nid da entidade (userId/sessionId do cliente ignorados), alvo a ≤ 60 m da posição
  autoritativa do denunciante, não a si mesmo, 1 por alvo a cada 30 min, mesmo teto do chat (6 por 10 min). Grava
  `Report` `USER` com evidência só para a moderação; a resposta `user_report_res { ok, r? }` não tem ids e o denunciado
  não é avisado.

## HUD contextual

A pé: ação contextual + realce. Em veículo: velocidade + SAIR (`VehicleHud`). Com item: a pílula MÃOS (inalterada) —
HUD, item na mão do corpo e servidor leem a MESMA fonte (`social.prop`, que vem do `prop` do servidor); o QA confere
os quatro (`__pv.handSync()`) ao pegar e ao largar.

## Onboarding

Na primeira vez que aparece algo interativo: "Toque ou clique nos objetos para interagir." (no desktop, mais "Botão
direito + arrastar gira a câmera."; 6 s), uma vez por
aparelho (`localStorage['pv.ix.hint']`, com try/catch — sem armazenamento, mostra mesmo assim).

## Como acrescentar um provedor

```ts
class PortaProvider implements InteractionProvider {
  readonly id = 'portas';
  private c: Interactable = { key: 'porta:1', interactionType: 'other', interactionLabel: 'Abrir', targetLabel: 'Porta',
    maxDistance: 2, priority: 30, allowedStates: ['foot'], serverAction: 'door', availability: 'available',
    x: 0, y: 2.2, z: 0, pickRadius: 0.8, activate: () => net.send('door', { id: 1 }) };
  collect(x: number, z: number, state: InteractionPlayerState, out: Interactable[]) {
    if (state !== 'foot') return;
    // atualize os campos do MESMO objeto (sem alocar por quadro) e empurre em `out`
    out.push(this.c);
  }
}
game.ix.register(new PortaProvider());
```

- `y` = altura do rótulo (topo do objeto); o clique mira o centro (≈ 55 % entre o chão e `y`).
- `distance` (opcional) = distância pela regra do objeto, quando o centro não serve (carroceria, porta).
- `priority` > 15 para virar alvo contextual; ≤ 15 = só clique/toque.
- `activate()` só PEDE ao servidor (mensagem com handler no servidor — mensagem sem handler derruba a conexão).
- O servidor revalida tudo; escreva o caso forjado em `tests/interactionServer.test.ts`.

## QA

`node tools/qa/interaction_mp.mjs http://localhost:5182` (Vite `npx vite --port 5182 --strictPort`; servidor de teste
próprio na porta 3210): **44/44** — hover + clique em carro, moto, bicicleta e patinete (servidor confirma), HUD do
veículo e W acelerando, SAIR, clique no vazio, item (hover "Pegar", clique → `item_self` → mão = HUD = servidor =
corpo; Z larga tudo junto), pessoa (painel, perfil, gesto confirmado, denúncia aceita, Esc), onboarding; celular:
arrasto por cima do carro gira a câmera e não interage, toque entra nos quatro veículos (toque não vira arrasto),
rótulo ≥ 44 px, SAIR 84 px com PULAR/USAR escondidos, joystick acelera sem teclado, toque parado não gira a câmera,
toque na pessoa abre o painel (botões ≥ 44 px) e toque fora fecha. Resultado em
`docs/screenshots/round10/interaction_qa.json`; capturas `G_interacao_carro`, `N_item_contextual`,
`O_interacao_jogador`, `T_mobile`, `X_hud_veiculo`, `X_hud_veiculo_celular`.

QA no console: `__pv.ix()` (candidatos com posição na tela, alvo, hover, estatísticas, `perf`), `__pv.ixPoint(x, y, via)`,
`__pv.ixPick(x, y)`, `__pv.ixPerfReset()`, `__pv.input()` (gesto do mouse, camadas do Esc, yaw),
`__pv.person()`, `__pv.vehHud()`, `__pv.touchTaps()`, `__pv.handSync()`.

## Custo da seleção (rodada 11)

Medido por quadro no `InteractionSystem.update` (`perf`, `__pv.ix().perf`; zerar com `__pv.ixPerfReset()`):
coleta (provedores + alvo contextual), hover (projeção dos candidatos + `pickScreen`), candidatos e projeções.

**500 entidades** (`node tools/qa/selection_500.mjs`: 500 bots `dense` — elipse de ~60 × 20 m — num servidor de teste,
cliente no meio deles, mouse passeando pelo canvas, 640 quadros; `docs/screenshots/round11/selection_500.json`):

| medida | valor |
|---|---|
| entidades no cliente | 16 com corpo (área de interesse do servidor) + 476 na multidão distante (impostores, não selecionáveis) |
| candidatos por quadro | 16 (máx. 16) — só os provedores perto do jogador (≤ 30 m), nunca as 500 |
| projeções por quadro | 15,6 |
| hover (projeção + escolha) | **0,0125 ms/quadro** em média (máx. 0,5 ms num quadro) |
| coleta + alvo contextual | 0,027 ms/quadro |
| um clique (`pick`) | 0,003 ms |
| quadros | 60 fps |

Pior caso sintético (500 candidatos projetados de uma vez, `pickScreen` + `Vector3.project` no Node): 0,028 ms por
escolha. Nada de raycast contra malhas: a seleção é aritmética sobre os candidatos já filtrados por distância.

## Fora do escopo desta parte

Pose/animação/câmera do avatar no veículo e saída segura no servidor (agente C), áudio (agente D — os `sfx('ui_click'
| 'ui_open' | 'ui_denied')` daqui são no-op até o áudio registrar), animações de combate (agente E).

## Veículo pessoal (rodada 12)

"Selecionou → aparece": a barra (Veículos), o inventário e o acesso rápido não apontam mais "o mais próximo"; pedem o
veículo PESSOAL (`pveh_req`). O servidor cria um `NetVehicle` comum (com `owner`) num ponto seguro perto e monta pelo
MESMO `mountVehicle` do `enter` (missão `vehicle_enter` conta, animação de montagem da rodada 10). O provedor de
veículos ignora o pessoal de outro jogador (sem prompt "E — USAR" nele). Veículos do mundo (vagas) continuam como
alvo normal. Ver docs/PERSONAL_VEHICLES.md.
