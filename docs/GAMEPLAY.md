# Gameplay — "o que eu faço depois que entro?" (rodada 9)

A Presidente Vargas é um **mundo social** que comporta manifestação, ato, encontro, rivalidade de grupos e torcidas,
confronto entre jogadores, eventos e exploração — tudo no MESMO mundo, decidido por **dados** (zonas, eventos,
missões) e pelo **servidor**. Confronto faz parte do jogo; participação 100% pacífica também.

## Ciclo

```
ENTRAR → VER O QUE ESTÁ ACONTECENDO → ESCOLHER → PARTICIPAR → PROGREDIR → RECOMPENSA → DESCOBRIR OUTRA ATIVIDADE
```

| Etapa | O que o jogador vê | Onde |
|---|---|---|
| Entrar | cartão "BEM-VINDO À PRESIDENTE VARGAS — Explore a avenida" (um objetivo só); depois as atividades aparecem aos poucos | [PROGRESSION.md](PROGRESSION.md) |
| Ver o que acontece | **Acontecendo agora** (até 3 linhas no HUD), **Agenda da avenida** (☰), telões e painéis, minimapa com marcas de evento, aviso de zona com a política (paz / disputa / confronto) | [EVENTS.md](EVENTS.md), [HUD.md](HUD.md), [AD_SLOTS.md](AD_SLOTS.md) |
| Escolher | missão em destaque, inscrição num evento, ir ao palco, à área de treino, pegar bicicleta/patinete | [MISSIONS.md](MISSIONS.md) |
| Participar | caminhada, corridas, debate, concentração, trio, confronto (opcional), pichação, chat | abaixo |
| Progredir | objetivos avançam pelo servidor; XP, níveis 1–10, conquistas | [PROGRESSION.md](PROGRESSION.md) |
| Recompensa | camisas, bandeiras/cartazes, títulos (cosméticos; nada pay-to-win) | [PROGRESSION.md](PROGRESSION.md) |

## Atividades (sem depender de outros humanos)

| Atividade | Como | Humanos necessários |
|---|---|---|
| Exploração | 6 zonas (Cidade Nova → Candelária), missão CONHEÇA A PRESIDENTE VARGAS, conquista DO INÍCIO AO FIM | 0 |
| Social | bandeiras, cartazes, danças, gestos, concentrações (trio, carros de som, palco), subir no trio, pichação, chat | 0 (NPCs de ambiente animam as concentrações) |
| Mobilidade | 38 bicicletas, 25 patinetes, carros/motos na avenida fechada; missões MOBILIDADE e GRANDE PASSEIO | 0 |
| Caminhada Central → Candelária | agenda a cada 60 min; líder virtual + NPCs que acompanham; vista da câmera aérea | 0 (`minParticipants` 0) |
| Corridas de bicicleta e patinete | Cidade Nova, a cada 30 min; checkpoints, voltas, tempo e posição pelo servidor | 1 (contra o relógio) |
| Debate em texto | palco, fila, turnos com cronômetro, reações da plateia (NPCs reagem junto) | 0 para assistir |
| Treino de confronto | boneco de treino no Campo de Santana; missão opcional TREINO DE CONFRONTO | 0 |
| Confronto de grupos | evento de protótipo (evento `classico-exemplo`), zona CONTESTED, pontuação por objetivo | 2 |

Missões: 10 (exploração, social, mobilidade, evento, debate, confronto opcional). Conquistas: 11. Um caminho
**pacífico**, sem confronto nem eventos agendados, chega ao nível 6 (teste `tests/progression.test.ts`).

## Confronto: parte do jogo, nunca obrigatório

- **Zonas** (dados, `public/world/zones.json`): CIDADE_NOVA **COMBAT**; CENTRAL (spawn) **PEACE**; CAMPO_DE_SANTANA
  **CONTESTED**; CENTRO (o ato/trio) **PEACE**; RIO_BRANCO **CONTESTED** (palco com área de paz); CANDELARIA **PEACE**.
  Áreas de paz móveis em volta do trio e dos carros de som.
- **Consentimento por contexto**: impacto só entre quem está em modo interação (K) numa zona COMBAT, ou entre inscritos
  num evento de confronto ativo nas zonas dele. Pacífico e fora de eventos de confronto = nunca sofre impacto.
- **Arcade**: soco, chute, empurrão, esquiva, combos, taco/barra/spray (spray = desorientação abstrata curta),
  condição e fôlego abstratos, queda e levantar, proteção de retorno. Sem sangue, lesão, morte, arma de fogo.
- **Servidor decide tudo** (alvo, alcance, arco, janela, estado, zona/evento, fôlego, recarga). Detalhes:
  [COMBAT.md](COMBAT.md).
- **Sem farm**: nenhum XP por golpe; recompensa de confronto só por objetivo/evento concluído.

## Neutralidade

Grupos políticos, torcidas (nomes fictícios, só cores/padrões, sem escudos) e NEUTRO têm a MESMA mecânica: força,
fôlego, velocidade, condição, alcance, prioridade. Progressão nunca exige lado, grupo ou atacar humanos. Testes:
`tests/groupNeutrality.test.ts` (inclui o confronto de grupos com lados trocados → mesmo resultado).

## Mundo vazio

NPCs de ambiente (cliente, determinísticos) participam de concentrações, caminhada, plateia do debate e reações — e
continuam **separados** dos jogadores: `playersOnline` nunca conta NPC; a agenda conta só humanos inscritos.

## Telemetria de gameplay

Contadores agregados no servidor (sessões, missões iniciadas/concluídas, eventos, zonas, corridas, debate,
participação em confronto) para medir retenção no futuro — sem serviço externo, sem conteúdo privado:
`npm run dev:telemetry` ([PROGRESSION.md](PROGRESSION.md)).
