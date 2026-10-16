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
   (system assets, shirts01, pants01/02, shoes01/02, hair01, eyebrows01, eyelashes01, hats01/03, glasses01, equipment03,
   system_clothes/hair_materials01).
3. Animações: `universal_animation_librarystandard.zip` (OpenGameArt, CC0) em `~/pv3d-assets-src/ual/`.
4. `blender -b --python tools/character/build_character.py -- tools/character/variants/homem.json <saida>` (idem para os demais)
5. `sh tools/character/pack.sh <saida>` → `public/characters/`.
Página de teste (só desenvolvimento): `/dev/human.html?body=mulher&cam=lods`.

## Limitações conhecidas
- Sem animação facial (piscar, fala) nesta fase; rosto neutro.
- O tom de pele é um multiplicador sobre texturas de pele clara: tons muito escuros perdem um pouco de detalhe.
- Cabelos são "cards" com alpha test (sem transparência ordenada): bordas serrilhadas de perto.
- Camiseta masculina de gola larga; cós da calça aparece por cima da barra da camisa em alguns ângulos.
- LOD1 decimado degrada o rosto de perto (por isso os retratos e personagens próximos usam LOD0).
