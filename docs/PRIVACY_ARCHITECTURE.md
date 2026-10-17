# Arquitetura de privacidade (rodada 8)

Princípio: guardar o mínimo, nada que identifique a pessoa fora do jogo além do e-mail de login, e nunca segredo em
claro. Cada módulo acrescenta aqui a sua seção.

## Conta, autenticação e sessão

| Dado | Onde | Forma | Quem vê |
|---|---|---|---|
| E-mail | `User.email` | normalizado (minúsculas) | só o servidor; nunca em DTO público nem no `GET /api/me` |
| Senha | `User.passwordHash` | scrypt com sal por usuário (`scrypt$N$r$p$sal$hash`) | ninguém (irreversível) |
| Token de sessão | cookie `pv_sid` (HttpOnly) / `Session.tokenHash` | banco guarda só SHA-256 | só o navegador do usuário |
| Código de e-mail / redefinição | `VerificationCode.codeHash` | HMAC com segredo do servidor; 15 min; uso único | só o e-mail do usuário |
| Navegador | `Session.uaHash` | 16 caracteres de SHA-256 do user-agent | ninguém (só comparação) |
| IP | **não gravado** | HMAC com chave aleatória do processo, só em memória, para limitar taxa | ninguém; some ao reiniciar |
| Apelido | `Profile.nickname` / `nicknameKey` | público (é o nome no jogo) | todos |
| Ticket de entrada | memória do servidor | aleatório, uso único, 60 s | — |

- Logs do servidor: nunca senha, token ou código — exceto o `DevelopmentMailProvider`, que existe para escrever o
  código no console **em desenvolvimento** e recusa iniciar em produção. A caixa de saída de dev (`/api/dev/outbox`)
  só existe com `PV_DEV_MAIL=1` fora de produção.
- `AuditLog` registra quem fez o quê (ator, ação, alvo, motivo) — nunca segredo. Ids de usuário são internos.
- `GET /api/me` devolve apenas dados do próprio usuário (apelido, verificação, situação, data de criação, acesso,
  aparência, preferências, grupo); perfis públicos usam `PublicProfile` (mês de entrada, não a data).
- Mensagens de erro não revelam se um e-mail tem conta (login genérico; esqueci-a-senha com resposta única). Exceção
  documentada: o cadastro responde `email_em_uso`, limitado por IP.

## Retenção (auth/sessão)

| Registro | Retenção prevista | Situação na rodada 8 |
|---|---|---|
| `Session` revogada/expirada | apagar após 30 dias | sem limpeza automática ainda (linhas ficam inválidas; não dão acesso) |
| `VerificationCode` consumido/expirado | apagar após 24 h | sem limpeza automática ainda (só o mais recente vale) |
| Limites de taxa (IP/e-mail) | até 1 h, só memória | automático |
| `AuditLog` / `ModerationAction` | enquanto a conta existir + prazo legal a definir | permanente |
| `User` e dependentes | até o pedido de exclusão (cascade em perfil, aparência, sessões, códigos, acessos, grupos) | exclusão de conta ainda sem rota/CLI |

Pendências antes de produção: tarefa de limpeza de sessões/códigos vencidos, exclusão de conta pelo usuário, provedor de
e-mail real com política própria de logs, segredo `PV_SESSION_SECRET` forte.


Princípio: o servidor guarda o mínimo, pelo menor tempo, e nunca envia identificadores internos (userId, sessionId,
clientId, e-mail, IP) a outros clientes. Identidade: `docs/IDENTITY.md`.

## Chat

- **Mensagens não são persistidas.** Elas vivem só em memória do processo da sala:
  - histórico do GERAL para quem entra: últimas 30 (só apelido, texto, hora);
  - cópia interna para denúncia: até 15 min / 2000 mensagens (anel; some ao reiniciar a sala).
- O que vai a clientes: `{ id, canal, apelido, nid (id curto da entidade no mundo), grupo (só no canal GRUPO), texto, hora }`.
  Nunca userId, sessionId ou clientId.
- PROXIMIDADE/GRUPO: destinatários decididos pelo servidor; espectadores não recebem PROXIMIDADE (não estão no local).
- Mutar (8.1): por identidade. Com conta: tabela `MuteRelationship` (dono, mutado, apelido no momento), apagada em
  cascata com qualquer das contas; sem conta: só na memória da conexão. O cliente recebe só `{ ref, apelido, desde }`
  da PRÓPRIA lista — `ref` é HMAC opaco do par com o segredo do servidor; userId nunca sai do servidor nem é aceito do
  cliente. Ninguém consulta a lista de outro; o mutado não é avisado.
- Logs do servidor: registram que houve denúncia (id do Report, categoria, id da mensagem, apelido de quem denunciou),
  não o texto das conversas.

## Denúncias (Report)

- Origem: mensagem de chat (`CHAT_MESSAGE`) ou grafite (`GRAFFITI`). Exige conta (`report.create`).
- `reportedNicknameAtTime`: cópia do apelido do denunciado no momento (chat: o da mensagem; grafite: o do autor) para a
  revisão — a identidade continua sendo `targetUserId`. Aparece em `npm run dev:reports` (`apelido_na_hora=`).
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


## Grupo do evento (rodada 8)
- A escolha de grupo (GRUPO 13 / GRUPO 22 / NEUTRO ou nenhum) é uma `EventMembership` **ligada a um evento**, não um
  atributo permanente da conta: não aparece no perfil público (`GET /api/profile/:nickname` devolve só apelido, nome
  exibido, aparência e mês de entrada), não é copiada para outros eventos e pode ser apagada a qualquer momento
  (`DELETE /api/events/current/membership`, botão SEM GRUPO).
- Outros jogadores só veem o efeito visual que a pessoa escolheu vestir (camiseta/arte). O servidor guarda o grupo para
  o chat de grupo do evento; nenhum dado de grupo é enviado em métricas públicas.
- Nenhuma regra de jogo usa o grupo (ver `docs/IDENTITY.md`, seção Grupos), então não há incentivo nem penalidade por lado.
- Retenção: memberships de eventos encerrados podem ser apagadas junto com o evento (política operacional; sem uso analítico).

## Perfil e aparência
- Perfil público mínimo (`PublicProfile`): sem e-mail, ids internos, IP ou datas exatas (só AAAA-MM).
- Sessão em cookie HttpOnly; o banco guarda só o hash do token. Nenhum token em localStorage.

## Espectadores, presença e métricas públicas (rodada 8)

- **Espectador visitante** (sem ticket) não tem conta nem identificador persistente: o servidor guarda só, em memória e
  enquanto a conexão durar, o id da conexão, o papel, o foco da CÂMERA (x, z, preso aos limites do mapa) e o instante do
  último `spec_cam`. Nada disso vai para o banco, para logs de longa duração nem para outros clientes — o espectador não
  é entidade, ninguém o vê nem sabe para onde a câmera dele aponta. O `cid` anônimo do aparelho (grafites) só é usado
  para a área de interesse de grafites; o espectador não pode criar nem denunciar grafites.
- **Espectador com conta**: o mesmo; a conta só aparece na presença (abaixo) e nunca é revelada a outros jogadores.
- **Presença** (`PresenceTracker`) é só memória: userId (quando há), papel, se é bot de teste, horários de atividade/
  batimento. Desaparece quando a conexão sai. Não é gravada por quadro nem por mensagem; um `lastSeen` futuro no banco
  deve ser grosso (saída ou a cada vários minutos) e entra na retenção da conta.
- **Reconexão**: durante a graça (20 s) o servidor mantém a entidade (posição/estado de jogo), não dados novos; o token
  de reconexão é do Colyseus (aleatório, da sessão) e expira junto com a graça.
- **Métricas públicas** (`GET /api/metrics/public`): só CONTAGENS agregadas (jogadores, espectadores, conexões, bots de
  teste, multidão simulada) + id/nome do evento. Nenhum nome, id, posição ou endereço; cache de 1,5 s (não permite
  correlacionar a entrada/saída de uma pessoa específica com precisão de segundos).
- **Logs do servidor** de desenvolvimento registram ids de conexão (efêmeros) em entrada/saída/queda/substituição —
  nunca userId, e-mail ou IP.
