# Licenças — edifícios, chão, céu e iluminação (rodada 5)

## Assets de terceiros adicionados ao jogo

**Nenhum.** Todo o visual desta área continua 100% procedural e gerado no cliente:

| Item | Como é gerado | Arquivo |
|---|---|---|
| Fachadas (materiais, janelas, térreo, letreiros, telhados) | shader GLSL procedural | `src/world/builders/facadeShader.ts` |
| Letreiros das lojas | atlas desenhado em `<canvas>` em tempo de execução com palavras genéricas em pt-BR ("MODAS", "TECIDOS", "ÓTICA"…), sem marcas reais, com a fonte sans-serif do sistema | `src/world/builders/buildings.ts` (`signAtlas`) |
| Asfalto, pedra portuguesa, granito do meio-fio, concreto, grama, brita | texturas PBR geradas por ruído (albedo/normal/rugosidade) | `src/renderer/textures.ts` |
| Céu, nuvens, IBL | shader analítico + PMREM de uma cena gerada (céu + silhuetas) | `src/renderer/Environment.ts` |

Download adicional de assets: **0 bytes** (o único custo é código: ver `docs/BUILDINGS_LIGHTING.md`).

### Por que não usamos HDRI/texturas CC0 (Poly Haven / ambientCG)

Avaliamos e decidimos não usar:

- **HDRI (Poly Haven, CC0)**: é uma foto estática de um único horário. O jogo calcula o sol a partir da data/hora
  reais do Rio, e o IBL precisa acompanhar manhã, pôr do sol e noite. Um HDRI fixo daria reflexos de meio-dia à
  noite (ou exigiria vários HDRIs de 1–6 MB cada). O IBL agora é gerado do mesmo céu analítico, mais um anel de
  silhuetas de prédios para os vidros refletirem "cidade".
- **Texturas PBR CC0**: as procedurais já cobrem asfalto, pedra portuguesa e granito sem repetição perceptível
  (variação macro por posição de mundo) e sem custo de download. Fica como opção futura para o preset ULTRA.

Se algum asset CC0 for adicionado no futuro, registrar aqui: arquivo, fonte, autor, licença, URL e data.

## Fotos usadas apenas como REFERÊNCIA visual (não incluídas no jogo nem no repositório)

Comparadas com as capturas para calibrar cores de fachada, céu, asfalto e sinalização:

| Foto | Autor | Licença | URL |
|---|---|---|---|
| Avenida Presidente Vargas (6592261671) | Antonio Schubert | CC BY-SA 2.0 | https://commons.wikimedia.org/wiki/File:Avenida_Presidente_Vargas_(6592261671).jpg |
| Avenida Presidente Vargas, Rio de Janeiro, Brasil (2011-02-04) | Andrevruas | CC BY 3.0 | https://commons.wikimedia.org/wiki/File:Avenida_Presidente_Vargas,_Rio_de_Janeiro,_Brasil_(2011-02-04).jpg |
| Av Presidente vargas. RJ - Brasil | Marinelson Almeida | CC BY 2.0 | https://commons.wikimedia.org/wiki/File:Av_Presidente_vargas._RJ_-_Brasil.jpg |
| Vasos da Avenida Presidente Vargas (2022-09-24) | Estela Neto | CC BY-SA 4.0 | https://commons.wikimedia.org/wiki/File:Vasos_da_Avenida_Presidente_Vargas_-_Rio_de_Janeiro_-_20220924111943.jpg |

Normas consultadas para sinalização horizontal: Manual Brasileiro de Sinalização de Trânsito (CONTRAN), Vol. IV —
Sinalização Horizontal (larguras de linha 0,10–0,15 m; tracejado na proporção 1:2; faixa zebrada 0,30–0,40 m com
espaçamento 0,30–0,80 m).
