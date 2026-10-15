# PRESIDENTE VARGAS 3D — MVP

Reconstrução 3D navegável, renderizada **no navegador** (WebGL2 / Three.js), do corredor real
**Central do Brasil → Avenida Presidente Vargas → Candelária**, no Centro do Rio de Janeiro.

Esta etapa é só o **cenário**: não há multiplayer, política, NPCs, chat nem missões.

![Presidente Vargas olhando para a Candelária](docs/screenshots/mid.jpg)

## Como rodar

```bash
npm install
npm run dev
```

Depois abra **http://localhost:5173** e clique em **EXPLORAR**. O jogador aparece na Presidente
Vargas, em frente à Central do Brasil; a câmera mostra primeiro a torre do relógio e depois gira para a avenida.

Requisitos: Node 20+ e um navegador com WebGL2 (Chrome, Safari 15+, Firefox, Edge).

| Comando | O que faz |
|---|---|
| `npm run dev` | servidor de desenvolvimento (Vite) |
| `npm run build` | typecheck + build de produção em `dist/` |
| `npm run preview` | serve o build de produção (porta 4173) |
| `npm test` | testes automatizados (Vitest) |
| `npm run map:fetch` | baixa os dados OSM brutos para `data/raw/` (só para atualizar o mapa) |
| `npm run map` | reprocessa OSM → `public/world/` (process + build) |

## Controles

| Desktop | |
|---|---|
| **WASD** / setas | andar |
| **Shift** | correr |
| **Espaço** | pular |
| **Mouse** (clique para capturar) | girar a câmera |
| **Roda** | zoom (limitado) |
| **Esc** | soltar o mouse |
| **M** | minimapa expandido (corredor inteiro) |
| **F3** | painel DEBUG (FPS, draw calls, posição, lat/lon, chunk, ponto de validação) |
| **H** | mostrar/ocultar ajuda · **P** modo foto (sem HUD) |

**Toque (celular/tablet):** joystick virtual à esquerda, arraste à direita para a câmera,
pinça para o zoom e botões **CORRER**/**PULAR**.

## Horário real

Data e hora do jogo são as **reais do Rio de Janeiro** (UTC−3). A posição do sol é calculada
astronomicamente (NOAA) para a latitude/longitude da Presidente Vargas: às 13:30 o sol está alto;
às 22:34 é noite, com janelas acesas, postes iluminando a pista e céu escuro. O relógio da Central mostra a hora certa.

Para testes e screenshots dá para forçar o horário: `http://localhost:5173/?time=16:30`.

## Parâmetros de URL (desenvolvimento)

- `?time=HH:MM`: força a hora local do Rio
- `?autostart=1&quality=low|medium|high|auto`: inicia direto, sem a tela inicial
- `?shot=central|avenue|mid|candelaria`: posiciona o jogador num ponto de validação

## Estrutura

```
src/        cliente (TypeScript): core, geo, world, renderer, player, camera, input, physics, ui, debug
tools/      pipeline GIS (fetch → process → build) + QA (screenshots, mobile, pick)
data/raw/   dados OSM brutos (versionados, gzip)  ·  data/processed/ (gerado, não versionado)
public/world/  chunks do mundo prontos para o cliente (nome com hash → cache imutável)
docs/       arquitetura, fontes de dados, licenças, pipeline, performance, multidões, validação, status
tests/      testes automatizados
```

## Documentação

- [docs/STATUS.md](docs/STATUS.md): o que funciona, o que falta, métricas e próximos passos
- [docs/MAP_VALIDATION.md](docs/MAP_VALIDATION.md): checklist para conferência humana do mapa
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/MAP_PIPELINE.md](docs/MAP_PIPELINE.md) · [docs/PERFORMANCE.md](docs/PERFORMANCE.md)
- [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) · [docs/ASSET_LICENSES.md](docs/ASSET_LICENSES.md) · [docs/CROWD_ARCHITECTURE.md](docs/CROWD_ARCHITECTURE.md)

## Atribuição

Dados do mapa © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), licença ODbL.
A atribuição aparece permanentemente no canto da tela durante o jogo.
