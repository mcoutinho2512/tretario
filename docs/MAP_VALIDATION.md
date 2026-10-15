# Validação do mapa: checklist para conferência humana

Como usar: abra o jogo, aperte **F3** (debug: XYZ, lat/lon, ponto de validação) e **M** (minimapa).
Para ir direto a um ponto: `http://localhost:5173/?shot=central` (ou `avenue`, `mid`, `candelaria`).
Para fixar o horário de comparação com fotos: `&time=16:30`.

Legenda: ✅ verificado por mim (dados ou screenshot) · [ ] precisa de olhar humano

---

## Central do Brasil (LANDMARK_CENTRAL)
Footprint: OSM way 81100866 (real). Volumes: modelo procedural dedicado (`src/world/landmarks/central.ts`).

- [ ] **posição**: footprint OSM real; centro em lat −22.9036, lon −43.1913 ✅ (teste automatizado ±60 m)
- [ ] **escala**: footprint ~150 × 65 m (OSM); bloco principal **29 m (ESTIMATIVA: 7 andares)**; torre **110 m + mastro até 125 m (ESTIMATIVA)**
- [ ] **orientação**: fachada principal leste para a Praça Cristiano Ottoni; Pres. Vargas passa ao sul ✅ (OSM)
- [ ] **posição da torre**: perto da extremidade **sul da fachada leste**, recuada ~15 m. Deduzida de fotos
      (Wikimedia Commons), **não** de dado oficial. **Prioridade de conferência.**
- [ ] **volumetria da torre**: 21 × 21 m; estágio do relógio 80–97 m; mostradores de Ø 9,4 m centrados a 88,5 m
      (fonte: relógios entre o 21º e o 26º andar); coroamento escalonado em 3 níveis (97–111,5 m)
- [ ] relógio de 4 faces mostrando a hora real do Rio ✅
- [ ] bloco principal com cantos arredondados (vem do próprio footprint OSM) ✅; janelas em fita (shader) — conferir o ritmo
- [ ] parte de trás (sobre as plataformas) como hall de 16 m — **ESTIMATIVA**
- [ ] marquise na fachada leste (36 m, a 6,2 m de altura) — **ESTIMATIVA, conferir se existe**
- **Blender (trabalho artístico futuro):** pilastras e caixilhos art déco reais, letreiro, portal de entrada, coroamento com recortes, textura de reboco.

## Presidente Vargas
- [ ] **largura total**: pistas centrais 4 faixas por sentido e laterais 3–4 faixas (OSM `lanes`) ✅. Largura de faixa adotada 3,2–3,3 m. Comparar com a realidade (~80–90 m de fachada a fachada).
- [ ] **cruzamentos** (pontos de validação no HUD):
  - [ ] INTERSECTION_PROCOPIO_FERREIRA / TERMINAL_RODOVIARIO (Central)
  - [ ] INTERSECTION_DA_REPUBLICA (Campo de Santana)
  - [ ] INTERSECTION_VISCONDE_DA_GAVEA · INTERSECTION_TOME_DE_SOUSA
  - [ ] INTERSECTION_PASSOS (Av. Passos / Saara)
  - [ ] INTERSECTION_DOS_ANDRADAS · INTERSECTION_URUGUAIANA
  - [ ] INTERSECTION_MIGUEL_COUTO
  - [ ] INTERSECTION_RIO_BRANCO
  - [ ] INTERSECTION_DA_QUITANDA · INTERSECTION_PIO_X · INTERSECTION_PRIMEIRO_DE_MARCO (Candelária)
- [ ] **canteiros**: saem do espaço entre as pistas OSM. Conferir a largura do canteiro central e dos laterais
      e se são pavimentados ou têm grama (hoje: pedra portuguesa clara).
- [ ] **calçadas**: pedra portuguesa clara; meio-fio de 15 cm com capa de granito. Conferir o material real trecho a trecho.
- [ ] **galerias/arcadas** nos térreos dos prédios altos de frente para a avenida: **inferidas por regra**. Conferir quais prédios têm de fato.
- [ ] **árvores**: posições do OSM (nós `natural=tree`). As espécies são genéricas.
- [ ] **postes**: OSM + **157 procedurais** a cada ~34 m (marcados `proc`). Conferir o modelo (braço duplo) e o espaçamento.
- [ ] **semáforos**: posição dos nós OSM deslocada ao meio-fio. Conferir se há semáforos de braço projetado nos cruzamentos grandes.
- [ ] **faixas de pedestres**: ways `footway=crossing` do OSM ✅. Conferir as que faltam.
- [ ] VLT (trilhos no asfalto) perto da Central/Cristiano Ottoni e Rio Branco ✅ (OSM)
- [ ] passagens subterrâneas/túneis: **fora do MVP**

## Candelária (LANDMARK_CANDELARIA)
Footprint: OSM way 30839484 (real). Modelo procedural dedicado (`src/world/landmarks/candelaria.ts`).

- [ ] **posição**: ilha da Praça Pio X, no fim da Pres. Vargas ✅ (teste ±60 m)
- [ ] **orientação**: fachada principal a **leste** (Rua 1º de Março) e **abside voltada para a avenida**. Fonte: foto
      "main facade east elevation"; coerente com as fotos históricas tiradas da avenida. **Conferir.**
- [ ] **escala**: retângulo OSM ~72 × 42 m; cúpula: tambor Ø 16,8 m, topo da cruz a **62,3 m** (fonte publicada)
- [ ] **volumetria**: torres até 50 m (cruz) — **ESTIMATIVA**; nave central 24 m, laterais 17 m,
      abside 21 m, transepto 24 m — **ESTIMATIVAS**
- [ ] fachada: frontão triangular, 3 portais em arco (o central maior), 3 janelas, óculo, cantaria escura sobre reboco claro
- [ ] escadaria/adro: embasamento de 0,9 m + 5 degraus na fachada leste — **ESTIMATIVA**
- [ ] 8 estátuas na balaustrada do tambor ✅ (fonte); nervuras da cúpula (16) — conferir a quantidade
- **Blender (trabalho artístico futuro):** ornamentação barroca da fachada, volutas das torres, janelas do tambor, relevo da cantaria, portas de bronze.

## Outros pontos para conferir
- [ ] CAMPO_DE_SANTANA: gradil, lago, árvores (OSM). Os morros e o relevo do parque não estão modelados.
- [ ] PRACA_DUQUE_DE_CAXIAS / PANTEAO_CAXIAS
- [ ] PALACIO_DUQUE_DE_CAXIAS (grande bloco a leste da Central)
- [ ] CAMELODROMO_URUGUAIANA: coberturas a ~4,5 m (marquises OSM `building=roof`)
- [ ] METRO_*: as estações aparecem só como ponto de validação (os acessos não estão modelados)
- [ ] COLEGIO_PEDRO_II · CENTRO_CULTURAL_CORREIOS
- [ ] Teleférico da Providência: cobertura da estação flutua a 10 m (dado OSM `min_height`). Coerente com a estação elevada? Conferir.
- [ ] **Relevo**: o Morro da Providência (atrás da Central), o São Bento e o da Conceição estão **planos** — limitação conhecida.

## Como reportar
Anote o **ponto de validação** ou o **XYZ / lat-lon do F3** e o que está errado
("este prédio está alto demais", "falta esta rua", "a torre fica mais ao norte"). Correções de dado
vão para o OSM (beneficia todos) ou para os parâmetros em `CENTRAL_PARAMS` e `CANDELARIA_PARAMS`.
