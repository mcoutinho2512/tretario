# Licenças — veículos do trânsito

**Nenhum asset externo.** Todos os veículos (sedan, hatch, SUV, táxi e ônibus urbano, LOD0 e LOD1) são
**originais e procedurais**, gerados do zero pelo script `tools/vehicles/build_vehicles.py` (Blender 5.2,
headless) a partir de parâmetros numéricos escritos neste repositório. Não há malhas, texturas, HDRIs ou
referências de terceiros embutidas no arquivo `public/vehicles/vehicles.glb`.

| Asset | Origem | Autor | Licença |
|---|---|---|---|
| `public/vehicles/vehicles.glb` (5 modelos × 2 LODs) | gerado por `tools/vehicles/build_vehicles.py` | projeto Presidente Vargas 3D | mesma licença do código do projeto |
| Materiais (pintura, vidro, plástico, borracha, liga, cromo, lentes) | cores/PBR definidos no script e em `src/traffic/vehicleModels.ts` | projeto | idem |

Ferramentas usadas (não redistribuídas, apenas executadas no build):

| Ferramenta | Uso | Licença |
|---|---|---|
| Blender 5.2 (blender.org) | modelagem procedural e exportação glTF | GPL-2.0-or-later (o resultado gerado não é afetado pela GPL) |
| glTF-Transform CLI 4.5.1 (`npx @gltf-transform/cli`, Don McCurdy) | compressão meshopt + quantização | MIT |
| `meshopt_decoder.module.js` (já incluso no pacote `three`, zeux/meshoptimizer) | decodificação no cliente | MIT |

Marcas: os modelos são **genéricos**, sem logotipos, emblemas, grades ou silhuetas de fabricantes reais.
As placas são retângulos em branco (sem caracteres). As cores de ônibus são genéricas (não reproduzem
consórcios reais); o táxi segue apenas o padrão público carioca (amarelo com faixa azul lateral).
