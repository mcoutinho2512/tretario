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
