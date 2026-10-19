# Sistema de áudio (rodada 10)

Primeira camada de áudio espacial do Tretário. Até a rodada 9.1 o jogo era mudo. Todo som é **gerado por código**
no próprio projeto (ver a seção de áudio em [ASSET_LICENSES.md](ASSET_LICENSES.md)): nenhuma gravação, nenhuma
música comercial, nenhum canto de torcida, nenhum discurso real, nada baixado da internet. Não existe chat de voz nem
envio de áudio.

## Arquitetura

```
 jogo (Game, CombatClient, HUD…) ──► src/audio/bus.ts (CONTRATO) ──► AudioSink = AudioManager (WebAudio)
        │                              sfx / audioLoop / audioCrowd / audioListener   (no-op até o gesto)
        └─► AudioWorld (cola) ─ ouvinte, passos, quedas, veículos, multidão agregada (CrowdAudioAggregator)
```

| Arquivo | Papel |
|---|---|
| `src/audio/bus.ts` | contrato compartilhado (não mudou): `SfxId`, `LoopKind`, `CrowdAudioCell`, `AudioSink`, `setAudioSink`, `sfx`, `audioLoop` (handle preguiçoso), `audioCrowd`, `audioListener`. Antes do áudio liberar, tudo é no-op barato. |
| `src/audio/AudioManager.ts` | implementa o `AudioSink`: grafo WebAudio, autoplay, vozes, laços, multidão, ambiente, instrumentação. |
| `src/audio/AudioWorld.ts` | lê o que o jogo já tem (câmera, jogador, veículos, multidão, rede, eventos) e vira pedidos ao contrato. |
| `src/audio/voices.ts` | orçamento de vozes (puro): `VoicePool` (one-shots) e `LoopScheduler` (laços lógicos → vozes reais). |
| `src/audio/crowdCells.ts` | multidão agregada por célula (puro): `CrowdAudioAggregator`. |
| `src/audio/spatial.ts` | atenuação, pan, passa-baixa de "ar", ganho logarítmico da multidão, alcances por categoria (puro). |
| `src/audio/catalog.ts` | tabelas: SfxId/LoopKind → som, barramento, alcance e peso; som de cada golpe; perfil do evento; reações da multidão. |
| `src/audio/sounds.ts`, `dsp.ts` | receitas de todos os sons e primitivas de síntese (puras, determinísticas). |
| `src/audio/synth.worker.ts` | gera os sons fora do thread principal (≈ 250–300 ms de síntese, uma vez; 47 sons, ≈ 8 MB de buffers). |
| `src/audio/settings.ts` | volumes por categoria + silenciar, em `localStorage` `pv3d.audio` (try/catch). |

### Grafo

```
fonte → [voz: ganho → pan estéreo] → barramento (ambiente | multidão | veículos | eventos | interface | efeitos)
      → master → compressor (−18 dB, 3:1) → limitador (−3 dB, 20:1) → saída
barramentos efeitos/multidão/eventos/veículos → envio → ConvolverNode (resposta gerada, 1,4 s) → master
```

O master começa em 0 e sobe com rampa. "Silenciar tudo" zera o master **e suspende o contexto** (CPU de áudio ≈ 0).
`?audioReverb=0` desliga a reverberação; `?audio=0` nem escuta gestos (som desligado na sessão).

### Espacial

Ganho + pan **manuais** (barato e igual em todo navegador): `attenuation()` = modelo inverso da distância com rampa
final até zero entre 75 % e 100 % do alcance (fora do alcance a fonte é **virtual**: nenhum nó); `panFor()` pelo rumo
do ouvinte (encolhe bem perto, a fonte "envolve" em vez de pular de lado); passa-baixa de "ar" nos laços e na
multidão (`airCutoff`: longe, só os graves chegam — o trio a 120 m é uma batida abafada, corte ≈ 2,1 kHz no QA).
`StereoPannerNode`; sem ele (Safari antigo), `PannerNode` equalpower posicionado só para o pan.

**Ouvinte** (`AudioWorld.update`): rumo da câmera; posição num ponto 60 % do caminho da câmera ao personagem
(3ª pessoa: o próprio passo não soa "a 5 m"); câmera longe do corpo (espectador, aérea, câmera livre) = a câmera.
Troca brusca de ouvinte (> 25 m num quadro: vista aérea, veículo, teleporte) estica as rampas por 0,35 s — **sem estalo**.
Toda mudança de ganho/pan/filtro/taxa é `setTargetAtTime` (constante 0,06 s; 0,25 s depois de um salto).

## Autoplay (navegadores)

- O `AudioContext` **só nasce dentro de um gesto válido** (`pointerdown`, `touchend`, `keydown`, `mousedown` em captura).
  Antes disso: nenhum contexto, nenhum aviso de autoplay no console, `audioActive() === false` e todo pedido é no-op.
- No gesto: `new (AudioContext || webkitAudioContext)({ latencyHint: 'interactive' })`, `resume()` e um buffer de 1
  amostra tocado (destrava a saída no iOS). Bloqueado/recusado: silêncio, tenta de novo no próximo gesto, sem erro.
- Estado `interrupted` (iOS: ligação, outra aba) → volta no próximo gesto.
- Aba em segundo plano (`visibilitychange`/`pagehide`): rampa a zero e `suspend()`; ao voltar, `resume()` + rampa.
- O painel mostra "O som liga no primeiro toque, clique ou tecla" enquanto não liberou.
- QA (Chrome com `--autoplay-policy=user-gesture-required`): antes do clique `state=locked`, `ctx=null`, 0 erros;
  depois do clique `running` a 48 kHz, latência base 5,3 ms. Recarregar a página volta a esperar um gesto.

## Orçamento de vozes

| Tipo | Máximo de vozes reais | Como |
|---|---|---|
| One-shots (passos, golpes, interface, reações da multidão) | **24** | `VoicePool`: cadeias ganho+pan fixas e REUSADAS; só o `AudioBufferSourceNode` (descartável por natureza no WebAudio) nasce por disparo. Prioridade = audibilidade × peso (interface 3, golpes 1,2, passos 0,5, reações de multidão × 0,5). Sem vaga: rouba a de menor prioridade (que decai com o tempo que falta) com rampa de 3 ms, ou descarta. |
| Laços (motores, rolagem, trio, carro de som) | **8** | fontes LÓGICAS ilimitadas (`audioLoop`) → `LoopScheduler` escolhe as 8 mais audíveis com histerese ×1,35; troca com fade de 20 ms. Música continua "de onde estaria" ao virar real. |
| Multidão | **4** células × (murmúrio + camada rítmica) | ver abaixo |
| Ambiente | 2 (vento, cidade) | não espacial; vento cresce com a altura, a cidade abafa sob multidão forte |

Fora do alcance ou abaixo de −50 dB (`AUDIBLE_MIN`): o pedido nem cria nó (`sfxInaudible`). Mesmo som no mesmo
instante (< 25 ms): um só. Valores não finitos nunca chegam a um `AudioParam` (`badParams`).

Os limites ficam em `DEFAULT_BUDGET` (`AudioManager`) e podem ser trocados no construtor.

## Multidão agregada

**Nunca uma fonte por NPC.** `CrowdDirector.end()` entrega os agentes do quadro (`audioTap`); o `AudioWorld` lê a
~4 Hz e soma cada humano (pedestre, concentração, remoto, multidão distante da rede) numa grade de **24 m presa ao
mundo**, numa janela de ±132 m em volta do ouvinte. Cada célula vira um `CrowdAudioCell`:

- `density` (pessoas), `activity` (velocidade média + fração gesticulando + confronto), `combatIntensity` (caídos +
  calor de golpes recentes), `celebrationIntensity` (ações sociais), `eventType` (ponto de evento ativo que cobre a
  célula: caminhada, largada…), `profile` + `profileShare`.
- **Perfil**: índice 0 = perfil do evento (`ambience.crowd` ou pelo formato: manifestação/caminhada/debate →
  `manifestacao`; show → `show`; torcida/confronto → `torcida`; resto → `urbano`); índice i+1 = `audioProfile` do
  grupo i de `public/gameplay/supporters.json` (`torcida_a..d`). Quem veste a camisa/carrega a bandeira/faixa de um
  grupo (designs listados nos DADOS do grupo) vota no perfil dele; jogadores votam também por `NetPlayer.sup`
  (lido de forma tolerante: ausente = 0). Nenhum ramo por grupo no código.
- Só as **4 mais relevantes** (volume × atenuação) viram voz; ganho **logarítmico com teto**
  (`log1p(n)/log1p(80)`): 10× mais gente ≈ 2× mais volume, nunca soma linear.

Cada voz de multidão: murmúrio (14 vozes sintéticas sem palavras, em laço) + **camada rítmica do perfil** (percussão e
palmas próprias; a família vem do prefixo da chave, o andamento/acentos do hash da chave — `torcida_a` e `torcida_b`
soam diferentes sem nenhum `if` por grupo) + **reações pontuais** sorteadas pela célula (apito, palmas, "êêê/ôôô"
genérico, grito curto, surdo, megafone com fala sintética **ininteligível**, no máximo um a cada 7 s), pelo pool de
one-shots. Sem cantos, sem frases. A voz segue a célula mais perto da que já tocava (sem salto de posição).

Espectador no alto (FAR/AGGREGATE): a multidão vem das células de 40 m do servidor (`specCells`: jogadores + ambiente).

## Ambiente

`amb_wind` (ruído rosa filtrado, rajadas periódicas) e `amb_city` (rumor grave distante, chiado urbano, murmúrio e
baques abafados — a avenida está fechada para o evento, então nada de buzinas/sirenes). Laços de 12 s com emenda
cruzada. Reverberação simples (prédios) pelo envio de efeitos/multidão/eventos/veículos.

## Trio elétrico e carro de som

Laço lógico `trio_music`/`soundcar_music` por veículo de evento num raio de 300/210 m: **música própria procedural**
(bumbo, palma, chimbal, baixo e acordes/arpejo gerados — 124 bpm menor no trio, 100 bpm maior no carro de som),
**espacial**: forte perto (alcance de referência 14/10 m), cai com a distância, abafa (passa-baixa de ar) e some além
de 280/190 m. Nunca global. QA: ganho 1,0 a ~9 m → 0,12 a ~120 m (corte 2,1 kHz) → virtual a ~430 m; da vista aérea
(260 m de altura) praticamente inaudível.

## Veículos

`AudioWorld.vehicles()` cria um laço lógico por veículo perto e em uso (ocupado ou andando):

| Veículo | Laço | Taxa / ganho |
|---|---|---|
| carro | `car_engine` (ignição ~30 Hz, harmônicos graves) | taxa 0,62 (marcha lenta) → ~1,5; ganho 0,55 → 1 |
| moto | `moto_engine` (ignição ~48 Hz, irregular, mais aguda) | idem |
| bicicleta | `bike_roll` (rolagem + catraca) | taxa 0,4 → 1,3; ganho pela velocidade (parada = silêncio) |
| patinete | `scooter_motor` (zumbido elétrico) | taxa 0,5 → 1,4 |

Velocidade: do estado (dirigido aqui) ou estimada pelo deslocamento suavizado (remotos). **Freio** pela desaceleração
(`veh_brake`; bicicleta/patinete `bike_brake`), no máximo 1 a cada 1,2 s. **Porta/montar** pela troca de ocupante
(`veh_door` carro/carro de som/trio, `veh_mount` os demais). QA: os 4 tocam e a taxa sobe ao acelerar (carro
0,62 → 0,93; moto 0,62 → 0,92; bicicleta → 1,3; patinete 0,5 → 1,4).

## Combate (estética arcade)

Ganchos em `CombatClient` (só leitura do que já acontece):
- golpe local previsto / confirmado / de um remoto (`cbt_act`) → `whoosh` (ou `dodge`, `spray`) na posição de quem bate;
- resultado (`cbt_hit`, decidido pelo servidor) na posição do alvo: `hit` → som do golpe pelo clipe da definição
  (`combatSfx`: soco/chute/taco/barra/spray/empurrão — sem tabela por id) + `impact`; `dodged` → `dodge`;
  `blocked` → `blocked` (bipe duplo);
- `cbt_denied` (exceto spam) → `ui_denied`.
Quedas/levantar (`fall`/`getup`) pelo estado físico (`status`) do próprio e dos remotos, no `AudioWorld`.
Golpes recentes aquecem a célula da multidão (reações "ôôh").

## Passos, corpo, itens, interface

- Passos do jogador local pela distância andada (passada 0,7 m + 0,2 × velocidade), superfície do `CollisionWorld`
  (pista = asfalto; calçada/plataforma = calçada); pulo/aterrissagem (> 0,25 s no ar). Passos dos ≤ 4 remotos
  detalhados mais perto (< 16 m).
- Item na mão confirmado pelo servidor: `pickup`/`drop`.
- Interface: clique em qualquer botão/opção do HUD → `ui_click` (captura no documento); Ajustes abre/fecha →
  `ui_open`/`ui_close`.

## Ganchos em arquivos de outros agentes (mínimos, comentados `rodada 10 — áudio`)

| Arquivo | O quê |
|---|---|
| `src/core/Game.ts` | import (l. 97); `this.audioAttach()` depois do HUD (l. 429); `this.audioWorld.update(dt)` logo após `crowd.end` (l. 735); bloco `audioAttach()` (l. 985–1001); `__pv.audio()` (l. 1393) |
| `src/combat/CombatClient.ts` | imports (l. 29–30); swing previsto (l. 245), confirmado (l. 272), remoto (l. 280); resultado (l. 287 + `hitSound`, l. 309); negado (l. 327) |
| `src/characters/crowd/CrowdDirector.ts` | campo `audioTap` (l. 62) e chamada no fim de `end()` (l. 105) |
| `src/net/NetworkClient.ts` | `forEachRemoteAudio()` no fim da classe (l. 934): nid, posição, velocidade, status, `sup` tolerante, em veículo |
| `src/ui/hud/SettingsPanel.ts`, `src/ui/style.css`, `src/ui/hud/hudPrefs.ts` | seção Som (substitui "Som — Em breve"), sons de abrir/fechar, estilo dos controles; `HudPrefs.sound` virou legado |

Nada em `AvatarVisual`, `proceduralClips`, `HumanAnimator` nem `Rideable.ts` (os veículos são lidos de `rideables.items`).

## Configurações

Rodada 11: o painel de ajustes ganhou ABAS (Geral · Áudio · Gráficos · Interface · Controles) e os controles de som
foram para a aba **Áudio** — os mesmos controles, a mesma chave e o mesmo comportamento, sem nenhuma mudança no
grafo. Abrir direto nela: `openSettings('audio')` (`src/ui/settingsApi.ts` — o menu do jogo do Esc usa este caminho).
O painel fecha pela pilha única do Esc (`pushEsc`, prioridade 100). Abrir/fechar o painel continua tocando
`ui_open`/`ui_close`; mudar de aba não toca som (evita ruído ao navegar com as setas).

Ajustes → **Áudio** (antes "Som"): Volume geral, Ambiente, Multidão, Veículos, Trio e carro de som, Efeitos, Interface (0–100, passo
5) e **Silenciar tudo**. Salva na hora em `localStorage['pv3d.audio']` (`{master, ambient, crowd, vehicles, events,
sfx, ui, muted}`), validado campo a campo, try/catch (sem storage: só na sessão). Captura: `docs/screenshots/S_config_audio.png`.

## Medições (QA `tools/qa/audio_probe.mjs`, Chrome headless + Metal, M-series, preset baixo)

`node tools/qa/audio_probe.mjs http://localhost:5184 50,500` (servidor de teste próprio na porta 3410, bots
`server/tools/bots.ts` no cenário `dense` com 50 % de vida social) — **27/27** verificações; dados em
`docs/bench/round10_audio.json`; captura do trio com o painel de QA: `docs/screenshots/R_trio_audio_hud.png`.

| Cenário | Humanos agregados | Células → vozes | Laços reais/lógicos | One-shots (pico) | Nós vivos (mín–máx) | Áudio no thread principal | CPU do Chrome com som × silenciado |
|---|---|---|---|---|---|---|---|
| parado perto do trio | ~60 | 4 → 4 | 1/1 | 1 | 116–117 | 0,03–0,04 ms/quadro | — |
| 50 bots | 67 | 4 → 4 | 1/1 | 4 | 116–120 (pico 122) | 0,074 ms/quadro | 39,9 % × 35,7 % (≈ +4 % de um núcleo) |
| 500 bots | 554 | 4 → 4 | 1/1 | 6 | 117–122 (pico 123) | 0,096 ms/quadro | 58,6 % × 44,1 % (≈ +5–15 % de um núcleo; medida ruidosa, soma de todos os processos) |

- Nós vivos ficam num teto fixo (~95 nós permanentes: barramentos, compressor/limitador, reverb, 24 cadeias de
  one-shot, 8 de laço, 4 de multidão, 2 de ambiente + as fontes tocando); só as fontes nascem/morrem. Teste unitário
  com WebAudio falso: 500 pedidos simultâneos + 40 laços → ≤ 24 one-shots, ≤ 8 laços, < 200 nós.
- Síntese: 47 sons em ≈ 240–300 ms **no Worker** (thread principal livre), ≈ 8,3 MB de buffers.
- Erros no console durante o roteiro: 0 (os 3 "Failed to load resource" do servidor de teste sem banco não são do áudio).

## Testes

`tests/audio.test.ts` (17, sem AudioContext real): pool de one-shots e roubo; 60 laços → 8 reais com histerese;
500 entidades → ≤ 4 células; ganho logarítmico; perfil pelos dados de `supporters.json` e por `sup`; confronto/
comemoração/tipo de evento; NaN da multidão distante; atenuação (perto > longe, fora do alcance = 0) e pan;
persistência/validação/mute; storage corrompido/bloqueado; handle preguiçoso do contrato e troca de sink; som de cada
golpe de `combat.json`; perfil do evento e reações (sem canto); todos os sons rendem (finitos, sem saturar,
determinísticos, laços marcados, camadas diferentes por perfil); AudioManager com WebAudio falso (bloqueado até o
gesto, teto de nós, inaudível não cria nó, mudo suspende).

## Pendências / próximos passos

- Safari/iOS real não foi testado neste ciclo (o caminho `webkitAudioContext` + buffer silencioso + `interrupted`
  está implementado, falta aparelho).
- Grama: o `CollisionWorld` não distingue gramado de calçada; `step_grass` existe mas ainda não é escolhido.
- Buzina (`veh_horn`) e campainha (`bike_bell`) existem no contrato e geradas, mas não há tecla para elas.
- Passos de NPCs perto não soam individualmente (a textura vem do murmúrio da célula) — de propósito.
- `ambience.music` dos eventos ainda é ignorado (só `ambience.crowd`); uma trilha por evento precisaria de outra receita.
- HRTF não usado (pan estéreo para todas as fontes).

## Rodada 12 — população autônoma e eventos dinâmicos

- **Autônomos** (NetPlayer.kind = 1) chegam como remotos/multidão distante e entram no `CrowdDirector` como qualquer
  agente: somam na célula de multidão (densidade, atividade, perfil pela camisa/item e por `NetPlayer.sup`). **Nunca
  uma voz por NPC**; passos continuam só dos ≤ 4 remotos detalhados mais perto. (Correção: o voto de perfil por
  `sup` dos remotos lia um campo inexistente e era sempre 0 — agora vem do estado sincronizado.)
- **Gancho do diretor de eventos dinâmicos** (AGENTE E): `AudioWorld.setDynamicEvents(lista)` — focos
  `{ x, z, r, kind, escalation?, participants?, watchers?, crowdIntensity?, cheering?, combatIntensity? }`
  (src/events/dynamicPresentation.ts). O jogo chama ao receber a mensagem **`dyn_events`** (array ou `{ events }`;
  interface tolerante, até 32 focos). A cada rodada da agregação (~4 Hz), cada foco:
  - soma calor de **confronto** e **comemoração** na célula do foco (`addHeat`) → `combatIntensity` /
    `celebrationIntensity` da voz;
  - reforça a **massa** (`addMass`, até 24 pessoas equivalentes × `crowdIntensity`) → volume/atividade da célula;
  - marca o **tipo do evento** na célula (`eventType` = `kind` em minúsculas: `festa`, `briga`, `concentracao`…).
  Campos explícitos (0..1) mandam; sem eles, a intensidade sai do tipo + escalada (`dynamicEventAudio`): BRIGA/
  BRIGA_GENERALIZADA puxam confronto, FESTA/ENCONTRO_TORCIDAS comemoração; a escalada (CALMO → GENERALIZADO) só
  aumenta tensão e massa. Custo: ≤ 32 somas por rodada de 250 ms.
- QA: `__pvR12.dyn(lista)` injeta focos sem servidor; `__pv.audio().world.dynamic` = focos ativos.
