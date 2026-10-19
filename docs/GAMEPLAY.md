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
| Treino de confronto | boneco de treino no Campo de Santana; missão opcional TREINO DE CONFRONTO; NPCs de ambiente reagem a golpes em toda a avenida | 0 |
| Confronto de grupos | evento de protótipo (evento `classico-exemplo`), zona CONTESTED, pontuação por objetivo | 2 |

Missões: 10 (exploração, social, mobilidade, evento, debate, confronto opcional). Conquistas: 11. Um caminho
**pacífico**, sem confronto nem eventos agendados, chega ao nível 6 (teste `tests/progression.test.ts`).

## Confronto: a avenida toda (decisão do dono, 2026-10-18)

Decisão do dono, literal: **"Avenida toda, sem nenhuma área de paz"** + **"bater em todos"** (NPCs da multidão e outros
jogadores, sem modo interação/K) + taco/barra/spray direto. Tudo por dados — o código das regras antigas continua e
volta pelos mesmos campos:

- **Zonas** (`public/world/zones.json`): as 6 zonas são **COMBAT**, sem `peaceAreas`; `derivedPeaceAreas: false`
  desliga as áreas de paz do spawn, do palco, dos anéis do trio/carros de som e dos retornos de evento.
- **Sem consentimento** (`combatConsent: "none"`): **jogador pacífico também pode ser atingido em qualquer lugar** —
  golpe, empurrão (F) e carro/moto. K continua existindo, mas não protege. **Só a proteção de retorno de 5 s** (entrar,
  reconectar, levantar, retorno de evento) bloqueia impacto; regras de evento (`friendlyFire`) continuam valendo.
- **Golpe sempre anima** para todos, mesmo quando o impacto é bloqueado; SOCO/CHUTE/ESQUIVA de toque sempre visíveis.
- **NPCs de ambiente** (pedestres e multidão das concentrações) reagem no cliente: cambaleiam, caem e levantam
  (~4 s), ou cobrem os olhos (spray). São locais de cada cliente; não afetam ninguém mais.
- **Itens**: taco, barra e spray direto da roda de ações (ITENS), em qualquer lugar (`freeCombatProps`); os pontos de
  apoio e o chão continuam funcionando. Espectador não segura item nem golpeia.
- Regra anterior (até 2026-10-18, religável): CIDADE_NOVA COMBAT; CENTRAL, CENTRO e CANDELARIA PEACE; CAMPO_DE_SANTANA e
  RIO_BRANCO CONTESTED; impacto só entre quem estava em modo interação (K) ou inscrito num evento de confronto.
- **Arcade**: soco, chute, empurrão, esquiva, combos, taco/barra/spray (spray = desorientação abstrata curta),
  condição e fôlego abstratos, queda e levantar, proteção de retorno. Sem sangue, lesão, morte, arma de fogo.
- **Servidor decide tudo** (alvo, alcance, arco, janela, estado, zona/evento, fôlego, recarga). Detalhes:
  [COMBAT.md](COMBAT.md).
- **Sem farm**: nenhum XP por golpe; recompensa de confronto só por objetivo/evento concluído.
- **Rodada 9.1** (testes do dono em produção): golpe **só acerta de perto** (soco 1,2 · chute 1,5 · empurrão 1,5 ·
  taco 1,7 m, folga 0,25 m) com mira assistida e avanço curto no cliente; chute, taco e barra derrubam; NPC derrubado
  cai sentado e levanta pela animação. Itens e gestos também na **barra de ações** do centro inferior (Veículos,
  Itens, Pichar, Confronto, Gestos, Personagem, Mapa — [HUD.md](HUD.md)); o item escolhido pode ser largado (Z/X,
  roda G ou barra). Tabela completa em [COMBAT.md](COMBAT.md#ações-dados).

## Rodada 10 — torcidas, clique/toque, veículos de verdade, som

- **Torcidas** (Flamengo, Vasco, Fluminense, Botafogo, ou nenhuma/neutro): identidade do perfil, escolhida na tela
  TORCIDA, sem nenhuma vantagem mecânica; camisas e bandeiras por cores/padrões (sem escudo, fabricante ou
  patrocinador). Concentrações de torcida com NPCs nas cores e o evento **Encontro das torcidas** (sem confronto).
  Troca de torcida durante evento competitivo fica pendente até o fim. Detalhes: [SUPPORTER_GROUPS.md](SUPPORTER_GROUPS.md).
- **Clicou/tocou → interagiu**: carro (Entrar), moto/bicicleta (Montar), patinete (Usar), item (Pegar), trio (Subir),
  pessoa (painel com perfil público, gestos, silenciar, denunciar). O servidor continua decidindo distância,
  ocupação e estado. [INTERACTION_SYSTEM.md](INTERACTION_SYSTEM.md).
- **Avatar no veículo**: entra pela porta/perna, fica visível sentado ou montado, mãos no volante/guidão, pedala,
  rema no patinete, sai em ponto seguro. [VEHICLE_MOUNTING.md](VEHICLE_MOUNTING.md).
- **Som**: ambiente da avenida, multidão agregada por célula (nunca uma voz por pessoa), trio e carro de som
  espaciais, motores, passos e golpes arcade — tudo gerado por código. [AUDIO_SYSTEM.md](AUDIO_SYSTEM.md).
- **Confronto**: golpes e transições refinados (sem mudar dano, alcance, fôlego ou recarga). [COMBAT.md](COMBAT.md).
- Regra de zonas inalterada (decisão do dono de 2026-10-18: avenida toda em confronto, só a proteção de 5 s).

## Rodada 11 — inventário, equipamentos e acesso rápido

- **INVENTÁRIO** (tecla I ou botão no HUD): tudo que o personagem pode usar, por categoria — roupas, acessórios,
  itens, manifestação, bandeiras, equipamentos (taco/barra/spray), torcida e títulos. Bloqueados mostram o motivo
  (nível, missão, conquista); nada se compra. Prévia 3D para roupas e acessórios. [INVENTORY.md](INVENTORY.md)
- **Acesso rápido 1–5**: bandeira, cartaz, megafone, taco… na mão com uma tecla ou um clique; de novo guarda.
  Equipar bandeira/cartaz por ali conta nas missões como antes (o servidor recebe o mesmo pedido `prop`).
- **Título e nível públicos**: o título ganho que a pessoa escolhe e o nível aparecem no painel da pessoa.
  Regras de slot e de servidor: [EQUIPMENT_SYSTEM.md](EQUIPMENT_SYSTEM.md).

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

## Rodada 12 — mundo dinâmico
A avenida muda sozinha: personagens autônomos formam **concentrações** a partir de um núcleo pequeno (outros chegam,
alguns saem), que podem virar **manifestação**, **caminhada** pelo eixo, **encontro de torcidas** ou **festa**; surgem
**corridas improvisadas**; e, raramente, uma **discussão** vira **briga** e, por adesões, **briga generalizada** —
com orçamento por hora e por região (nunca "uma briga por minuto") e desescalada por cansaço e dispersão. Os eventos
vivos aparecem em "Acontecendo agora" e no minimapa; o áudio e o HUD recebem a intensidade de multidão, torcida e
confronto pela mensagem `dyn`. O jogador participa indo até lá (sem inscrição) e só vira alvo de reação se agredir
alguém. Detalhes e números: [DYNAMIC_WORLD.md](DYNAMIC_WORLD.md).
