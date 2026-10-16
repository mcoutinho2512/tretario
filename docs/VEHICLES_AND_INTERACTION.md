# Veículos utilizáveis e modos de interação

## Veículos (`src/vehicles/Rideable.ts`)
Mesma separação do jogador: **estado** (`RideableState`, serializável, com `occupant`) / **simulação**
(`stepRideable`, determinística) / **visual** (modelo + pose no esqueleto do personagem).

| Tipo | Status | Velocidade (normal / Shift) | Onde aparece |
|---|---|---|---|
| Bicicleta | ✅ jogável | 6,5 / 9 m/s | nas **19 estações reais** de bicicleta compartilhada do OSM (laranja, com cesta) |
| Patinete | ✅ jogável | 5,5 / 7 m/s | uma por estação |
| Automóvel | 🔨 definido (`RIDEABLE_DEFS.car`, pose `drive`) | 14 / 18 m/s | sem spawn/modelo ainda; não pode subir na calçada |

Controles: **E** sobe/desce, **W/S** acelera/freia, **A/D** vira, **Shift** mais rápido. No toque, botão **USAR**.
O evento ativo decide quais veículos existem (`EventDef.vehicles`). No multiplayer, o modo (`bicycle`/`scooter`)
altera a velocidade máxima aceita pelo servidor, e os remotos aparecem montados.

**Para um novo veículo:** adicionar em `RIDEABLE_DEFS`, um modelo em `rideableModel()` e uma pose no animador. O resto
(proximidade, uso, rede, colisão) é genérico.

## Modos de interação (`src/interaction/InteractionMode.ts`)
| Modo | O que permite |
|---|---|
| **PACÍFICO** (padrão) | explorar; não agride nem é agredido |
| **INTERAÇÃO** | futuramente empurrões, socos estilizados, quedas e ragdoll. **Sem sangue, mutilação ou morte** |

- O evento define a política: `interaction: 'pacifico'` trava o modo; `'opcional'` deixa alternar com **K**.
- **F** (no modo interação) gera um `ActionRequest` numa fila (`outbox`) com cooldown. **Quem decide o resultado é o servidor**
  (alcance, modo de ambos, zonas pacíficas). Enquanto não há validação no servidor, o único efeito local é um empurrão leve em
  **NPCs de ambiente** (tropeçam e se afastam). Nada acontece com jogadores reais.
- **Ragdoll:** `RAGDOLL_LAYOUT` mapeia os 17 ossos para corpos rígidos e juntas (esférica/dobradiça) para integração com
  **Rapier** (Apache-2.0, WASM). Plano: ativar só em quem cai, perto da câmera, com o resultado autoritativo no servidor.
