# Fontes de dados

## 1. OpenStreetMap (fonte geográfica principal)

| Campo | Valor |
|---|---|
| Fonte | OpenStreetMap contributors, via Overpass API (`overpass-api.de`, com espelhos de fallback) |
| Licença | **ODbL 1.0**: https://opendatacommons.org/licenses/odbl/1-0/ |
| Atribuição | "© OpenStreetMap contributors (ODbL)", exibida permanentemente no HUD, na tela inicial e no README |
| Data de obtenção | 2026-10-15 (base OSM `2026-10-15T21:07:51Z`), registrada em `data/raw/osm_corridor.meta.json` |
| Área (bbox) | S −22.9095, W −43.1965, N −22.8965, E −43.1735 (~2,4 × 1,4 km) |
| Arquivo bruto | `data/raw/osm_corridor.json.gz` (88.902 elementos, 1,4 MB) |
| Query | `node(bbox); way(bbox); relation[type=multipolygon](bbox); relation[type=building](bbox); (._;>;); out body;` |

**Finalidade:** ruas (traçado, número de faixas, sentido), Presidente Vargas (pistas centrais e
laterais), footprints e **alturas** dos edifícios, praças/parques/gramados, árvores, postes,
semáforos, travessias, trilhos (SuperVia), VLT, plataformas, gradis, pontos de ônibus, bancos e lixeiras.

**Alturas dos edifícios:** 7.954 dos 8.189 edifícios do bbox já têm `height` no OSM, vindo da
importação da base 3D/levantamento da Prefeitura do Rio feita pela comunidade OSM. Esses valores
são usados como estão. Para os demais: `building:levels × 3,2 m + 1` ou estimativa por tipo
(campo `heightSource` nos dados processados).

**Transformações aplicadas** (ver [MAP_PIPELINE.md](MAP_PIPELINE.md)):
1. Projeção WGS84 → ENU local (origem −22.9025, −43.1850), 1 unidade = 1 m.
2. Ruas: buffer da linha central pela largura (`width`, senão `lanes × largura de faixa`) e união booleana
   (Clipper), mais fechamento morfológico de 1,2 m para arredondar as esquinas.
3. Calçadas/canteiros = área do chunk − asfalto − gramados − praças − plataformas − água.
4. Sinalização horizontal derivada de `lanes`/`oneway`, recortada nos cruzamentos.
5. Travessias: ways `footway=crossing` recortadas pelo asfalto; nós `highway=crossing` como complemento.
6. Semáforos: nós `traffic_signals` deslocados para o meio-fio, nos dois lados da via.
7. Edifícios: footprints reais extrudados; `building:part` substitui o contorno-pai; `building=roof` vira marquise.
8. Divisão em chunks de 250 m com hash de conteúdo no nome do arquivo.

### Elementos procedurais (NÃO vêm do OSM)

Para não confundir com dado geográfico real, ficam listados aqui:

- **Postes ao longo da Presidente Vargas** (157): o OSM tem poucos postes mapeados na avenida. O
  pipeline adiciona postes a cada ~34 m nos canteiros centrais e nas calçadas laterais, só onde
  não há poste OSM num raio de 18 m (`proc: 1` nos dados).
- **Fachadas** (janelas, comércio no térreo, cores): procedurais, plausíveis para o Centro, sem
  correspondência individual com cada prédio real.
- **Volumes técnicos nas coberturas** (caixas d'água / casas de máquinas): procedurais.
- **Galerias/arcadas no térreo** dos prédios altos de frente para a Pres. Vargas: inferidas por regra
  (altura > 25 m e fachada a < 52 m do eixo), não mapeadas individualmente.
- **Espécie das árvores**: o OSM não informa espécie; o modelo (oiti, amendoeira, grande) é sorteado de forma determinística.

## 2. Referências de forma dos landmarks (somente consulta humana)

Usadas **apenas** para ler proporções e orientação. Nenhuma textura, modelo ou dado foi copiado:

| Referência | Uso |
|---|---|
| pt.wikipedia.org — Estação Central do Brasil | 32 andares na torre, 4 relógios, art déco, 1943 |
| memoriadotransporte.org.br — Atual edifício da Central | bloco principal de 7 andares; torre ~134 m (com mastro) |
| diariodorio.com — Relógio da Central 80 anos | torre de 110 m; mostradores entre o 21º e o 26º andar |
| en.wikipedia.org — Candelária Church | cruz latina, 3 naves, cúpula de lioz, frontão, cantaria de granito |
| Base arquitetônica (via busca) | cúpula com 62,3 m de altura externa e 16,8 m de diâmetro |
| imaginoso.com — "main facade east elevation" | fachada principal voltada a **leste** |
| Wikimedia Commons — fotos da Central e da Candelária (vários autores, CC) | leitura visual de silhueta/posição da torre; **não incorporadas ao jogo** |

Google Maps e Street View **não** foram usados.

## 3. Fontes municipais

O Data.Rio (Prefeitura) publica bases abertas (lotes, edificações 3D, logradouros). Nesta etapa não
foram necessárias, porque as alturas já estão no OSM. Ficam como candidatas para:
meio-fios e canteiros exatos, larguras de calçada, iluminação pública e arborização (espécie).
Antes de usar, é preciso verificar a licença específica de cada conjunto (em geral CC-BY) e acrescentar a atribuição.
