# Comparação com o Paulista Livre (manifestacao.com)

_2026-10-16 · referência pública: home, /sobre._

O Paulista Livre é um jogo multijogador de navegador sobre uma manifestação na Av. Paulista: escolher um dos dois lados,
montar o visual, chat, bandeiras/cartazes, veículos (moto, carro, carro de som, carreta, dirigível), telões com vídeo do
jogador, superchat, login (Google/Kick/e-mail) e acesso por R$ 10 via Pix (contas antigas gratuitas).

Usamos isso só como referência de **mecânica e modelo de negócio**. Nome, marca, textos e arte são nossos.

## Onde estamos (rodada 7)

| Recurso do Paulista Livre | Presidente Vargas 3D | Situação |
|---|---|---|
| Cenário real reconhecível | Central → Candelária com dados OSM, 41 prédios-marco, landmarks dedicados, horário/sol reais | ✅ (mais fiel que a referência) |
| Montar o visual | 4 corpos, 360 combinações de roupa, prévia 3D | ✅ |
| Bandeira e cartaz | bandeiras, cartazes, faixa, megafone, apito, surdo; designs neutros + campanhas como dados | ✅ |
| Dançar, acenar, comemorar | 29 ações sincronizadas (roda de ações) | ✅ |
| Carro, moto | 14 carros, 12 motos, 38 bicicletas, 25 patinetes | ✅ |
| Carro de som / carreta | carros de som + trio elétrico com palco para 20 jogadores; 4 caminhões | ✅ |
| Dirigível | — | ⏳ não existe |
| Telões | 2 telões + trio/palco com conteúdo próprio | ✅ parcial (sem vídeo enviado pelo jogador) |
| Spray | pichação em 76 superfícies, filtro, denúncia, TTL | ✅ |
| Multiplayer ao vivo | Colyseus autoritativo, testado com 500 bots | ✅ só local |
| **Escolher um lado** | grupos temáticos planejados (Fase 5) | ⏳ **falta** |
| **Chat** (geral e por proximidade) | planejado (Fase 5) | ⏳ **falta** |
| Superchat | — | ⏳ falta (depende de pagamento) |
| **Login** (Google/e-mail) | ADR-006 adiado em 2026-10-15 | 🔒 falta, depende de decisão |
| **Pix R$ 10** | ADR-007 adiado em 2026-10-15 | 🔒 falta, depende de PSP |
| Cartazes personalizados com aprovação | editor de pichação existe; fila de moderação não | ⏳ falta |
| Espectador gratuito | planejado | ⏳ falta |
| No ar, em domínio público | só local | 🔒 Fase 7, só com autorização |

## O que falta para "igual", em ordem

1. **Lados + chat** (sem dependência externa): escolha de lado na tela inicial, cor/identidade do lado no avatar e nos
   itens, chat geral + proximidade + do lado, com filtro de texto, mute, denúncia e limite de taxa no servidor.
2. **Espectador gratuito** e reconexão automática.
3. **Login**: e-mail com código (OTP) auto-hospedado + "Entrar com Google" (OAuth gratuito). Precisa de SMTP/remetente.
4. **Pix R$ 10** com confirmação automática: precisa de conta em PSP (Mercado Pago, Efí, Asaas…) — taxa por transação.
   Termos de uso, privacidade (LGPD), reembolso e emissão fiscal pela MC Consultoria.
5. Cartazes personalizados com fila de aprovação, telão com vídeo do jogador (moderado) e superchat.
6. Dirigível com publicidade.
7. Deploy na VPS Hostinger (Docker Compose, TLS), domínio próprio.

Os itens 3, 4 e 7 só avançam com autorização explícita e as contas/decisões listadas.
