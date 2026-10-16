# Registro de decisões (ADR)

Cada decisão: contexto → decisão → alternativas → consequências. As marcadas 🔒 dependem de você.

## ADR-001: WebGL2 como base; WebGPU opcional no futuro
- **Decisão:** three.js com WebGLRenderer. Quando o projeto amadurecer, avaliar o `WebGPURenderer` (TSL) com fallback automático.
- **Por quê:** o iPhone/Safari só tem WebGPU estável há pouco tempo e com variações entre versões; WebGL2 roda em Windows, Mac e iPhone.

## ADR-002: Personagens com esqueleto procedural (sem asset externo, por enquanto)
- **Contexto:** o avatar de primitivas tinha ~20 malhas por personagem. NPCs e multiplayer exigem 1 draw call por personagem e ossos (ragdoll).
- **Decisão:** gerar em runtime uma malha `SkinnedMesh` única por tipo de corpo (homem, mulher, idoso, idosa), com
  esqueleto humanoide de 18 ossos e animação procedural aplicada aos ossos. Cores por vértice (pele, roupa) e variação por instância.
- **Alternativas:** GLB CC0 (Quaternius/Kenney) com animações Mixamo-like. Ficam para quando a direção de arte for definida
  e a licença verificada. O esqueleto usa nomes compatíveis para facilitar a troca.
- **Consequência:** os mesmos ossos servem para o ragdoll (Rapier) e para animações vindas de GLB no futuro.

## ADR-003: NPCs e veículos no cliente, determinísticos e locais (por enquanto)
- **Decisão:** pedestres e trânsito de "ambiente" são simulados no cliente, com semente, ao redor da câmera, e não vão para a rede.
  NPCs que interagem com jogadores (fase 4) passam a ser autoritativos no servidor.
- **Por quê:** custo zero de servidor para dar vida à cidade; facilita crescer depois.

## ADR-004: Servidor multiplayer
- **Proposta:** Node.js + **Colyseus** (MIT): salas, sincronização de estado, matchmaking, reconexão. Alternativa
  mais leve: `uWebSockets.js` com protocolo binário próprio, se o Colyseus limitar com milhares de jogadores.
- **Infra:** a VPS de 8 vCPU / 16 GB comporta, como estimativa a medir, 1 processo de simulação por "distrito" (até ~500 jogadores ativos)
  + Postgres + Redis. Escala horizontal por distrito/sala.

## ADR-005: Física
- **Decisão:** manter a colisão leve atual para locomoção. **Rapier** (Apache-2.0, WASM, determinístico) só para ragdoll,
  empurrões e impacto de veículos, ativado sob demanda perto da câmera e no servidor para o resultado autoritativo.

## ADR-006 🔒⏸: Autenticação por e-mail (ADIADA — decisão de produto de 2026-10-15)
- **Proposta:** link mágico/OTP por e-mail com biblioteca open-source (Lucia-like/Auth.js self-hosted), sessões no Postgres.
- **Ponto de decisão:** enviar e-mail exige um remetente confiável. Opções: SMTP próprio na VPS (grátis, porém com
  entregabilidade ruim e risco de cair em spam) ou um provedor com plano gratuito (há limites e é um serviço externo).
  **Aguardando sua escolha.**

## ADR-007 🔒⏸: Pagamento Pix (ADIADO — decisão de produto de 2026-10-15)
- **Fato:** gerar um QR Pix "copia e cola" (padrão BR Code/EMV) é grátis e open-source, mas **confirmar o pagamento
  automaticamente** exige a API de um PSP/banco (Efí, Mercado Pago, Asaas, Banco do Brasil, Inter…), com conta, taxas e contrato.
- **Proposta:** módulo `payments` com interface `PaymentProvider` e uma implementação "manual/sandbox" para desenvolvimento.
  O provedor real entra só depois da sua escolha e das credenciais. Requisitos legais (termos, LGPD, nota fiscal) também são decisão sua.
- Espectador: gratuito, sem pagamento.

## ADR-008: Conteúdo de grupos (política/futebol) e publicidade
- **Decisão:** grupos 100% configuráveis em dados (nome, cores, símbolo genérico). Sem marcas de clubes, partidos ou imagens
  de pessoas reais sem licença; o operador cadastra o que tiver direito de usar. Painéis de LED exibem criativos
  cadastrados, com moderação e agenda.

## ADR-009: Interações não letais
- **Decisão:** sem sangue, sem morte e sem dano permanente: quedas e ragdoll com levantar/respawn. Modo pacífico como padrão
  e zonas pacíficas configuráveis. O "atropelamento" derruba e o personagem levanta, com tom de comédia física.

## ADR-010: Plataforma de eventos orientada a dados
- **Decisão:** `Event`, `Group`, `Team`, `AvatarOption`, `Cosmetic`, `WorldDecoration`, `BillboardPlan`, `VehicleOption` em
  `src/events/types.ts`; eventos são JSON (`public/events/`). O código não conhece temas, e um teste garante que nomes de
  clubes ou políticos não aparecem em `src/`.
- **Consequência:** trocar de evento (dia comum, clássico, ato, show) não exige rebuild; o backend futuro só serve JSON.

## ADR-011: Veículos utilizáveis com estado/simulação/visual separados
- Bicicleta e patinete nas estações reais do OSM; carro definido mas não exposto (custo de modelo/física maior).
- O mesmo `RideableState` vai para a rede no futuro; no MVP o servidor valida a velocidade conforme o modo.

## ADR-012: Modos pacífico/interação com outbox de ações
- O pacífico é o padrão; o evento define se o modo é opcional. Ações viram pedidos (`ActionRequest`) para validação no servidor.
- Ragdoll (Rapier) planejado sobre os 17 ossos (`RAGDOLL_LAYOUT`), ativado sob demanda.

## ADR-013: Colyseus 0.18 local; servidor autoritativo sobre posição por validação
- **Por que 0.18 e não 0.16:** o `@colyseus/core` 0.16 depende de `nanoid@2` com alertas de segurança e sem correção na faixa.
  A 0.18 (estável desde 2026-05) usa `nanoid ^3` corrigido. Instalados só os pacotes mínimos (`core`, `ws-transport`, `schema`),
  sem o pacote guarda-chuva (que traz OAuth, Redis e uWebSockets). `npm audit`: 0 vulnerabilidades.
- **Autoridade:** o cliente propõe e o servidor valida (velocidade por modo, limites, ordem) e corrige. A colisão no servidor fica
  para a próxima etapa.
- Servidor só em `127.0.0.1`. **Sem deploy.**

## ADR-014: Correções manuais de mapa com rastreabilidade
- `data/overrides/buildings.json`: toda correção tem `source` e `confidence`. A preferência continua sendo corrigir no OSM
  (beneficia todos); o override cobre a lacuna até a edição ser aceita.

## ADR-015: Presets LOW/MEDIUM/HIGH/ULTRA + ajuste mobile
- O ULTRA **não** aumenta a resolução de sombra nem o pixel ratio em relação ao HIGH: investe em alcance (sombra de 260 m,
  LOD FULL até 650 m) e multidão (90 pedestres, 110 veículos). Medido: +0,2 ms em relação ao HIGH.
- `mobileAdjust()` aplica em qualquer preset no toque: ≤ 12 pedestres, ≤ 20 veículos, sombra ≤ 1024², sem AO/SMAA.
