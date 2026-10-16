# Licenças — assets dos landmarks (rodada 5)

Todos os modelos dos landmarks continuam **procedurais** (código TypeScript em `src/world/landmarks/`),
gerados a partir do footprint real do OpenStreetMap (ODbL). Os únicos arquivos externos são três
texturas de detalhe **CC0** da Poly Haven, reempacotadas para economizar banda.

## Texturas (public/landmarks/tex/)

| Arquivo | Origem | Autor(es) | Licença | URL | Tamanho físico do tile |
|---|---|---|---|---|---|
| `plaster_detail.jpg` | Poly Haven — *Plastered Wall 02* (`plastered_wall_02`) | Charlotte Baglioni | CC0 1.0 | https://polyhaven.com/a/plastered_wall_02 | 2,23 m (usado a 2,2 m) |
| `concrete_detail.jpg` | Poly Haven — *Concrete Wall 008* (`concrete_wall_008`) | Charlotte Baglioni (foto), Dario Barresi (processamento) | CC0 1.0 | https://polyhaven.com/a/concrete_wall_008 | 2,71 m (usado a 3,4 m) |
| `granite_detail.jpg` | Poly Haven — *Granite Tile* (`granite_tile`) | Charlotte Baglioni | CC0 1.0 | https://polyhaven.com/a/granite_tile | 2,30 m (usado a 1,6 m) |

Download: mapas JPG 1K (`*_diff_1k.jpg`, `*_nor_gl_1k.jpg`) via `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/<id>/…`
(API pública `https://api.polyhaven.com/files/<id>`), baixados em 2026-10-16.

**Reempacotamento** (um JPEG 1024² por material, ~90–260 KB): canais R,G = normal tangente (convenção
OpenGL) e B = luminância do albedo normalizada em torno de 0,5 (o "tom" vem da cor por vértice do
modelo; a textura só traz o grão/variação). A rugosidade é derivada da luminância no shader.
A projeção é triplanar em coordenadas de mundo (`src/world/landmarks/arch.ts`), sem UVs.

CC0 não exige atribuição; ela é registrada aqui por rastreabilidade.

## Fotos usadas como referência (NÃO incluídas no projeto)

Fotos consultadas apenas para proporções/forma; nenhuma imagem foi copiada para o repositório.
Lista completa, com autor e licença, em `docs/LANDMARKS.md` (seção "Referências").
