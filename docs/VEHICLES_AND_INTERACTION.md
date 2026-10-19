# Veículos utilizáveis e modos de interação

## Veículos (`src/vehicles/Rideable.ts`)
Mesma separação do jogador: **estado** (`RideableState`, serializável, com `occupant`) / **simulação**
(`stepRideable`, determinística) / **visual** (modelo + pose no esqueleto do personagem).

| Tipo | Status | Velocidade (normal / Shift) | Onde aparece |
|---|---|---|---|
| Bicicleta | ✅ jogável | 5,6 / 6,9 m/s (20 / 25 km/h) | nas **19 estações reais** de bicicleta compartilhada do OSM (laranja, com cesta) — 38 |
| Patinete | ✅ jogável | 4,7 / 5,5 m/s (17 / 20 km/h) | uma por estação — 25 |
| Carro | ✅ jogável (sedan do `vehicles.glb`, vidros translúcidos + interior) | 6,9 / 8,3 m/s (25 / 30 km/h) | 14 vagas na avenida; não sobe na calçada; tem ré |
| Moto | ✅ jogável | 6,9 / 8,3 m/s | 12 vagas |
| Carro de som / trio | ✅ veículos de evento (passo de cortejo) | 3,5 / 1,2 m/s | evento; trio também tem plataforma (`platform.ts`) |

(Valores em `RIDEABLE_DEFS`; a avenida está fechada para o evento — limites urbanos.)

Controles: **E** sobe/desce, **W/S** acelera/freia (carro: ré), **A/D** vira, **Shift** mais rápido. No toque, botão
**USAR**. Rodada 10: também **clique/toque no veículo** (e SAIR no HUD do veículo) — `InteractionSystem`, ver
[INTERACTION_SYSTEM.md](INTERACTION_SYSTEM.md). O evento ativo decide quais veículos existem (`EventDef.vehicles`).
No multiplayer o servidor é a autoridade (entrar/sair/ocupante/posição validada; estados AVAILABLE/OCCUPIED/RESETTING —
docs/SHARED_WORLD.md).

**Corpo no veículo (rodada 10):** o avatar fica fisicamente no banco — entra (andando até a porta, sentando na soleira /
passando a perna), dirige com mãos no volante/guidão e pés nos pedais/pedaleiras/plataforma (IK leve de 2 ossos), a
bicicleta pedala de verdade e o patinete rema; sai pelo ponto seguro do servidor. Tudo em
**[VEHICLE_MOUNTING.md](VEHICLE_MOUNTING.md)**.

**Para um novo veículo:** `RIDEABLE_DEFS` + modelo em `rideableModel()` (com grupo `steer` no pivô do guidão, se houver)
+ um perfil em `MOUNT_PROFILES` (src/vehicles/seats.ts: âncoras, pose, transições, câmera). Proximidade, uso, rede,
colisão, saída segura e o corpo montado são genéricos.

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
