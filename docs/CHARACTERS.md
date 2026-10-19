# Personagens humanos (rodada 5)

O boneco de primitivas foi substituído por personagens humanos modelados (MakeHuman) com animação de captura
(Universal Animation Library). O boneco antigo continua no código **apenas como reserva** (falha de carregamento
ou `?avatar=classic`); o usuário normal nunca o vê.

## Arquitetura modular
```
HumanCharacter (src/characters/human/HumanCharacter.ts)
 ├─ 1 esqueleto "game_engine" (53 ossos: pelve, 3 vértebras, pescoço, cabeça, clavículas, braços, 15 falanges/mão, pernas, pés, dedos)
 ├─ camadas independentes: BODY · HAIR · SHIRT · PANTS · SHOES · EYES · EYEBROWS · EYELASHES · ACC_<acessório>
 ├─ LOD0..LOD3 ligados ao MESMO esqueleto (trocar de LOD não reinicia a animação)
 └─ HumanAnimator (controlador de animação)
```
- Cada camada é uma malha separada no GLB, com material próprio. Trocar a camisa por outra peça = outro GLB/camada
  com o mesmo esqueleto; a arquitetura já separa BODY/HEAD(cabelo, olhos, sobrancelhas)/SHIRT/PANTS/SHOES/ACCESSORY.
  Para centenas de combinações, o próximo passo é publicar peças avulsas (um GLB por peça, ajustado por tipo de corpo).
- Cores do jogador (pele, cabelo, camisa, calça, calçado, acessório) são **multiplicadores** sobre a textura.
  A cor média de cada textura é calculada no build (só nos texels usados pelas UVs) e gravada em `extras`; o jogo
  converte "cor desejada" em multiplicador. Nos LODs de malha única, um atributo `_layer` por vértice permite tingir
  cada parte no shader → a mesma roupa tem a mesma cor em todas as distâncias.
- Acessórios (boné, chapéu, óculos, bolsa, sacola) vêm em todas as variantes e ficam ocultos; o acessório escolhido
  é sincronizado pela rede (`accessory`, `acc` no estado da sala).

## Variantes, orçamento e tamanho (medidos)
| Corpo | LOD0 (camadas visíveis) | LOD1 | LOD2 | LOD3 | Download LOD0 / LOD1 / LOD2 / LOD3 |
|---|---|---|---|---|---|
| homem (camiseta, jeans, tênis de corrida) | 32,3 k tri | 11,0 k | 2,5 k | 600 | 1,25 MB / 0,60 / 0,09 / 0,04 |
| mulher (camiseta, jeans justo, tênis) | 35,3 k | 12,1 k | 2,5 k | 600 | 1,25 / 0,65 / 0,10 / 0,04 |
| idoso (polo, calça, sapato oxford) | 37,1 k | 12,6 k | 2,5 k | 600 | 1,19 / 0,59 / 0,08 / 0,04 |
| idosa (camiseta, calça, sapatilha) | 33,0 k | 11,1 k | 2,5 k | 600 | 1,25 / 0,68 / 0,10 / 0,04 |
| animações (14 clipes, compartilhadas) | — | — | — | — | 0,51 MB |

Meta da rodada: LOD0 de 20–60 k triângulos e texturas de 1–2 K. Texturas: pele 2048², roupas/cabelo 1024²,
calçado/olhos 512², sobrancelhas/cílios 256² (WebP); geometria comprimida com **meshopt** (`EXT_meshopt_compression`).
Alguns assets da comunidade vinham com malhas enormes (sapatilha 57 k, bolsa 51 k triângulos): o build impõe um teto
por camada.

### Uso por distância
| | LOD0 | LOD1 | LOD2 | LOD3 |
|---|---|---|---|---|
| Jogador local | sempre | — | — | — |
| Jogadores remotos | < 14 m | < 38 m | < 90 m | além |
| Pedestres NPC | < 9 m (HIGH/ULTRA) | < 24 m (MEDIUM+) | < 60 m | além (LOW: no máximo LOD2) |

Download inicial: animações + LOD0 do próprio avatar + LOD3 dos quatro corpos (~2 MB); o resto em segundo plano.

## Peças variantes e camisas de futebol (rodada 7)
Muito mais variedade **sem novos esqueletos nem corpos**: cada corpo ganhou peças alternativas de roupa e cabelo,
ajustadas a ele pelo MPFB no mesmo build e publicadas como **GLBs avulsos** (`<corpo>-<camada>-<estilo>.glb` +
`_lod1`), baixados só quando alguém as veste de perto. Registro único: `src/characters/garments.ts` (espelha
`tools/character/variants/*.json`; `tests/garments.test.ts` confere configs × registro × arquivos publicados).

| Corpo | Camisa | Calça | Calçado | Cabelo | combinações de peças |
|---|---|---|---|---|---|
| homem | **camiseta**, regata, polo, camisa | **jeans**, bermuda, social | **tênis**, chinelo, sapato | **curto**, curto 2, crespo, raspado | 144 |
| mulher | **camiseta**, regata (camisete), camisa (blusa) | **jeans**, bermuda (short), social | **tênis**, chinelo, sapatilha | **rabo de cavalo**, crespo, chanel, longo | 108 |
| idoso | **polo**, camiseta, camisa | **social**, bermuda, jeans | **sapato**, tênis, chinelo | **curto**, raspado | 54 |
| idosa | **camiseta**, camisa (blusa), regata | **social**, jeans, bermuda | **sapato**, tênis, chinelo | **chanel**, curto | 54 |

Em negrito a peça base (dentro do GLB do corpo). 360 combinações de peças × 7 tons de pele × cores de cabelo/roupa ×
acessórios × 8 camisas de futebol. 31 peças avulsas.

**Aparência** (`CharacterAppearance`, campos opcionais e retrocompatíveis): `topStyle`, `bottomStyle`, `shoeStyle`,
`hairStyle` (ausente ou inexistente no corpo = peça base) e `shirtDesign` (id de `src/social/designs.ts` com alvo
`'shirt'`; 0 = lisa). Rede: `JoinOptions` + `NetPlayer` (strings/u16), validados no servidor (`sanitizeStyle`,
`sanitizeShirtDesign`). Tela inicial: chips de modelo por peça (só o que o corpo veste) e "camisa de time".
Barba: nenhum asset com licença compatível nos pacotes disponíveis — não incluída (ver ASSET_LICENSES).

### Como funciona
- **LOD0/LOD1**: `HumanCharacter.dress()` carrega as peças que faltam (cache por arquivo; texturas soltas da CPU após o
  upload), recorta a pele coberta por ESTA combinação e só então troca o que aparece (a roupa anterior fica até lá).
  Peças que saem do corpo são soltas (NPCs reciclados não acumulam malhas).
- **Pele sob a roupa por combinação**: o MakeHuman apagava do corpo a pele sob a roupa padrão; com variantes, o build
  só apaga a **interseção** das máscaras das peças da mesma camada (uma regata/bermuda/chinelo nunca mostra buraco).
  O resto é recortado no jogo (`hideCovered`): uma máscara de vértices cobertos por **(corpo, peça)**, calculada uma
  vez no Worker, e o índice da combinação vestida = união das máscaras (cache por combinação; atributos compartilhados
  → um upload só). Calça × camisa idem. Calçados entram no recorte (pé sob o tênis).
- **LOD2/LOD3 e multidão VAT** continuam com a malha única da roupa base (sem custo extra de download); as variantes
  são **aproximadas no shader** (`human/garmentShader.ts`) por zonas calculadas pelos ossos do próprio esqueleto:
  regata = braço da camisa com cor de pele, camisa = antebraço com cor da camisa, bermuda = canela com cor de pele
  (corte reto por fragmento na altura do joelho), chinelo, cabeça raspada. Na multidão: um atributo por instância
  `aLook` = (aparência empacotada `packLook`, slot do design). No build, a pele da malha única sob a roupa base é
  removida pelo mesmo teste do jogo (raio pela normal) — acabou a pele "furando" a camiseta no LOD2/3.
- **Camisas de futebol** (`FootballShirtDesign` = designs da família `'football'`): padrão calculado no shader no
  espaço do corpo em repouso (m, relativo ao peito) a partir da paleta — aros, listras verticais, tricolor, faixa
  diagonal, gola/punhos (distância à borda da peça), liso. Mesma estampa em LOD0/1 (camada SHIRT: textura neutra ×
  padrão) e LOD2/3/multidão. **Sem escudos, textos, marcas ou uniformes oficiais.** Uniforme licenciado no futuro:
  um design com `licensed` + `texture` (layout de UV da camiseta base) — `HumanCharacter` já troca o mapa da camiseta
  base por essa textura; nos LODs de malha única vale a paleta.
- **Sorteio** (`randomAppearance(seed, body, { football })`): pesos plausíveis por corpo (idosos quase nunca de
  regata; calçado pela calça — bermuda com tênis/chinelo, social com sapato), camisa de futebol ~6 % no dia a dia e
  ~20 % num ato (evento com grupos; metade disso entre idosos), sempre modelo camiseta. Os sorteios novos vêm depois
  dos de cor: uma semente mantém as cores de antes. 100 aparências sorteadas = 100 assinaturas visuais distintas
  (54 combinações de peças diferentes) — teste exige ≥ 80.

### Como adicionar uma peça
1. Conferir a licença no PRÓPRIO `.mhclo`/`.mhmat` (CC0/CC-BY; nada de AGPL, NC, política, marcas) e registrar em
   `docs/ASSET_LICENSES.md` + `public/CREDITS.txt` (CC-BY).
2. Extrair o pacote na pasta de dados do MPFB e acrescentar em `tools/character/variants/<corpo>.json`:
   `{"layer": "SHIRT", "style": "<estilo>", "file": "<asset>.mhclo"}` (cabelo: `"kind": "hair"` e `"texture"` com a
   base clara de `make_light_hair.py`; sem `file` = estilo sem malha; `"derive": "sleeveless"` = regata cortada da
   camiseta base). Estilo novo: acrescentar NO FIM da lista em `garments.ts` (índices empacotados) e o rótulo.
3. Acrescentar o estilo em `BODY_GARMENTS` e, se for o caso, nos pesos de `randomAppearance`; rodar o build do corpo
   (`--no-anims` para não regravar `anims.glb`) e `pack.sh`. As texturas das peças viram base neutra em cinza (tinta
   exata) e não levam mapa de normais.
4. Conferir recorte/atravessamento: `/dev/human.html?sheet=styles&body=<corpo>&lod=0|1&speed=0|1.2|3.2&t=…` e
   `npm test` (garments.test).

### Medições (rodada 7, Mac M-series; máquina compartilhada com outros agentes → FPS ruidoso)
| | antes | depois |
|---|---|---|
| GLB do corpo LOD0 (homem/mulher/idoso/idosa) | 1,45 / 1,12 / 1,26 / 1,07 MB | 1,50 / 1,15 / 1,29 / 1,11 MB (pele sob roupas curtas) |
| LOD1 / LOD2 / LOD3 (pré-carregados: LOD2/3) | — | iguais (± 1 %) |
| Peças avulsas (31, sob demanda) | — | LOD0 4,40 MB no total (41–570 KB cada), LOD1 1,99 MB |
| 1ª visita 4G até jogar | 3,6 MB | **3,57 MB** (inalterado) |
| 4G após 30 s / 4G lento após 30 s | 5,9 / 6,5 MB | 6,8 / 5,9 MB |
| HIGH, corredor ida e volta: performance.memory pós-GC (fim) | 131 MB | 153 MB |
| HIGH: texturas NPC GPU / CPU (Candelária) | 106 / 79 MB | 128 / 98 MB |
| Multidão 500 bots LOW (mesmos bots/servidor, cliente antes × depois) | 47,3 FPS, CPU 4,0 ms | 47,4 FPS, CPU 4,1 ms |
| Multidão 500 bots HIGH, CPU/GPU por quadro (2 pares alternados) | 11,7 / 7,1 · 9,3 / 8,6 ms | 10,7 / 7,0 · 11,1 / 7,9 ms |
| Multidão 500 bots HIGH, FPS (mesmos pares; varia com a carga da máquina) | 78 · 42 | 56 · 70 |

Crescimento de memória = peças de roupa realmente vestidas pelos NPCs/jogadores próximos (texturas 1024² de camisa/
calça/cabelo) e índices por combinação; o download inicial não muda. Não foram criados novos corpos/fenótipos:
cada corpo extra custaria ~0,13 MB pré-carregados (LOD2/3), ~2 MB sob demanda, +2 draw calls e um VAT a mais.

## Animação
- Clipes: idle, walk, jog, sprint, jump (start/loop/land), drive, sit, push, dance, hit, talk, interact.
- **Idle ↔ Walk ↔ Jog ↔ Sprint** com crossfade contínuo pela velocidade (interpolação entre as velocidades naturais
  dos ciclos), **fase sincronizada** entre os ciclos, e `timeScale = velocidade real / velocidade natural`
  → a passada acompanha o deslocamento (sem "patinar").
- A velocidade natural de cada ciclo é **medida no próprio esqueleto** ao carregar (amplitude da passada da bola do pé,
  calibrada pela caminhada, onde o método do pé em apoio concorda): caminhada 1,15 m/s, trote 3,0, sprint 3,8.
- Pulo (ar), dirigir (carro), sentado + pedalada procedural (bicicleta), em pé (patinete), empurrão (ação curta
  sobreposta), aceno e dança (tela inicial).
- O idle da biblioteca tem base larga ("prontidão"); um ajuste aditivo aproxima os pés.
- Queda: ragdoll Rapier mapeado para o novo esqueleto (pelve, coluna, cabeça, braços, pernas) e levantar com blend.

## Retarget
`tools/character/retarget.py` (Blender): rotação de mundo relativa ao repouso do osso de origem aplicada ao repouso
do alvo; nos membros, correção da diferença de pose de repouso (origem em pose T, alvo em pose A) pela direção de cada
osso. Verificado numericamente: direção dos ossos dos membros idêntica à origem (0,0°) na pose T e no idle.

## Reproduzir o build
1. Blender ≥ 4.2 com a extensão MPFB2 (`blender --command extension install-file -r user_default -e mpfb.zip`).
2. Pacotes da MakeHuman Community extraídos em `~/Library/Application Support/Blender/<v>/extensions/.user/user_default/mpfb/data`
   (system assets, shirts01/02, pants01/02/03, shoes01/02, hair01, eyebrows01, eyelashes01, hats01/03, glasses01,
   equipment03, system_clothes/hair_materials01); bases claras de cabelo com `tools/character/make_light_hair.py`
   (`<difuso>_light.png` ao lado do original: short01, short02, short04, afro01, bob01, long01).
3. Animações: `universal_animation_librarystandard.zip` (OpenGameArt, CC0) em `~/pv3d-assets-src/ual/`.
4. `blender -b --python tools/character/build_character.py -- tools/character/variants/homem.json <saida>` (idem para os demais)
5. `sh tools/character/pack.sh <saida>` → `public/characters/`.
Página de teste (só desenvolvimento): `/dev/human.html?body=mulher&cam=lods`.

## Editor de personagem (rodada 11)
Tela "de jogo" para o DESKTOP (mouse, cursor livre): painel lateral com abas e o avatar grande ao lado. A mesma tela
abre na home (antes de entrar; passo 2 do cadastro) e como overlay no jogo (o mundo segue por baixo; o pointer lock é
solto ao abrir). No celular as abas viram uma faixa rolável e o avatar fica em cima (secundário, continua usável).

- **Abas** (`EDITOR_TABS` em `src/ui/editor/editorState.ts`): CORPO (corpo, nome/apelido, pele) · CABELO (corte, cor) ·
  CAMISA (modelo, cor lisa, camisas de futebol/designs) · CALÇA/SHORT · CALÇADO · ACESSÓRIOS (acessório + cor) ·
  TORCIDA. A aba com alteração não salva ganha um ponto; trocar de aba aproxima a câmera quando faz sentido (cabelo,
  acessório de cabeça).
- **Torcida** dentro do editor, sem duplicar lógica: os cartões são os da tela TORCIDA (`supporterCard`), "Vestir as
  cores" é o `supporterOutfit` (camisa da torcida + cores sugeridas) e a gravação é a mesma da tela TORCIDA
  (`saveSupporter` em `main.ts`: servidor com cooldown/pendência durante evento; sem conta, só a sessão). A escolha de
  torcida entra no histórico do editor e é salva junto com a aparência.
- **Cadeados**: item não liberado mostra 🔒 e o motivo da progressão no próprio botão ("Nível 3", "Missão: …";
  `requirementOf` do catálogo — sem loja). Clicar mostra o item **só na prévia** ("experimentar") e explica o requisito;
  o visual do editor não muda.
- **Desfazer / Refazer / Restaurar** (`EditorHistory`): Ctrl/⌘+Z, Ctrl+Shift+Z/Ctrl+Y, botões no rodapé; "Restaurar"
  volta ao visual salvo e também pode ser desfeito. **Salvar** grava (servidor valida com `validateAppearance` + direitos
  e devolve o que aceitou) e **Cancelar**/Esc descarta. Esc pela pilha única (`pushEsc({ id: 'editor', priority: 200 })`),
  sem listener próprio. "Surpreenda-me" continua (mesmas regras da multidão).
- **Arquivos**: HTML estático em `index.html` (`#start`), lógica de interface em `src/ui/editor/CharacterEditor.ts`,
  estado puro em `src/ui/editor/editorState.ts` (tests/editorState.test.ts), estilo em `src/ui/editor/editor.css`;
  `main.ts` só cria o editor e faz a gravação (bloco "rodada 11 — editor").
- **QA**: `tools/qa/editor_preview.mjs` (32 verificações: cada categoria, bloqueado, desfazer, torcida nos 4 corpos,
  gira/zoom, salvar → recarregar → persistiu, Esc, 1366×768, celular, vazamento, perda de contexto, overlay no jogo).
  Capturas em `docs/screenshots/round11/` (L_roupas_editor, M_torcida_editor, P_preview_3d, W_1366x768_editor).

### Prévia 3D
A prévia do editor é a prévia reutilizável `createSharedPreview` (`src/ui/preview/sharedPreview.ts`; contrato
`AvatarPreviewHandle`), descrita em `docs/INVENTORY.md` → "Prévia 3D". Ela substitui o `AvatarPreview` da rodada 8
no editor (o arquivo antigo fica até o inventário migrar do adaptador provisório). A rodada 10 tinha um defeito: ao
fechar o editor o contexto do canvas era forçado a perder-se e, na reabertura na mesma página, a prévia ficava
"indisponível" (30 de 30 reaberturas no bench) e cada abertura deixava 3 ouvintes para trás.

## Limitações conhecidas
- Sem animação facial (piscar, fala) nesta fase; rosto neutro.
- O tom de pele é um multiplicador sobre texturas de pele clara: tons muito escuros perdem um pouco de detalhe.
- Cabelos são "cards" com alpha test (sem transparência ordenada): bordas serrilhadas de perto.
- Camiseta masculina de gola larga; cós da calça aparece por cima da barra da camisa em alguns ângulos.
- Variantes no LOD2/3/multidão são aproximações por cor (a silhueta é a da roupa base: bermuda = canela cor de pele
  sobre a calça). Multidão distante da rede (mensagem binária) ainda sem peças/design: mostra a roupa base.
- Regata derivada (homem) tem um pequeno degrau no fundo da cava; no LOD1 a bermuda pode deixar um fio de pele na
  virilha ao correr. Sem barba (nenhum asset licenciado disponível).
- LOD1 decimado degrada o rosto de perto (por isso os retratos e personagens próximos usam LOD0).
