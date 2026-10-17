# Identidade (rodada 8)

Contratos ÚNICOS — nenhum módulo redefine usuário, sessão, identidade de jogador ou grupo de evento.

| Contrato | Onde |
|---|---|
| Tipos compartilhados (AccessState, AccessGrant, WorldRole, PlayerIdentity, PublicProfile, MeResponse, PublicMetrics, rotas `API`) | `src/identity/types.ts` |
| Autorização central (`deriveAccessState`, `can(state, capacidade, papel)`, `resolveRole`) | `src/access/policy.ts` |
| Moderação de texto central (apelido, chat, grafite, cartaz) | `src/moderation/text.ts` (`textModeration`) |
| Chat: canais, limites, anti-flood, categorias de denúncia | `src/chat/protocol.ts` |
| Zonas (dados em `public/world/zones.json`) | `src/world/zones.ts` |
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
