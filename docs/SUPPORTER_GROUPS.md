# Torcidas (rodada 10)

Flamengo, Vasco, Fluminense, Botafogo e **Nenhuma / Neutro** — escolha de **perfil** (identidade + social + visual),
separada de grupo político e de grupo de evento. Nada é obrigatório, nada dá vantagem e nada infere política.
Tudo é **data-driven**: os nomes dos clubes existem só nos dados (`public/gameplay/supporters.json`) e nesta
documentação; o código (`src/`, `server/src/`) trata as torcidas pela posição na lista (testes:
`tests/supporters.test.ts`, `tests/groupNeutrality.test.ts`, `tests/events.test.ts`).

## Inventário das referências visuais (fornecidas pelo dono; NÃO estão no repositório — contêm marcas)

Todas as quatro são fotos de **frente** da camisa (sem costas). As costas foram derivadas do padrão (listras/faixas
continuam; a faixa diagonal atravessa o corpo como uma faixa a tiracolo).

| arquivo | time | vista | cores | padrão | gola | manga/punho | detalhes | elementos protegidos OMITIDOS |
|---|---|---|---|---|---|---|---|---|
| `images/1.jpg` | Fluminense | frente | grená `#7a1f3d`, verde `#00613c`, branco | listras verticais grená/verde (~5,5 cm) com **filete branco fino** entre elas | **V branca** | manga listrada, **punho branco** | — | escudo, patrocinador (texto grande no peito), marca do fabricante, selo na barra |
| `images/2.jpg` | Botafogo | frente | preto `#141414`, branco | listras verticais preto/branco de **largura igual** (~6,5 cm) | redonda **preta com friso branco** | manga listrada, **punho preto com dois frisos brancos** | — | escudo com estrela, marca do fabricante (logo), selo "1942" |
| `images/3.webp` | Vasco | frente | preto, branco, cinza claro | camisa preta com **faixa diagonal branca do ombro ESQUERDO de quem veste ao quadril direito** (à direita de quem olha a foto, descendo para a esquerda); **textura topográfica sutil** (curvas de nível) dentro da faixa | redonda preta | manga preta | — | cruz no peito, marca do fabricante (logo), selo na barra |
| `images/4.webp` | Flamengo | frente | vermelho `#c8102e`, preto | **faixas horizontais largas** vermelho/preto **começando em preto** no topo (7 faixas) | **polo preta** | manga com as faixas | **frisos vermelhos nos ombros** (duas linhas) | monograma/escudo, estrela, as três listras e a marca do fabricante |

## Como cada torcida foi representada (designs, `src/social/designs.ts`)

Camisas pelo sistema de shader existente (`src/characters/human/garmentShader.ts`, **sem textura por design**), com 4
padrões novos. Coordenadas no espaço de REPOUSO do corpo (o padrão acompanha a pose; +x = lado esquerdo de quem veste,
+z = frente). A cor de ACABAMENTO (gola/punho) sai da própria paleta (`bg`/`accent`/`third`) — nenhum uniforme novo.

| id | chave (sem nome de clube) | padrão | o que reproduz |
|---|---|---|---|
| 212 | `tor_faixas_vermelho_preto` | `hoops_top` | faixas horizontais de 8,5 cm com FASE começando em preto no topo; gola polo preta; 2 frisos vermelhos no alto dos ombros |
| 213 | `tor_preta_faixa_diagonal` | `sash_l` | preta; faixa branca (~10 cm) do ombro esquerdo ao quadril direito, só no tronco (não invade a manga); curvas de nível sutis em cinza dentro da faixa (procedurais, não a textura oficial); costas coerentes (a faixa dá a volta) |
| 214 | `tor_listras_grena_verde` | `stripes_pin` | listras grená/verde de 5,5 cm com filete branco de 6 mm; gola V branca (borda + "V" no peito, só na frente); punhos brancos |
| 215 | `tor_listras_preto_branco` | `stripes_eq` | listras iguais de 6,5 cm; gola preta com friso branco; punho preto com dois frisos brancos |
| 216/217 | bandeira / faixa | `hoops_top` / `h_stripes` | vermelho e preto |
| 218/219 | bandeira / faixa | `sash_l` | preta com diagonal branca (mesmo sentido da camisa, vista de frente) |
| 220/221 | bandeira / faixa | `stripes_pin` / `tricolor_v` | grená, branco e verde |
| 222/223 | bandeira / faixa | `stripes_eq` / `split_h` | preto e branco |

Total: **12 designs** (4 camisas + 4 bandeiras + 4 faixas), todos `family: 'football'`, `crowdWeight` igual (3) — nenhuma
torcida aparece mais que outra na multidão. Bandeiras e faixas são pintadas por `designPainter.ts` (canvas, sem imagem
externa), sem texto nem escudo. Omitidos em tudo: escudos, cruz, monograma, estrela, marcas de fabricante (e as três
listras), patrocinadores, selos/patches, números/nomes de jogador, texturas oficiais.

**Corpos e LODs**: funciona nos 4 corpos (homem, mulher, idoso, idosa) — LOD0/LOD1 (camada SHIRT), malha única LOD2/LOD3
e multidão instanciada VAT (`CrowdRenderer`). Filetes e frisos somem suavemente por `fwidth` quando ficam menores que
~1 px (caminho distante = só as listras/faixas largas). Folhas: `docs/screenshots/round10/B_flamengo.jpg`,
`C_vasco.jpg`, `D_fluminense.jpg`, `E_botafogo.jpg` (linhas: LOD0, LOD2, LOD3 — 4 corpos × frente/costas — e VAT LOD2/LOD3).

**Clipping**: a geometria da camisa não muda (só a cor no shader), então o comportamento é o da camiseta base. Conferido
em `G_poses_camisas.jpg` (4 camisas × parado, andar, correr, pulo, dança, gesto, soco, chute, esquiva, queda, levantar,
LOD0, 4 corpos) e `H_montado_camisas.jpg` (bicicleta, patinete, moto, carro — poses ATUAIS de veículo; o agente C
está refinando essas poses em paralelo, conferir de novo depois da integração). Nenhum atravessamento novo observado.

**Custo (medido)**: draw calls e triângulos idênticos com e sem camisa de torcida (`dev/human.html`: 8 corpos LOD0 =
66 chamadas/256 616 tri; LOD2 = 10/19 996; VAT = 6/99 972, nos dois casos). Slots de design de camisa 16 → 20 **sem
mais registradores de uniforme** (código do padrão no `w` de `uDesBg`: 64 → 60 vetores). Nenhuma textura nova; os
atlas de bandeira e de faixa ganham 4 células cada. Cena real com as 4 concentrações (preset alto): 577 chamadas,
252 texturas, 60 fps (`docs/bench/round10_supporters.json`).

## Dados e contratos

- `public/gameplay/supporters.json` (contrato `src/supporters/types.ts`): grupos, `neutralId`, `changePolicy
  { cooldownS, deferDuringEventKinds }`, `clothingSet`, `flagSet`, `bannerSet`, `rallyPreferences`, `audioProfile`.
- `src/supporters/data.ts` (puro): `parseSupporterData` (ids, categoria, cores, designs existentes e do alvo certo;
  grupo inválido é descartado com erro), `supIndex`/`supAt`, `decideSupporterChange`/`settlePending`,
  `supporterOutfit` ("vestir as cores"), `loadSupporterData` (cliente).
- **Rede**: `NetPlayer.sup` (u8) — `0` = neutro/sem torcida, `i+1` = índice em `groups`. Lido por painel de pessoa,
  áudio e minimapa (outros agentes). Não renomear.

## Persistência e API

- `Profile.supporterGroup` (id ou o id neutro; NULL = nunca escolheu), `supporterPending`, `supporterChangedAt`
  (migration expand-first `20261018220000_round10_supporter_profile`; `DataStore.supporters.get/set`).
- `GET /api/me/supporter` → `{ current, pending, sup, neutralId, cooldownS, groups }`;
  `PUT /api/me/supporter { group }` → aplicada, `deferred: true` (pendente) ou 429 `cooldown`/`muitas_alteracoes`,
  400 `torcida_invalida`. Mesma capacidade (`group.join`) e limite de taxa do grupo do evento. Só a conta da sessão.
- `GET /api/profile/:nickname` inclui `supporter` (público). Visitante sem conta: escolha só na memória da aba
  (`src/supporters/session.ts`), enviada na entrada da sala como opção `sup`; nunca persiste.

## Política de troca (`changePolicy`)

- Fora de evento competitivo: aplica já, respeitando `cooldownS` (60 s) desde a última troca.
- Inscrito em evento VIVO (inscrição/contagem/ativo) cujo formato está em `deferDuringEventKinds`
  (`confronto_grupos`, `torcida`): vira **PENDENTE** e é aplicada quando a pessoa sai do evento ou ele termina
  (`RoomSupporters.tick` → `settleSupporter`; também no próximo `onAuth` se ela saiu do jogo).
- **Lacuna corrigida (grupo do EVENTO)**: trocar de grupo no meio de um `confronto_grupos` deixava o placar
  (ClashRunner, grupo da inscrição) e o fogo amigo (`combatAllowed`, grupo atual) inconsistentes. Agora, enquanto a
  pessoa está inscrita num evento vivo com regras de grupo (`groupRules.allowed`/`clash`), a troca de membership é
  gravada mas **adiada** na sala (`identity.groupKey` mantém o grupo da inscrição; a API responde `deferred: true`) e
  aplicada na saída/fim. Teste: `tests/supportersServer.test.ts`.

## UI

Home → chip **TORCIDA** → tela "Para qual time você torce?" (`src/ui/supporterPicker.ts`): 4 torcidas + "Nenhuma /
Neutro", miniatura da camisa e das artes (só cores), "Vestir as cores" (camisa da torcida + cores sugeridas de
calção/tênis; o resto do visual fica igual). Capturas: `A_selecao_torcidas.jpg` (desktop) e
`A_selecao_torcidas_celular.jpg`.

## Multidões e eventos

- Pedestres: as 4 camisas entram no sorteio de camisas de futebol com peso igual.
- **Encontro das torcidas** (formato `torcida`, `server/src/events/SupportersRunner.ts`; agenda de `manifestacao` e
  `classico-exemplo`, a cada 60 min, 15 min, zona CENTRO — zonas do mundo inalteradas): uma concentração por torcida
  + encontro comum. Participação = ficar perto da SUA concentração (neutro: qualquer uma ou o encontro) por metade do
  tempo ativo → `event_complete`. Sem placar entre torcidas, sem confronto. Quem quiser confronto entre torcidas usa
  `confronto_grupos` (CombatSystem + regras de evento existentes).
- Concentrações viram RallyPoints com `sup`: os NPCs simulados (RallyCrowd) vestem a camisa (80 %), parte leva bandeira
  ou faixa da torcida, ações de bandeira/palmas. NPC nunca entra em `playersOnline` (testado na sala real e no QA).
- Minimapa: marcador AGREGADO por concentração (cor principal, anel na 2ª cor, sigla) — nunca posição de jogador.
- Capturas: `F_concentracao_torcidas.jpg`, `Q_multidao.jpg`, `P_evento_torcida.jpg`, `Y_minimapa.jpg`
  (`node tools/qa/supporters_mp.mjs`, servidor de teste na porta 3150).
