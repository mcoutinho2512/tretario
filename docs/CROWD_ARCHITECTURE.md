# Estratégia futura para multidões (centenas a milhares de pessoas na Pres. Vargas)

Documento de visão (rodada 1). **A primeira implementação real está em [CROWDS.md](CROWDS.md)** (rodada 6):
grade espacial e limite de detalhados no servidor, multidão distante compacta, orçamento único de humanos e
multidão instanciada com animação assada em textura (VAT). O restante deste documento continua como plano.

## Decisões atuais que preparam o terreno
- `PlayerState` é dado puro e serializável; `stepPlayer` é determinístico; `AvatarVisual` só lê o estado.
- Coordenadas em metros num sistema ENU fixo (origem documentada): servidor e clientes usam a mesma
  base, e lat/lon são convertidos sem perda.
- Os chunks de 250 m já são a unidade natural de **particionamento espacial** e de **interesse**.
- A colisão é 2D (grade de segmentos e mapa de alturas): barata para milhares de agentes, inclusive no servidor.

## Renderização
1. **Instancing de personagens**: um `InstancedMesh` (ou `BatchedMesh`) por arquétipo/LOD. Variedade
   (roupas, cores, altura, faixas, bandeiras) por atributos de instância, sem multiplicar materiais.
2. **Animação por textura (VAT / baked skinning)**: os ciclos idle/walk/run/acenar/pular são gravados numa
   textura de matrizes de osso; o vertex shader lê o quadro por instância (fase + clipe). Zero custo de CPU por personagem.
3. **LOD de animação**:
   - < 25 m: personagem rigado completo (skinning na GPU, IK de pés opcional), até ~30 personagens
   - 25–80 m: VAT a 15–30 fps de amostragem
   - 80–250 m: VAT simplificado (malha de ~300 tris, 2–3 clipes)
   - \> 250 m: **impostores** (billboards com atlas de 8 direções × N quadros), ou massa volumétrica (dots/sprites)
4. **Impostores de multidão densa**: blocos de pessoas como cartões com profundidade/normal pré-renderizadas,
   em instâncias por quadrante da avenida.
5. Sombras só para o LOD próximo; ao longe, *blob shadows* instanciadas ou contribuição no AO.
6. Culling por chunk e frustum por instância (compute/transform feedback quando houver WebGPU).

## Rede
1. **Interest management** por célula espacial (chunk de 250 m subdividido em 50 m): cada cliente assina
   as células num raio, com prioridade por distância e pelo cone de visão.
2. **Relevância e taxa adaptativa**: perto, 10–20 Hz com posição e rumo; médio, 2–5 Hz; longe, só a
   densidade agregada por célula (contagem e direção média), que o cliente transforma em multidão procedural.
3. **Compressão**: posições quantizadas relativas à célula (16 bits por eixo dá ~4 mm em 250 m), rumo em 8 bits e estado em bitfield; snapshots delta.
4. **Interpolação** no cliente (buffer de 100–150 ms), com extrapolação curta.
5. **Autoridade**: servidor autoritativo para os jogadores. NPCs de multidão simulados no servidor por
   campos de fluxo, ou de forma determinística no cliente a partir de sementes, para multidões "de cenário".

## Simulação de multidão (NPCs)
- **Campos de fluxo** sobre a grade de superfícies já existente (pista, calçada, praça), para trajetos
  como "concentração na Candelária → Central".
- **Evitação local** (ORCA/RVO simplificado ou *steering* com grade de densidade) em Web Workers.
- **Particionamento espacial** com hash espacial de células de 2–4 m para vizinhança.
- Comportamentos de manifestação: blocos, cordões, palco/caminhão de som como atratores, bloqueios de pista como obstáculos dinâmicos inseridos no `CollisionWorld`.

## Orçamentos-alvo (desktop médio)
| Item | Meta |
|---|---|
| Personagens visíveis | 2.000–5.000 (com impostores) |
| Draw calls de multidão | < 20 |
| CPU por frame (multidão) | < 2 ms (instâncias atualizadas em Worker com SharedArrayBuffer) |
| Banda por cliente | < 64 kbit/s em média |
