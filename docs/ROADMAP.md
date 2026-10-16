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

## Fase 3: Multiplayer 🔨 (esqueleto local ✅ — ver MULTIPLAYER.md)
- Servidor Node.js autoritativo na VPS. Colyseus (MIT) ou `ws`/uWebSockets.js; ver [DECISIONS.md](DECISIONS.md).
- `RemotePlayer` = `PlayerState` vindo da rede + o mesmo `AvatarVisual`.
- Interest management por células de 50 m, interpolação, snapshots delta.
- **Espectador gratuito** (câmera livre, sem avatar) e jogador.

## Fase 4: Interações físicas não letais 🔨 (arquitetura de modos ✅; ragdoll ⏳)
- Empurrão, soco "cartoon", queda e levantar; **ragdoll** (Rapier, Apache-2.0, WASM) só em quem cai e perto da câmera.
- "Atropelamento" fictício: o veículo derruba o personagem em ragdoll, sem sangue nem dano permanente; respawn imediato.
- **Modo pacífico** (padrão para novos jogadores): ninguém agride nem é agredido; zonas pacíficas no servidor.
- Moderação: denúncia, mute, bloqueio, limites anti-spam.

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
