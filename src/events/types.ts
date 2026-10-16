/**
 * Modelo genérico de EVENTOS (docs/EVENTS.md, ADR-010).
 *
 * A Presidente Vargas é uma PLATAFORMA DE EVENTOS: o mesmo mundo recebe um dia comum, um clássico de futebol,
 * um ato/manifestação, um show, um encontro… Nada no código conhece "política" ou "futebol": tudo vem de dados
 * (JSON em public/events/ hoje; do backend no futuro). Trocar o evento não exige rebuild do jogo.
 */

export type HexColor = string; // "#rrggbb"

/** Um time (ex.: clube num clássico). Nomes/escudos reais exigem licença do titular — o operador é responsável. */
export interface Team {
  id: string;
  name: string;
  colors: HexColor[]; // [principal, secundária, …]
  badgeUrl?: string;
}

/** Grupo de participantes (torcida, movimento, coletivo, convidados…). Pode estar ligado a um time. */
export interface Group {
  id: string;
  name: string;
  colors: HexColor[];
  teamId?: string;
  /** fração aproximada dos NPCs vestindo as cores do grupo */
  npcShare?: number;
}

/** Avatar disponível no evento (tipos de corpo base: homem, mulher, idoso, idosa). */
export interface AvatarOption {
  id: string;
  body: 'homem' | 'mulher' | 'idoso' | 'idosa';
  name?: string;
}

/** Item cosmético (roupa/acessório). Futuramente vendável; nunca dá vantagem de jogo. */
export interface Cosmetic {
  id: string;
  name: string;
  slot: 'top' | 'bottom' | 'shoes' | 'accessory';
  colors: HexColor[];
  groupId?: string;
  price?: number; // centavos — apenas metadado; sem cobrança implementada
}

/** Decoração do mundo aplicada pelo evento. */
export interface WorldDecoration {
  type: 'banner' | 'flag';
  /** onde: postes da Pres. Vargas (canteiros/calçadas) */
  placement: 'pv-lamps';
  colors: HexColor[];
  /** um a cada N postes */
  every?: number;
  text?: string;
}

/** Conteúdo para painéis de LED. Pode vir do backend (url) — imagem, vídeo — ou ser gerado (texto). */
export interface BillboardContent {
  type: 'image' | 'video' | 'text';
  url?: string;
  text?: string;
  subtext?: string;
  colors?: HexColor[];
}

export interface BillboardPlan {
  default?: BillboardContent;
  /** conteúdo por zona (ex.: "INTERSECTION_RIO_BRANCO") ou por id de painel */
  byZone?: Record<string, BillboardContent>;
  byPanel?: Record<string, BillboardContent>;
  /** rotação entre conteúdos (segundos); 0 = fixo */
  rotateSeconds?: number;
  playlist?: BillboardContent[];
}

/** Veículo disponível para uso no evento. */
export interface VehicleOption {
  id: string;
  kind: 'bicycle' | 'scooter' | 'car' | 'moto' | 'soundcar' | 'trio';
  name: string;
  /** spawns: 'bike-stations' = estações de bicicleta reais do OSM */
  spawn: 'bike-stations' | 'none';
  colors?: HexColor[];
}

export interface EventDef {
  id: string;
  name: string;
  /** categoria livre — apenas para UI/filtros (ex.: "cotidiano", "futebol", "politico", "show", "encontro") */
  category: string;
  description?: string;
  /** combate permitido? (o servidor é a autoridade; o cliente apenas exibe) */
  interaction?: 'pacifico' | 'opcional';
  teams?: Team[];
  groups?: Group[];
  avatars?: AvatarOption[];
  cosmetics?: Cosmetic[];
  decorations?: WorldDecoration[];
  billboards?: BillboardPlan;
  vehicles?: VehicleOption[];
  /**
   * cenário de evento (rodada 7): arte dos painéis por id (trio0, som0, truck0…, stage0 → chave de design em
   * src/social/designs.ts / public/designs/campaigns.json) e programação dos telões. Sem isto: arte neutra do ato;
   * caminhões de campanha recebem as campanhas cadastradas em rodízio (todas tratadas igualmente).
   */
  scenery?: {
    designs?: Record<string, string>;
    /** slides dos telões: chave de design, 'info' (hora/pessoas) ou 'eq' (equalizador + letreiro) */
    screens?: string[];
    screenSeconds?: number;
    /** texto do letreiro do equalizador */
    ticker?: string;
  };
  npcs?: { pedestrianDensity?: number; vehicleDensity?: number };
  /**
   * vida social da multidão (rodada 7): atividade, itens, designs e ações dos NPCs — ver src/social/crowdSocial.ts.
   * Designs de campanha entram por `designWeights` (chave ou `family:campaign`, dividido igualmente: neutro).
   */
  social?: import('../social/crowdSocial').SocialCrowdConfig;
  ambience?: { music?: string; crowd?: string };
}
