# Pipeline do mapa

Reproduzível e sem chamadas externas em runtime: o navegador só lê `public/world/`.

```
npm run map:fetch     # 1–3: bbox, download OSM, data/raw/osm_corridor.json.gz (+ .meta.json)
npm run map:process   # 4–10: data/processed/features.json
npm run map:build     # superfícies, sinalização, chunks → public/world/
npm run map           # process + build (sem baixar de novo)
```

## 1. Bounding box: `src/geo/region.ts`
S −22.9095 · W −43.1965 · N −22.8965 · E −43.1735. Cobre da Central (com o pátio ferroviário e a
Praça Cristiano Ottoni) até a Candelária e a Rua 1º de Março, com margem de ~300–600 m para os lados.

## 2–3. Download: `tools/fetch_map_data.ts`
- Overpass com fallback entre 4 servidores e backoff.
- Só relações `multipolygon`/`building` (evita puxar rotas de ônibus e limites gigantes).
- O bruto fica comprimido (gzip) e é versionado; o `.meta.json` guarda endpoint, query, data e timestamp OSM.

## 4–10. Processamento: `tools/process_osm.ts`
1. Monta nós, ways e relações; projeta para coordenadas locais (cm).
2. **Landmarks** por id OSM, com verificação de tags (fallback por tags): Central (way 81100866), Candelária (way 30839484).
   Calcula o retângulo orientado (centro, eixo, comprimento, largura).
3. **Ruas**: classes motorizadas, largura = `width` ou `lanes × largura de faixa (+0,6 m)`. Túneis e
   viadutos ficam de fora no MVP. A Pres. Vargas é marcada com o papel de cada pista (central ou lateral, pela `description` OSM).
4. **Eixo da Pres. Vargas**: PCA dos pontos das pistas centrais, média em faixas de 40 m e simplificação.
5. **Travessias e semáforos**: ways `footway=crossing` e nós `crossing`/`traffic_signals`, com a direção da via.
6. **Edifícios**: ways e multipolígonos; `building:part` substitui o pai; altura do OSM (`height` → `levels` → estimativa);
   classe A/B/C/D, estilo de fachada, galeria, marquise.
7. **Áreas**: parque, gramado, praça, estacionamento, plataforma, água, pátio ferroviário.
8. **Linhas**: trilhos, VLT, gradis, muros (sem túneis).
9. **Props**: árvores (nós e `tree_row`), postes, bancos, abrigos, balizadores, lixeiras, bancas, mais os
   postes procedurais da Pres. Vargas (marcados).
10. **Validação e spawn**: landmarks, praças, metrô e cruzamentos com a Pres. Vargas (nós compartilhados).
    O spawn fica no eixo da avenida, 45 m a leste do ponto mais próximo da Central, virado para a Candelária.

## Build: `tools/build_world.ts`
1. Limites do mundo = bbox projetado, alinhado à grade de 250 m.
2. **Asfalto** = união do buffer de todas as ruas, mais fechamento morfológico de 1,2 m (raio de esquina).
3. Gramado, plataforma, brita, água e praça por união/diferença (Clipper, inteiros em cm).
4. **Calçadas/canteiros** = retângulo do chunk − todas as outras superfícies (os canteiros da Pres. Vargas saem daí).
5. **Meio-fio** = contornos do asfalto.
6. **Sinalização**: linhas de faixa a partir de `lanes`/`oneway`, recortadas dentro do asfalto e fora de
   círculos de cruzamento (nós usados por 3 ou mais trechos).
7. Semáforos posicionados no meio-fio dos dois lados, voltados ao tráfego (mão direita).
8. Props sobre o asfalto são descartados (erro de mapeamento).
9. Cada chunk é recortado e salvo como `chunk_cx_cz.<sha1-10>.json`. O manifesto lista arquivos, landmarks, validação, spawn e ruas do minimapa.

Tempo total: ~8 s. Saída: 70 chunks, 3,15 MB em JSON (~740 KB com gzip).

## Atualizar o mapa
1. `npm run map:fetch` (opcional: muda o timestamp OSM).
2. `npm run map`.
3. `npm test` (integridade e geografia).
4. Conferir as screenshots: `node tools/qa/screenshots.mjs http://localhost:5173 high 16:30`.

## Próximas evoluções do pipeline
- Relevo (MDT do Data.Rio/SRTM) para os morros da Providência, São Bento e Conceição.
- Larguras de calçada e canteiros exatos (`sidewalk:width`, `area:highway`).
- Saída binária (GLB/Meshopt) dos chunks se o JSON passar de ~5 MB.
- Recorte por bairro para expansão (Lapa, Praça XV, Porto).
