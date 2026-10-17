# Arquitetura de privacidade

Princípio: o servidor guarda o mínimo, pelo menor tempo, e nunca envia identificadores internos (userId, sessionId,
clientId, e-mail, IP) a outros clientes. Identidade: `docs/IDENTITY.md`.

## Chat

- **Mensagens não são persistidas.** Elas vivem só em memória do processo da sala:
  - histórico do GERAL para quem entra: últimas 30 (só apelido, texto, hora);
  - cópia interna para denúncia: até 15 min / 2000 mensagens (anel; some ao reiniciar a sala).
- O que vai a clientes: `{ id, canal, apelido, nid (id curto da entidade no mundo), grupo (só no canal GRUPO), texto, hora }`.
  Nunca userId, sessionId ou clientId.
- PROXIMIDADE/GRUPO: destinatários decididos pelo servidor; espectadores não recebem PROXIMIDADE (não estão no local).
- Mutar: lista de apelidos normalizados no navegador (`localStorage`) e, com conta, em `preferences.chatMuted` do
  perfil (só do próprio usuário; não é exposta a ninguém).
- Logs do servidor: registram que houve denúncia (id do Report, categoria, id da mensagem, apelido de quem denunciou),
  não o texto das conversas.

## Denúncias (Report)

- Origem: mensagem de chat (`CHAT_MESSAGE`) ou grafite (`GRAFFITI`). Exige conta (`report.create`).
- **Evidência = cópia do servidor**, não o que o cliente envia: texto, canal, hora, apelido e userId do autor, grupo,
  nº de destinatários e até 3 mensagens anteriores do autor (contexto). Grafite: superfície, nome, userId do autor (ou
  id anônimo do aparelho, só em servidor de teste), estado e nº de denúncias — o desenho continua no armazenamento de
  grafites enquanto existir.
- Visível só para moderação no servidor (`dev:reports` / `DataStore.reports`); nunca para outros jogadores; o autor
  não sabe quem denunciou.
- Limites: 1 denúncia por pessoa por mensagem; 6 por 10 min por denunciante (chat); 10/min (grafite).
- **Retenção (conceito):** Reports ficam **180 dias** após a decisão (REVIEWED/DISMISSED/ACTIONED) e depois são apagados
  com a evidência; OPEN não expira sem revisão. Ação de moderação resultante (ModerationAction/Audit) segue a política
  de auditoria. A limpeza periódica ainda não está implementada (tarefa do painel de moderação).
