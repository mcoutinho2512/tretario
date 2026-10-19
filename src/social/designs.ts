/**
 * Designs (artes) — registro ÚNICO e NEUTRO de conteúdo visual aplicável a bandeiras, cartazes, faixas, carros de
 * som, caminhões, telões, palcos e camisas. A geometria nunca muda com o design: o design vira textura (ou região
 * de um atlas) pintada por `designPainter.ts`.
 *
 * NEUTRALIDADE (período eleitoral): nenhum design tem efeito mecânico; o sistema trata todas as campanhas do mesmo
 * jeito. Conteúdo de campanha é SÓ nome/número/sigla/cores informados na configuração — nenhuma frase, slogan,
 * declaração ou endosso atribuído a pessoas reais, nenhum logotipo ou foto. Designs de campanha levam a marca
 * discreta "SIMULAÇÃO" (`simulationTag`), identificando que é conteúdo do jogo, não comunicação oficial.
 *
 * Camisas de futebol: só COMBINAÇÕES DE CORES/PADRÕES tradicionais do futebol carioca, sem escudos, marcas,
 * patrocinadores ou uniformes oficiais. Uniformes licenciados poderão entrar depois como novos designs
 * (`family: 'football'`, com `licensed` preenchido) sem mudar a geometria.
 *
 * Ids (u16) são ESTÁVEIS (rede): nunca reaproveite um id removido.
 */
import type { DesignSlot } from './props';

/** onde um design pode ser aplicado */
export type DesignTarget = DesignSlot | 'truck' | 'screen' | 'stage' | 'shirt';
export type DesignFamily = 'neutral' | 'brasil' | 'campaign' | 'group' | 'event' | 'football';
export type DesignPattern =
  | 'solid' | 'brazil' | 'h_stripes' | 'v_stripes' | 'hoops' | 'sash' | 'split_v' | 'split_h' | 'border' | 'tricolor_v'
  // rodada 10 — torcidas (camisas/bandeiras de referência, sem escudo/marca; docs/SUPPORTER_GROUPS.md):
  //  hoops_top    faixas horizontais largas começando em `bg` no topo (gola polo e frisos de ombro em `accent`)
  //  sash_l       faixa diagonal `accent` do ombro ESQUERDO de quem veste ao quadril direito, contornos sutis `third`
  //  stripes_pin  listras verticais `bg`/`accent` com filete fino `third` entre elas; gola V e punhos em `third`
  //  stripes_eq   listras verticais `bg`/`accent` de largura igual; gola/punhos `accent` com frisos `bg`
  | 'hoops_top' | 'sash_l' | 'stripes_pin' | 'stripes_eq';

export interface DesignPalette {
  /** fundo */
  bg: string;
  /** texto/elementos principais */
  fg: string;
  /** cor secundária (listras, faixa, borda) */
  accent?: string;
  /** terceira cor (padrões tricolores) */
  third?: string;
}

export interface Design {
  /** u16 estável (rede). 0 = sem design (neutro/liso) */
  id: number;
  key: string;
  label: string;
  family: DesignFamily;
  pattern: DesignPattern;
  palette: DesignPalette;
  /** linhas de texto grandes (nome, palavra de ordem neutra) */
  lines?: string[];
  /** número em destaque (campanha) */
  number?: string;
  /** sigla pequena (partido, grupo) */
  small?: string;
  /** marca discreta "SIMULAÇÃO" (obrigatória em campanha) */
  simulationTag?: boolean;
  /** onde pode ser usado */
  targets: DesignTarget[];
  /** peso na multidão de NPCs (0 = NPCs não usam) */
  crowdWeight?: number;
  /** só para designs licenciados (uniforme oficial, arte autorizada): titular e referência da licença */
  licensed?: { holder: string; ref: string };
  /** camisa licenciada: textura no layout de UV da camiseta base (characters/kits/…); sem ela, camisas usam o padrão
   * `pattern` + `palette` calculado no shader (human/garmentShader.ts) */
  texture?: string;
}

/**
 * Configuração de campanha (CampaignDesign / PoliticalDesign): o que um operador do evento preenche para
 * representar uma candidatura, partido ou movimento. `campaignDesign()` converte em `Design`.
 */
export interface CampaignConfig {
  id: number;
  key: string;
  /** nome como aparece nas artes (ex.: nome de urna) */
  name: string;
  number?: string;
  /** sigla do partido/coligação/movimento */
  party?: string;
  palette: DesignPalette;
  pattern?: DesignPattern;
  crowdWeight?: number;
}

const ALL_PROPS: DesignTarget[] = ['flag', 'sign', 'banner'];
const CAMPAIGN_TARGETS: DesignTarget[] = ['flag', 'sign', 'banner', 'truck', 'screen', 'stage'];

export function campaignDesign(c: CampaignConfig): Design {
  return {
    id: c.id, key: c.key, label: [c.name, c.number].filter(Boolean).join(' '), family: 'campaign',
    pattern: c.pattern ?? 'solid', palette: c.palette, lines: [c.name], number: c.number, small: c.party,
    simulationTag: true, targets: CAMPAIGN_TARGETS, crowdWeight: c.crowdWeight ?? 4,
  };
}

/** designs embutidos (neutros, Brasil, grupos/eventos fictícios, cores de futebol) */
const BUILTIN: Design[] = [
  // -------------------------------------------------------------- Brasil / neutros
  { id: 1, key: 'brasil', label: 'Bandeira do Brasil', family: 'brasil', pattern: 'brazil', palette: { bg: '#009c3b', fg: '#002776', accent: '#ffdf00', third: '#ffffff' }, targets: [...ALL_PROPS, 'truck', 'stage'], crowdWeight: 8 },
  { id: 2, key: 'verde_amarelo', label: 'Verde e amarelo', family: 'brasil', pattern: 'split_h', palette: { bg: '#009c3b', fg: '#ffdf00', accent: '#ffdf00' }, targets: ALL_PROPS, crowdWeight: 3 },
  { id: 3, key: 'paz', label: 'Paz (branca)', family: 'neutral', pattern: 'solid', palette: { bg: '#f4f2ec', fg: '#2a2a2a' }, lines: ['PAZ'], targets: ALL_PROPS, crowdWeight: 2 },
  { id: 4, key: 'vote', label: 'Vote consciente', family: 'neutral', pattern: 'border', palette: { bg: '#ffffff', fg: '#1d3557', accent: '#457b9d' }, lines: ['VOTE', 'CONSCIENTE'], targets: [...ALL_PROPS, 'screen'], crowdWeight: 3 },
  { id: 5, key: 'democracia', label: 'Democracia', family: 'neutral', pattern: 'solid', palette: { bg: '#1d3557', fg: '#f1faee' }, lines: ['DEMOCRACIA'], targets: [...ALL_PROPS, 'screen'], crowdWeight: 3 },
  { id: 6, key: 'educacao', label: 'Mais educação', family: 'neutral', pattern: 'border', palette: { bg: '#fefae0', fg: '#283618', accent: '#606c38' }, lines: ['MAIS', 'EDUCAÇÃO'], targets: ALL_PROPS, crowdWeight: 2 },
  { id: 7, key: 'saude', label: 'Mais saúde', family: 'neutral', pattern: 'border', palette: { bg: '#ffffff', fg: '#0b6e4f', accent: '#08a045' }, lines: ['MAIS', 'SAÚDE'], targets: ALL_PROPS, crowdWeight: 2 },
  { id: 8, key: 'transporte', label: 'Transporte digno', family: 'neutral', pattern: 'solid', palette: { bg: '#f2c230', fg: '#1f1f1f' }, lines: ['TRANSPORTE', 'DIGNO'], targets: ALL_PROPS, crowdWeight: 2 },
  { id: 9, key: 'rio', label: 'Rio', family: 'neutral', pattern: 'border', palette: { bg: '#0077b6', fg: '#ffffff', accent: '#00b4d8' }, lines: ['RIO'], targets: ALL_PROPS, crowdWeight: 2 },
  // -------------------------------------------------------------- grupos / evento (genéricos, fictícios)
  { id: 20, key: 'coletivo', label: 'Coletivo cultural', family: 'group', pattern: 'v_stripes', palette: { bg: '#7b2cbf', fg: '#ffffff', accent: '#ff9e00' }, lines: ['COLETIVO'], small: 'CULTURA', targets: ALL_PROPS, crowdWeight: 1 },
  { id: 21, key: 'trabalhadores', label: 'Trabalhadores', family: 'group', pattern: 'border', palette: { bg: '#e63946', fg: '#ffffff', accent: '#1d3557' }, lines: ['TRABALHADORES'], targets: ALL_PROPS, crowdWeight: 1 },
  { id: 22, key: 'estudantes', label: 'Estudantes', family: 'group', pattern: 'solid', palette: { bg: '#2a9d8f', fg: '#ffffff' }, lines: ['ESTUDANTES'], targets: ALL_PROPS, crowdWeight: 1 },
  { id: 30, key: 'ato_pv', label: 'Ato na Presidente Vargas', family: 'event', pattern: 'border', palette: { bg: '#111111', fg: '#ffffff', accent: '#f2c230' }, lines: ['ATO', 'PRES. VARGAS'], targets: [...ALL_PROPS, 'truck', 'screen', 'stage'], crowdWeight: 2 },
  { id: 31, key: 'neutro_liso', label: 'Neutro (liso)', family: 'neutral', pattern: 'solid', palette: { bg: '#e9e4d8', fg: '#333333' }, targets: [...ALL_PROPS, 'truck', 'screen', 'stage'], crowdWeight: 0 },
  // rodada 9 — recompensas cosméticas (src/characters/unlocks.ts, public/gameplay/rewards.json): neutras, NPCs não usam
  { id: 40, key: 'mar_e_mata', label: 'Mar e mata', family: 'neutral', pattern: 'split_h', palette: { bg: '#0077b6', fg: '#2d6a4f', accent: '#2d6a4f' }, targets: ALL_PROPS, crowdWeight: 0 },
  { id: 41, key: 'por_do_sol', label: 'Pôr do sol na avenida', family: 'event', pattern: 'h_stripes', palette: { bg: '#f77f00', fg: '#d62828', accent: '#fcbf49' }, targets: ALL_PROPS, crowdWeight: 0 },
  { id: 42, key: 'noite_na_avenida', label: 'Noite na avenida', family: 'neutral', pattern: 'border', palette: { bg: '#14213d', fg: '#fca311', accent: '#e5e5e5' }, lines: ['AVENIDA'], targets: ALL_PROPS, crowdWeight: 0 },
  { id: 43, key: 'calcadao', label: 'Calçadão', family: 'neutral', pattern: 'hoops', palette: { bg: '#ffffff', fg: '#111111', accent: '#111111' }, targets: ALL_PROPS, crowdWeight: 0 },
  // -------------------------------------------------------------- futebol carioca: só cores/padrões (sem escudos/marcas)
  { id: 200, key: 'fut_rubro_negro', label: 'Listras vermelho e preto', family: 'football', pattern: 'hoops', palette: { bg: '#c8102e', fg: '#ffffff', accent: '#111111' }, targets: ['shirt', 'flag'], crowdWeight: 5 },
  { id: 201, key: 'fut_alvinegro_faixa', label: 'Preta com faixa diagonal branca', family: 'football', pattern: 'sash', palette: { bg: '#111111', fg: '#ffffff', accent: '#ffffff' }, targets: ['shirt', 'flag'], crowdWeight: 3 },
  { id: 202, key: 'fut_tricolor', label: 'Listras verde, grená e branco', family: 'football', pattern: 'tricolor_v', palette: { bg: '#7a1f2b', fg: '#ffffff', accent: '#0f6b3a', third: '#ffffff' }, targets: ['shirt', 'flag'], crowdWeight: 3 },
  { id: 203, key: 'fut_alvinegro_listras', label: 'Listras preto e branco', family: 'football', pattern: 'v_stripes', palette: { bg: '#ffffff', fg: '#111111', accent: '#111111' }, targets: ['shirt', 'flag'], crowdWeight: 3 },
  { id: 204, key: 'fut_preta_lisa', label: 'Preta lisa com gola branca', family: 'football', pattern: 'border', palette: { bg: '#141414', fg: '#ffffff', accent: '#ffffff' }, targets: ['shirt'], crowdWeight: 1 },
  { id: 205, key: 'fut_vermelha_lisa', label: 'Vermelha lisa', family: 'football', pattern: 'solid', palette: { bg: '#b0101f', fg: '#ffffff' }, targets: ['shirt'], crowdWeight: 2 },
  { id: 206, key: 'fut_amarela', label: 'Amarela com detalhes verdes', family: 'football', pattern: 'border', palette: { bg: '#ffdf00', fg: '#009c3b', accent: '#009c3b' }, targets: ['shirt'], crowdWeight: 4 },
  { id: 207, key: 'fut_azul_listras', label: 'Listras azul e branco', family: 'football', pattern: 'v_stripes', palette: { bg: '#ffffff', fg: '#0b3d91', accent: '#0b3d91' }, targets: ['shirt'], crowdWeight: 1 },
  // rodada 9 — camisas de RECOMPENSA (cores próprias, sem escudo/marca; NPCs não usam)
  { id: 208, key: 'rec_azul_petroleo', label: 'Azul petróleo da avenida', family: 'neutral', pattern: 'border', palette: { bg: '#1b4965', fg: '#ffffff', accent: '#cae9ff' }, targets: ['shirt'], crowdWeight: 0 },
  { id: 209, key: 'rec_coral', label: 'Coral com gola creme', family: 'neutral', pattern: 'border', palette: { bg: '#ef6f6c', fg: '#fdf0d5', accent: '#fdf0d5' }, targets: ['shirt'], crowdWeight: 0 },
  { id: 210, key: 'rec_areia_verde', label: 'Listras areia e verde', family: 'neutral', pattern: 'v_stripes', palette: { bg: '#e9d8a6', fg: '#2d6a4f', accent: '#2d6a4f' }, targets: ['shirt'], crowdWeight: 0 },
  { id: 211, key: 'rec_calcadao', label: 'Ondas do calçadão', family: 'neutral', pattern: 'hoops', palette: { bg: '#ffffff', fg: '#222222', accent: '#222222' }, targets: ['shirt'], crowdWeight: 0 },
  // rodada 10 — TORCIDAS (ids reservados em public/gameplay/supporters.json: camisas 212–215, bandeiras/faixas 216–223).
  // Só cores e padrões das referências: sem escudo, cruz, monograma, estrela, fabricante, patrocinador, selo ou número.
  // Rótulos descrevem as cores (o nome do clube só existe nos DADOS). Pesos iguais: nenhuma torcida aparece mais.
  { id: 212, key: 'tor_faixas_vermelho_preto', label: 'Faixas horizontais vermelho e preto (gola polo)', family: 'football', pattern: 'hoops_top', palette: { bg: '#141414', fg: '#ffffff', accent: '#c8102e', third: '#c8102e' }, targets: ['shirt'], crowdWeight: 3 },
  { id: 213, key: 'tor_preta_faixa_diagonal', label: 'Preta com faixa diagonal branca', family: 'football', pattern: 'sash_l', palette: { bg: '#141414', fg: '#ffffff', accent: '#f2f2ee', third: '#c9c9c4' }, targets: ['shirt'], crowdWeight: 3 },
  { id: 214, key: 'tor_listras_grena_verde', label: 'Listras grená e verde com filete branco', family: 'football', pattern: 'stripes_pin', palette: { bg: '#7a1f3d', fg: '#ffffff', accent: '#00613c', third: '#f4f4f0' }, targets: ['shirt'], crowdWeight: 3 },
  { id: 215, key: 'tor_listras_preto_branco', label: 'Listras pretas e brancas iguais', family: 'football', pattern: 'stripes_eq', palette: { bg: '#f4f4f0', fg: '#141414', accent: '#141414', third: '#f4f4f0' }, targets: ['shirt'], crowdWeight: 3 },
  // bandeiras (alvo flag) e faixas (alvo banner) das torcidas: só padrões de cor, sem texto nem escudo
  { id: 216, key: 'tor_bandeira_vermelho_preto', label: 'Bandeira faixas vermelho e preto', family: 'football', pattern: 'hoops_top', palette: { bg: '#141414', fg: '#ffffff', accent: '#c8102e' }, targets: ['flag'], crowdWeight: 3 },
  { id: 217, key: 'tor_faixa_vermelho_preto', label: 'Faixa vermelha e preta', family: 'football', pattern: 'h_stripes', palette: { bg: '#c8102e', fg: '#ffffff', accent: '#141414' }, targets: ['banner'], crowdWeight: 3 },
  { id: 218, key: 'tor_bandeira_preta_diagonal', label: 'Bandeira preta com faixa diagonal branca', family: 'football', pattern: 'sash_l', palette: { bg: '#141414', fg: '#ffffff', accent: '#f2f2ee' }, targets: ['flag'], crowdWeight: 3 },
  { id: 219, key: 'tor_faixa_preta_diagonal', label: 'Faixa preta com diagonal branca', family: 'football', pattern: 'sash_l', palette: { bg: '#141414', fg: '#ffffff', accent: '#f2f2ee' }, targets: ['banner'], crowdWeight: 3 },
  { id: 220, key: 'tor_bandeira_grena_verde', label: 'Bandeira grená, branco e verde', family: 'football', pattern: 'stripes_pin', palette: { bg: '#7a1f3d', fg: '#ffffff', accent: '#00613c', third: '#f4f4f0' }, targets: ['flag'], crowdWeight: 3 },
  { id: 221, key: 'tor_faixa_grena_verde', label: 'Faixa grená, branca e verde', family: 'football', pattern: 'tricolor_v', palette: { bg: '#7a1f3d', fg: '#ffffff', accent: '#00613c', third: '#f4f4f0' }, targets: ['banner'], crowdWeight: 3 },
  { id: 222, key: 'tor_bandeira_preto_branco', label: 'Bandeira listras preto e branco', family: 'football', pattern: 'stripes_eq', palette: { bg: '#f4f4f0', fg: '#141414', accent: '#141414' }, targets: ['flag'], crowdWeight: 3 },
  { id: 223, key: 'tor_faixa_preto_branco', label: 'Faixa preta e branca', family: 'football', pattern: 'split_h', palette: { bg: '#141414', fg: '#f4f4f0', accent: '#f4f4f0' }, targets: ['banner'], crowdWeight: 3 },
];

/**
 * Registro vivo: embutidos + campanhas carregadas dos DADOS (`public/designs/campaigns.json`) por
 * `registerCampaigns` — no cliente (fetch na carga) e no servidor (arquivo). O código não conhece nenhuma
 * candidatura: o arquivo de dados é a única fonte (exemplos 13 e 22 incluídos lá).
 */
export const DESIGNS: Design[] = [...BUILTIN];
export const DESIGN_BY_ID = new Map(DESIGNS.map((d) => [d.id, d]));
export const DESIGN_BY_KEY = new Map(DESIGNS.map((d) => [d.key, d]));
export const NO_DESIGN = 0;
/** ids reservados para campanhas (dados) */
export const CAMPAIGN_ID_RANGE = [100, 199] as const;

/** valida e registra configurações de campanha; devolve quantas entraram */
export function registerCampaigns(list: unknown): number {
  if (!Array.isArray(list)) return 0;
  let n = 0;
  for (const raw of list as CampaignConfig[]) {
    if (!raw || typeof raw.name !== 'string' || typeof raw.key !== 'string' || !Number.isInteger(raw.id)) continue;
    if (raw.id < CAMPAIGN_ID_RANGE[0] || raw.id > CAMPAIGN_ID_RANGE[1] || DESIGN_BY_ID.has(raw.id)) continue;
    if (!raw.palette || typeof raw.palette.bg !== 'string' || typeof raw.palette.fg !== 'string') continue;
    const d = campaignDesign({ ...raw, name: raw.name.slice(0, 24), number: raw.number?.slice(0, 5), party: raw.party?.slice(0, 12) });
    DESIGNS.push(d); DESIGN_BY_ID.set(d.id, d); DESIGN_BY_KEY.set(d.key, d);
    n++;
  }
  return n;
}

/** designs válidos para um alvo (bandeira, cartaz, caminhão…) */
export function designsFor(target: DesignTarget): Design[] {
  return DESIGNS.filter((d) => d.targets.includes(target));
}
