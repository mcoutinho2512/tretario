# Licenças — vegetação e mobiliário urbano (rodada 5)

Todos os itens abaixo são CC0, MIT ou criação original do projeto. Nada pago, nada com restrição de uso comercial.

## Código

| Item | Autor | Licença | Origem | Uso no projeto |
|---|---|---|---|---|
| `@dgreenheck/ez-tree` 1.1.0 (gerador procedural de árvores para three.js) | Daniel Greenheck | MIT | https://github.com/dgreenheck/ez-tree · https://www.npmjs.com/package/@dgreenheck/ez-tree | Dependência npm. Usamos **apenas o código-fonte** (`src/lib`) via alias do Vite; o módulo de texturas do pacote é trocado por um stub (`vite.config.ts`). Gera troncos/galhos e posições dos cartões de folha em `src/world/vegetationGen.ts`. |

## Texturas (em `public/vegetation/`, geradas por `tools/vegetation/make_textures.py`)

| Arquivo | Fonte | Autor | Licença | URL | Processamento |
|---|---|---|---|---|---|
| `leaves.webp` célula 0 (ramo de folhas pequenas — oiti/cássia/ficus) | `src/lib/assets/leaves/ash_color.png` do pacote ez-tree | distribuído por Daniel Greenheck no pacote MIT (o pacote não informa a origem da foto) | MIT (licença do pacote) | https://github.com/dgreenheck/ez-tree/tree/main/src/lib/assets/leaves | reduzido a 512², matiz deslocado para verde tropical, valor −10%, cor dilatada nas áreas transparentes |
| `leaves.webp` célula 1 (folhas largas — amendoeira/munguba) | `aspen_color.png` do ez-tree | idem | MIT (licença do pacote) | idem | recolorido de amarelo-outono para verde (H=96°, S×0.78, V×0.62) |
| `leaves.webp` célula 2 (ipê-amarelo florido) | `aspen_color.png` do ez-tree | idem | MIT (licença do pacote) | idem | matiz 48°, saturação ×1.25 |
| `leaves.webp` célula 3 (folha pinada de palmeira) | desenho procedural | projeto (original) | mesma do projeto | — | `palm_frond()` em `make_textures.py` |
| `bark.jpg` metade esquerda | Bark Platanus | Dimitrios Savva (Poly Haven) | CC0 | https://polyhaven.com/a/bark_platanus | 1k → 512², saturação ×0.7, brilho ×1.45 |
| `bark.jpg` metade direita | Palm Tree Bark | Dimitrios Savva (foto), Rico Cilliers (processamento) — Poly Haven | CC0 | https://polyhaven.com/a/palm_tree_bark | 1k → 512² |
| `bark_n.jpg` | normal maps (OpenGL) dos dois materiais acima | idem | CC0 | idem | 512² cada, lado a lado |

Observação sobre as imagens de folhas do ez-tree: o repositório e o pacote npm são distribuídos sob MIT
(arquivo `LICENSE` do pacote, © 2024 Daniel Greenheck) e as imagens estão dentro do pacote publicado
(`files: ["build", "src", ...]`). O pacote não cita uma fonte separada para essas fotos; registramos isso
aqui para auditoria. Se for necessário trocá-las, basta substituir as células do atlas por fotos CC0
(ex.: Poly Haven/ambientCG) e rodar `python3 -I tools/vegetation/make_textures.py`.

## Modelos

| Item | Autor | Licença | Observação |
|---|---|---|---|
| Palmeira-imperial (estipe, palmito, folhas arqueadas) | projeto (original) | mesma do projeto | procedural em `src/world/vegetationGen.ts` |
| Mobiliário urbano (postes, semáforos, abrigos, bancos, lixeiras, bancas, frades) | projeto (original) | mesma do projeto | procedural em `src/world/builders/props.ts` |

## Dados

| Item | Fonte | Licença |
|---|---|---|
| Posição das árvores (647 pontos `natural=tree` + `tree_row`) | OpenStreetMap | ODbL (ver `docs/DATA_SOURCES.md`) |
| Composição de espécies (oiti, amendoeira, cássia-siamesa, ficus, munguba, ipê) | Monografia UFRRJ — censo da arborização viária do Centro do Rio (2.693 árvores, 50 espécies) | citação acadêmica; usamos só a ordem de abundância das espécies (ver `docs/VEGETATION.md`) |
