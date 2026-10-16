# Roadmap incremental

Princípios:
- O cenário fica **jogável em todo commit**.
- **Fidelidade geográfica primeiro**.
- Software livre e auto-hospedado na VPS (8 vCPU / 16 GB).
- **Nenhum serviço pago e nenhuma mudança em produção sem a sua autorização.**

Legenda: ✅ feito · 🔨 em andamento · ⏳ planejado · 🔒 depende de decisão/conta sua

## Fase 0: Cenário (MVP) ✅
Corredor Central → Candelária com dados reais, landmarks, LOD, colisão, câmera, presets, horário real.

## Fase 1: Personagens e vida na avenida ✅
| Passo | Entrega | Status |
|---|---|---|
| 1.1 | Personagem com **esqueleto real** (SkinnedMesh, 1 draw call), 4 tipos: homem, mulher, idoso, idosa; roupas e tons de pele variáveis | ✅ |
| 1.2 | Escolha de avatar na tela inicial | ✅ |
| 1.3 | **Pedestres NPC** nas calçadas e canteiros, densidade por preset, LOD de atualização | ✅ |
| 1.4 | **Trânsito** na Pres. Vargas: carros, táxis amarelos, ônibus; seguem as faixas reais do OSM no sentido correto | ✅ |
| 1.5 | Semáforos com ciclo; veículos param no vermelho; pedestres usam faixas | ✅ |
| 1.6 | Bicicletas e patinetes montáveis (estações reais) | ✅ · NPC de bicicleta ⏳ |
| 1.7 | Variedade de NPCs (acessórios, paletas de grupo) | ✅ |

## Fase 2: Fidelidade contínua 🔨
- ✅ Dedup de edifícios, overrides documentados, estilo eclético, CCBB, galerias geométricas, monumentos, placas, paradas de ônibus.
- Modelos dedicados no entorno da Candelária: **CCBB**, Centro Cultural Correios, Casa França-Brasil, Associação Comercial.
- Prédios-marco da avenida (Ed. Paulo de Frontin, Banco Central, prédios PA com galeria).
- Galerias reais (mapear no OSM onde existem), bancas e pontos de ônibus reais da avenida.
- Relevo (morros da Providência, São Bento, Conceição) a partir de MDT aberto.
- Validação humana guiada por [MAP_VALIDATION.md](MAP_VALIDATION.md).

## Fase 3: Multiplayer 🔨 (vertical slice local ✅ — ver MULTIPLAYER.md, NETCODE.md, SHARED_WORLD.md)
- ✅ Servidor autoritativo com colisão compartilhada; posse de veículos; empurrão/impacto validados.
- ✅ Mundo compartilhado: relógio, semáforos e trânsito; AOI com `StateView`; predição, reconciliação e interpolação adaptativa.
- ✅ Walkthrough com 3 clientes (27 checagens, também sob 150 ms ± 30 ms); teste de carga até 50 bots.
- ⏳ Pedestres NPC compartilhados (grade de navegação gerada no build + snapshot compacto).
- ⏳ Trânsito como obstáculo autoritativo do carro do jogador; impacto em NPCs.
- ⏳ Reconexão automática, salas por distrito, grade espacial na AOI.
- ⏳ **Espectador gratuito** (câmera livre, sem avatar).
- ⏳🔒 Servidor na VPS (só com autorização; Fase 7).

## Fase 4: Interações físicas não letais 🔨 (empurrão + queda + impacto ✅)
- ✅ Empurrão validado pelo servidor; queda com ragdoll Rapier; levantar; imunidade pós-queda; anti-spam.
- ✅ "Atropelamento" fictício pelo carro do jogador: queda por velocidade, sem dano, bloqueado no modo pacífico.
- ⏳ Soco "cartoon", animações de reação, moderação (denúncia, mute, bloqueio), zonas pacíficas no servidor.

## Próxima rodada recomendada (5)
1. Teste manual em Safari macOS/iPhone, Firefox e um notebook Windows com GPU integrada (o maior risco hoje).
2. Pedestres compartilhados + trânsito como obstáculo no servidor (fecha as diferenças entre clientes).
3. Passada visual dedicada: granito/fachada do Palácio Duque de Caxias, CCBB, Central e Candelária (ver STATUS).
4. Espectador + reconexão; teste com pessoas reais em rede local.

## Fase 5: Plataforma de eventos e mundo social 🔨 (modelo genérico de eventos + painéis de LED ✅ — ver EVENTS.md)
- **Grupos temáticos configuráveis** (política, futebol, outros) em JSON no servidor: nome, cores, bandeira e camisa genéricas.
  Não usamos marcas, escudos ou imagens de pessoas reais sem licença.
- Chat por proximidade e por grupo, com moderação.
- Eventos geolocalizados (concentrações, palcos, caminhões de som) usando as coordenadas reais.

## Fase 6: Contas e monetização 🔒 (adiada por decisão do produto — não implementar agora)
- Autenticação por e-mail (link mágico/OTP), auto-hospedada.
- Acesso de jogador: **Pix R$ 10,00**; espectador gratuito.
- Loja: avatares e personalizações extras (cosméticos, sem vantagem de jogo).
- Painéis de LED virtuais com publicidade: textura de vídeo/imagem com agenda de anúncios no servidor.
- 🔒 **Exige decisões suas**: conta em PSP de Pix (taxas), SMTP/remetente de e-mail, termos de uso e privacidade (LGPD),
  CNPJ/emissão fiscal, política de reembolso. Nada disso será contratado ou ligado sem autorização.

## Fase 7: Produção ⏳🔒
Deploy na VPS Hostinger (Docker Compose: nginx + Node + Postgres + Redis), TLS Let's Encrypt, backups, monitoramento.
**Só com autorização explícita.**
