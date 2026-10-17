# Modo espectador (rodada 8)

Quem só quer **assistir** entra no **mesmo mundo** (mesma sala Colyseus, mesmo estado) sem corpo. Não é outra
instância, não é vídeo: é a mesma Presidente Vargas que os jogadores veem, renderizada pelo cliente.

## Entrada
- Tela inicial: o botão **ASSISTIR GRÁTIS** chama `launch(choice, { role: 'spectator' })` (em `src/main.ts`;
  também `window.__pvLaunch({ role: 'spectator' })`; automação: `?autostart=1&spectate=1`).
- `Game` recebe `GameOptions.role = 'spectator'`: sem avatar (oculto), sem física, sem interação, sem roda de ações; o
  multiplayer conecta sempre (sem precisar de `?mp=`).
- O **servidor decide** o papel (`resolveIdentity` + `resolveRole`): visitante sem ticket é sempre espectador; um PLAYER
  pode pedir para assistir (rebaixar), nunca o contrário.

## Servidor (`server/src/spectator/SpectatorSession.ts`)
- **Sem `NetPlayer`, sem slot na grade espacial**: ninguém o vê, não colide, não conta como jogador.
- Área de interesse = **posição da câmera** (`spec_cam {x, z}`), não do corpo. Mesmo código dos jogadores
  (`PresidenteVargasRoom.interestAt`): `SpatialGrid` + `StateView` (jogadores e veículos próximos, 5 Hz fatiado),
  mensagem `crowd` (multidão distante, 2 Hz) e grafites por superfície (`GraffitiService`, posição = câmera).
- `spec_cam` é **validado** (`src/spectator/bounds.ts`): só números finitos, preso aos limites do mapa
  (`manifest.bounds` − 60 m), no máximo 1 a cada 200 ms (o excesso é descartado em silêncio).
- **Toda** mensagem de jogo passa por `gate()` → `can(estado, capacidade, 'spectator')`. O papel espectador não tem
  `world.play`, `vehicle.use`, `action.perform`, `item.hold`, `push`, `graffiti.create` qualquer que seja a conta
  (`PLAYER_ROLE_ONLY` em `src/access/policy.ts`). Resposta: `denied {cap}`.
- Espectador **não tem graça de reconexão**: caiu, sai; o cliente entra de novo (não há entidade a preservar).

### Protocolo
| mensagem | direção | conteúdo |
|---|---|---|
| join `{ role: 'spectator', specCam?: {x,z} }` | C→S | papel pedido + câmera inicial (o servidor prende aos limites) |
| `spawn {…, role: 'spectator'}` | S→C | confirma o papel; posição = câmera |
| `spec_cam {x, z}` | C→S | foco da câmera, 2 Hz quando anda ≥ 6 m, e a cada 3 s (batimento) |
| `denied {cap}` | S→C | qualquer mensagem de jogo do espectador |

## Câmeras (`src/spectator/SpectatorCamera.ts`, `anchors.ts`)
| tecla | câmera | origem |
|---|---|---|
| 1 | CÂMERA LIVRE LIMITADA | WASD/joystick movem o foco, arrastar/mouse gira, roda/pinça muda a distância |
| 2 | CENTRAL | âncora da zona `CENTRAL` (`public/world/zones.json`) olhando o marco da Central do Brasil |
| 3 | CAMPO DE SANTANA | âncora da zona `CAMPO_DE_SANTANA`, ao longo do eixo |
| 4 | CANDELÁRIA | âncora da zona `CANDELARIA` olhando a igreja |
| 5 | TRIO/PALCO | segue o trio elétrico (`trio0`); sem trio, o palco (`manifest.eventSpots` stage) |
| 6 | CÂMERA AÉREA | altitude máxima (260 m) sobre o meio da avenida |

- Limites: foco dentro do mapa (margem 60 m), pitch 0,12–1,45 rad, distância 8–320 m, altitude ≤ 260 m e a **própria
  câmera** dentro do mapa (`clampPose`). Edifício entre foco e câmera → a câmera aproxima (raycast na colisão).
- Transições suaves (amortecimento exponencial; distância em escala logarítmica). Mover em qualquer câmera fixa vira
  câmera livre a partir dali.
- Interface: `CameraSwitcher` (componente montável, atalhos 1–6 ignorados ao digitar no chat) e `SpectatorBadge`
  ("MODO ESPECTADOR") em `src/spectator/SpectatorHud.ts`; estilos em `src/spectator/spectator.css`. O HUD geral
  (rodada 8, E) decide a posição final; hoje o `Game` monta os dois no HUD.
- O "jogador" local do `Game` vira o **foco da câmera**: chunks, NPCs, minimapa, grafites e sombras seguem a câmera.

## Tempo até assistir (`tools/qa/time_to_watch.mjs`, `tools/qa/spectator_mp.mjs`)
Clique → 1º quadro do mundo (`pv:click` → `pv:world-visible`), cache frio, M-series local, build de produção
(`vite build` + `vite preview`), servidor local:

| rede (CDP) | clique → 1º quadro | clique → 1º jogador visível | baixado após o clique |
|---|---|---|---|
| sem limite (localhost) | 3,3 s | 3,5 s | ~5 MB |
| 20 Mbit/s · 40 ms | **5,2 s** | 5,4 s | 5,1 MB |
| 10 Mbit/s · 60 ms | **6,6 s** | 6,8 s | 5,1 MB |

(2 medições por perfil, diferença < 0,1 s.) Meta "< 10 s numa conexão normal": cumprida.

No servidor de desenvolvimento do Vite (módulos soltos, cache quente): ~3,3 s.

## QA
- `tests/spectatorServer.test.ts` — servidor REAL + SDK: espectador forjado manda `move/pmove/mode/enter/exit/board/
  unboard/push/act/prop/gf_new` → 11 negações, nada muda; `spec_cam` move a área de interesse; métricas semânticas.
- `tests/spectatorBounds.test.ts` — limites da câmera, validação/taxa do `spec_cam`, âncoras, capacidades do papel.
- `tools/qa/spectator_mp.mjs` — A jogador + B, C espectadores (navegadores reais): dança, direção, mensagens forjadas,
  troca para a Candelária (a AOI acompanha) e volta, câmera aérea, métricas, tempo até assistir.
- Capturas: `screenshots/round8/B_modo_espectador.png`, `screenshots/round8/C_camera_aerea.png`.

## Limitações
- A área de interesse do espectador tem o mesmo raio dos jogadores (220 m): na câmera aérea, quem está além disso
  não aparece (nem como multidão). Um raio maior só para a aérea custa banda; fica para quando houver medição.
- O espectador não escolhe seguir um jogador específico (só o trio); a interface de "seguir" é da rodada 9.
- A multidão ambiental (NPCs) é local de cada cliente (como para os jogadores).
