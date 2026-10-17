# Arquitetura de privacidade

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
