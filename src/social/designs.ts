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
  | 'solid' | 'brazil' | 'h_stripes' | 'v_stripes' | 'hoops' | 'sash' | 'split_v' | 'split_h' | 'border' | 'tricolor_v';

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
  // -------------------------------------------------------------- futebol carioca: só cores/padrões (sem escudos/marcas)
  { id: 200, key: 'fut_rubro_negro', label: 'Listras vermelho e preto', family: 'football', pattern: 'hoops', palette: { bg: '#c8102e', fg: '#ffffff', accent: '#111111' }, targets: ['shirt', 'flag'], crowdWeight: 5 },
  { id: 201, key: 'fut_alvinegro_faixa', label: 'Preta com faixa diagonal branca', family: 'football', pattern: 'sash', palette: { bg: '#111111', fg: '#ffffff', accent: '#ffffff' }, targets: ['shirt', 'flag'], crowdWeight: 3 },
  { id: 202, key: 'fut_tricolor', label: 'Listras verde, grená e branco', family: 'football', pattern: 'tricolor_v', palette: { bg: '#7a1f2b', fg: '#ffffff', accent: '#0f6b3a', third: '#ffffff' }, targets: ['shirt', 'flag'], crowdWeight: 3 },
  { id: 203, key: 'fut_alvinegro_listras', label: 'Listras preto e branco', family: 'football', pattern: 'v_stripes', palette: { bg: '#ffffff', fg: '#111111', accent: '#111111' }, targets: ['shirt', 'flag'], crowdWeight: 3 },
  { id: 204, key: 'fut_preta_lisa', label: 'Preta lisa com gola branca', family: 'football', pattern: 'border', palette: { bg: '#141414', fg: '#ffffff', accent: '#ffffff' }, targets: ['shirt'], crowdWeight: 1 },
  { id: 205, key: 'fut_vermelha_lisa', label: 'Vermelha lisa', family: 'football', pattern: 'solid', palette: { bg: '#b0101f', fg: '#ffffff' }, targets: ['shirt'], crowdWeight: 2 },
  { id: 206, key: 'fut_amarela', label: 'Amarela com detalhes verdes', family: 'football', pattern: 'border', palette: { bg: '#ffdf00', fg: '#009c3b', accent: '#009c3b' }, targets: ['shirt'], crowdWeight: 4 },
  { id: 207, key: 'fut_azul_listras', label: 'Listras azul e branco', family: 'football', pattern: 'v_stripes', palette: { bg: '#ffffff', fg: '#0b3d91', accent: '#0b3d91' }, targets: ['shirt'], crowdWeight: 1 },
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
