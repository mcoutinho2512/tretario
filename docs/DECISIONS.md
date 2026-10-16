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

## ADR-006 🔒: Autenticação por e-mail
- **Proposta:** link mágico/OTP por e-mail com biblioteca open-source (Lucia-like/Auth.js self-hosted), sessões no Postgres.
- **Ponto de decisão:** enviar e-mail exige um remetente confiável. Opções: SMTP próprio na VPS (grátis, porém com
  entregabilidade ruim e risco de cair em spam) ou um provedor com plano gratuito (há limites e é um serviço externo).
  **Aguardando sua escolha.**

## ADR-007 🔒: Pagamento Pix (R$ 10,00 para jogar)
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
