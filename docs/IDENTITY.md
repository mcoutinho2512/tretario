# Identidade (rodada 8)

Contratos ÚNICOS — nenhum módulo redefine usuário, sessão, identidade de jogador ou grupo de evento.

| Contrato | Onde |
|---|---|
| Tipos compartilhados (AccessState, AccessGrant, WorldRole, PlayerIdentity, PublicProfile, MeResponse, PublicMetrics, rotas `API`) | `src/identity/types.ts` |
| Autorização central (`deriveAccessState`, `can(state, capacidade, papel)`, `resolveRole`) | `src/access/policy.ts` |
| Moderação de texto central (apelido, chat, grafite, cartaz) | `src/moderation/text.ts` (`textModeration`) |
| Chat: canais, limites, anti-flood, categorias de denúncia | `src/chat/protocol.ts` |
| Zonas (dados em `public/world/zones.json`) | `src/world/zones.ts` + rastreador com histerese `src/world/zoneTracker.ts` (HUD: `docs/HUD.md`) |
| Grupos do evento (dados: `groups` em `public/events/<evento>.json`, `joinable/neutral/designKey/suggestedDesigns`) | `src/events/types.ts` |
| Modelo de dados (PostgreSQL) | `server/prisma/schema.prisma` + migrations |
| Acesso ao banco (ÚNICO caminho) | `server/src/data/types.ts` (`DataStore`): `PrismaDataStore` / `MemoryDataStore` |
| Serviços do servidor (banco + tickets) | `server/src/services.ts` |
| Ticket de entrada na sala (uso único, 60 s) | `server/src/identity/tickets.ts` |
| Identidade de cada conexão, resolvida pelo SERVIDOR | `server/src/identity/resolve.ts` → `room.identities` |
| Bloqueio por capacidade em toda mensagem de jogo | `PresidenteVargasRoom.gate()` / `allowed()` |
| API HTTP (`/api/*`, porta PORT+1; o Vite faz proxy → mesma origem) | `server/src/http/router.ts` + `routes.ts` |

## Quatro identificadores diferentes
- **userId** — conta (banco; privado, nunca enviado a outros clientes)
- **authSessionId** — sessão de login (cookie HttpOnly; banco guarda só o hash do token)
- **connectionId** — conexão WebSocket (Colyseus `sessionId`)
- **entityId** — entidade jogável no mundo (chave em `state.players`; estável na reconexão)

## Entrada na sala
1. O navegador autenticado (cookie) faz `POST /api/session/ticket` → ticket aleatório de uso único (60 s).
2. Entra na sala com `{ ticket, role }`. O servidor (`onAuth`) consome o ticket, carrega conta, licença e grupo, e
   **decide** o papel: o pedido do cliente só rebaixa (`resolveRole`).
3. Sem ticket → **espectador visitante**. Servidor de teste (`PV_TEST=1` / `PV_ALLOW_ANON_PLAYERS=1`, nunca em
   produção) → jogador anônimo, para bots e QA.

## Perfil, aparência e preferências (rodada 8)
- **Validador único de aparência**: `src/characters/validateAppearance.ts` — usado pela API (`PUT /api/me/appearance`),
  pela sala (`PresidenteVargasRoom.applyAppearance`) e pelo editor. Corpo/acessório de listas fechadas, cores 24 bits,
  só peças que aquele corpo veste, camisa de futebol só no modelo camiseta, itens bloqueados caem no padrão.
- **Desbloqueio** (`src/characters/unlocks.ts`): níveis `FREE / UNLOCKED / PREMIUM / EVENT_REWARD`; hoje tudo FREE, sem loja.
- **Rotas** (`server/src/http/profile.ts`; sessão por cookie em `server/src/http/session.ts`, `requireUser`):
  `GET/PUT /api/me/appearance` · `GET/PUT /api/me/preferences` · `GET /api/profile/:nickname` (só `PublicProfile`) ·
  `GET /api/events/current` · `PUT/DELETE /api/events/current/membership`. Cada rota só lê/escreve a conta da
  sessão: não há parâmetro de "outro usuário" (teste: `tests/profileApi.test.ts`).
- **Sala**: conta autenticada recebe aparência e grupo do **banco** no `onAuth` (`server/src/identity/appearance.ts`);
  as opções do cliente são ignoradas. A mensagem `appearance` de uma conta é só um aviso "salvei": a sala relê do banco.
- `meExtras(store, userId)` (profile.ts) devolve `appearance/preferences/membership` para a `MeResponse` de `GET /api/me`.
- Cliente: `src/identity/client.ts` (fetch same-origin; nenhum token no JS/localStorage). localStorage guarda só o visual
  de VISITANTE e a qualidade gráfica.

## Grupos do evento (rodada 8)
- Dados: `groups` em `public/events/<evento>.json` (`joinable`, `neutral`, `designKey`, `suggestedDesigns`). Hoje:
  GRUPO 13, GRUPO 22, NEUTRO. Código genérico em `src/events/groups.ts` (nenhum id de grupo no código).
- Banco: `EventGroup.id = "<eventId>:<chave>"`, gravado de forma idempotente na primeira chamada (`ensureEventGroups`).
  `EventMembership` é **por evento** (um grupo por conta e evento).
- Na sala: `identity.groupKey` (para o chat de grupo). Atualizado ao entrar e quando o editor/escolha de grupo avisa.
- **Neutralidade**: grupo muda só aparência (camiseta opcional nas cores; artes sugeridas viram o design padrão ao pegar
  bandeira/cartaz/faixa — `SocialController.preferredDesigns`, nunca obrigatórias). Capacidades, papel, velocidade,
  veículos, AOI/interesse, prioridade e qualidade são idênticos — `tests/groupNeutrality.test.ts` prova e também falha
  se algum código ganhar ramo por grupo específico.
