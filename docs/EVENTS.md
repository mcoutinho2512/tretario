# Plataforma de eventos

A Presidente Vargas é uma **plataforma de eventos**, não um jogo de um tema só. O mesmo mundo recebe um dia
comum, um clássico de futebol, um ato, um encontro ou um show. **Nenhuma lógica de tema fica no código**:
tudo vem de dados. Um teste automatizado (`tests/events.test.ts`) falha se nomes de clubes ou políticos
aparecerem em `src/`.

## Conceitos (`src/events/types.ts`)
| Conceito | Para que serve |
|---|---|
| `EventDef` | o evento: nome, categoria livre, política de interação, e todos os itens abaixo |
| `Team` | time de um confronto (cores, escudo opcional) |
| `Group` | grupo de participantes (torcida, coletivo, convidados); pode ligar-se a um `Team`; `npcShare` veste parte dos NPCs |
| `AvatarOption` | avatares disponíveis no evento (sobre os corpos base: homem, mulher, idoso, idosa) |
| `Cosmetic` | roupa/acessório (futuramente vendável; nunca dá vantagem) |
| `WorldDecoration` | banners/bandeiras nos postes da avenida, com cores do evento |
| `BillboardPlan` / `BillboardContent` | conteúdo dos painéis de LED: texto gerado, imagem ou vídeo por URL; por zona, por painel ou em playlist |
| `VehicleOption` | veículos utilizáveis no evento (bicicleta, patinete; carro depois) |

## Como trocar o evento
- Por URL: `http://localhost:5173/?event=classico-exemplo` (arquivos em `public/events/`).
- Padrão: `public/events/index.json` → `"default"`.
- Futuro: o servidor define o evento ativo da sala (o campo `eventId` já existe no estado da sala).

Exemplos incluídos (genéricos, de propósito):
- `cotidiano`: dia comum, modo pacífico, painéis com "espaço publicitário disponível".
- `classico-exemplo`: dois times genéricos (Time A × Time B), banners nas cores, torcidas como grupos, interação opcional.
- `encontro-exemplo`: encontro/ato neutro, bandeiras, painéis com a programação.

> **Marcas e licenças:** nomes oficiais, escudos e cores registradas de clubes, ou imagens de pessoas reais, só
> devem ser cadastrados por quem tiver o direito de usá-los. A plataforma não embute nenhum.

## Painéis de LED
- **Locais:** o pipeline (`tools/build_world.ts`) escolhe 28 fachadas altas (≥ 28 m) voltadas para a avenida, perto dos
  grandes cruzamentos (Pres. Vargas × Passos, Uruguaiana, Rio Branco, 1º de Março, Tomé de Sousa). Fica no máximo 1 por prédio,
  com espaçamento ≥ 45 m e base acima de 8 m: efeito de "mídia urbana" sem cobrir a arquitetura.
- **Conteúdo em runtime:** `BillboardSystem.setPanelContent(id | '*', content)`. Exposto em `window.__pv.billboard(...)`
  para testes; o backend usará a mesma API (agenda de anúncios). Painéis com o mesmo conteúdo compartilham textura.
- `?event=` define a playlist; cada painel começa num item diferente da playlist.
- **Não há venda de publicidade implementada.**
