/**
 * Formato dos dados do mundo produzidos pelo pipeline (tools/) e consumidos pelo cliente.
 * Todas as coordenadas estão no sistema local do mundo (metros): x = leste, z = sul (−norte).
 */

export type XZ = [number, number];
/** Polígono: anel externo + buracos. */
export interface Poly {
  outer: XZ[];
  holes?: XZ[][];
}

/** Classe do edifício (ver docs/ARCHITECTURE.md). */
export type BuildingClass = 'A' | 'B' | 'C' | 'D';

/** Estilos de fachada procedural (interpretados pelo shader de edifícios). */
export enum FacadeStyle {
  ModernOffice = 0, // faixas de janelas / pele de vidro
  ClassicPunched = 1, // janelas recortadas (prédios 1930–1960)
  ArtDecoPiers = 2, // pilastras verticais marcadas
  Sobrado = 3, // casario antigo 2–4 pavimentos (Saara)
  Institutional = 4, // pedra / poucas janelas grandes
  Eclectic = 5, // eclético/neoclássico do Centro histórico: base rusticada, janelas com frontão, pilastras, cornija
}

export interface BuildingRec {
  id: number; // id OSM (way ou relation)
  poly: Poly;
  height: number; // topo (m)
  minHeight: number; // base (m) — building:part / marquises
  levels: number;
  heightSource: 'osm:height' | 'osm:levels' | 'estimate';
  cls: BuildingClass;
  style: FacadeStyle;
  /** 0–1: cor base de parede (paleta no shader). */
  tint: number;
  /** semente determinística por edifício */
  seed: number;
  /** térreo com galeria/arcada (frente para a Presidente Vargas) */
  arcade?: boolean;
  /** índices das arestas do anel externo com galeria (recuo real com colunata) */
  arcadeEdges?: number[];
  /** parede lisa sem janelas (monumentos, mausoléus, muros altos) */
  plain?: boolean;
  /** marquise/cobertura (building=roof): sem colisão, laje fina */
  canopy?: boolean;
  name?: string;
}

export type RoadKind =
  | 'trunk' | 'primary' | 'secondary' | 'tertiary' | 'residential' | 'unclassified'
  | 'service' | 'living_street' | 'link';

export interface RoadRec {
  id: number;
  name?: string;
  kind: RoadKind;
  lanes: number;
  width: number;
  oneway: boolean;
  pts: XZ[];
  presidenteVargas?: boolean;
  /** 'central' | 'lateral' para as pistas da Presidente Vargas */
  pvRole?: 'central' | 'lateral';
}

/** Faixa de pedestres: segmento a→b (trajeto do pedestre sobre o asfalto), largura w. */
export interface CrossingRec {
  a: XZ;
  b: XZ;
  w: number;
  signals: boolean;
}

export interface SignalRec {
  p: XZ;
  dir: number;
  width: number;
}

export type PropKind = 'tree' | 'palm' | 'lamp' | 'bench' | 'bus_stop' | 'bus_pole' | 'bollard' | 'waste' | 'kiosk' | 'signal';

export interface PropRec {
  k: PropKind;
  p: XZ;
  /** semáforo: cruzamento controlador e fase */
  j?: number;
  ph?: number;
  r?: number; // rotação (rad)
  s?: number; // escala
  proc?: 1; // gerado proceduralmente (não mapeado no OSM)
}

export type AreaKind = 'park' | 'grass' | 'plaza' | 'parking' | 'platform' | 'water' | 'pitch' | 'rail_yard';

export interface AreaRec {
  kind: AreaKind;
  poly: Poly;
  name?: string;
}

export interface LineRec {
  kind: 'rail' | 'tram' | 'fence' | 'wall';
  pts: XZ[];
}

export interface LandmarkRec {
  key: 'LANDMARK_CENTRAL' | 'LANDMARK_CANDELARIA';
  name: string;
  osmId: number;
  footprint: XZ[];
  center: XZ;
  /** direção (rad, no plano XZ, atan2(dz, dx)) do eixo longo */
  axis: number;
  /** dimensões no eixo local (comprimento ao longo do eixo, largura perpendicular) */
  length: number;
  width: number;
}

export interface ValidationPoint {
  key: string;
  label: string;
  p: XZ;
  lat: number;
  lon: number;
  radius: number;
}

/** Geometria de superfícies (pré-calculada no build, recortada por chunk). */
export interface SurfaceSet {
  road: Poly[]; // asfalto (y = 0)
  ground: Poly[]; // calçadas / canteiros (y = CURB)
  plaza: Poly[]; // praças / calçadões em pedra portuguesa (y = CURB)
  green: Poly[]; // gramados (y = CURB)
  platform: Poly[]; // plataformas ferroviárias elevadas
  ballast: Poly[]; // pátio ferroviário (brita)
  water: Poly[]; // espelhos d'água
  /** bordas de meio-fio (contornos das pistas) */
  curbs: XZ[][];
}

export interface MarkingSet {
  /** linhas tracejadas entre faixas */
  dashed: XZ[][];
  /** linhas contínuas (bordas/eixo) */
  solid: XZ[][];
  crossings: CrossingRec[];
}

export interface ChunkData {
  key: string;
  cx: number;
  cz: number;
  bounds: [number, number, number, number]; // minX, minZ, maxX, maxZ
  buildings: BuildingRec[];
  surfaces: SurfaceSet;
  markings: MarkingSet;
  props: PropRec[];
  signals: SignalRec[];
  lines: LineRec[];
  areas: AreaRec[];
}

export interface WorldManifest {
  version: string;
  generatedAt: string;
  origin: { lat: number; lon: number };
  chunkSize: number;
  bounds: [number, number, number, number];
  chunks: { key: string; cx: number; cz: number; file: string; buildings: number; bytes: number; maxHeight: number }[];
  landmarks: LandmarkRec[];
  validation: ValidationPoint[];
  spawn: { p: XZ; yaw: number };
  /** eixo aproximado da Presidente Vargas (para minimapa / validação) */
  pvAxis: XZ[];
  /** polilinhas simplificadas das ruas para o minimapa */
  minimapRoads: { pts: XZ[]; w: number; pv?: boolean; name?: string }[];
  monuments?: MonumentRec[];
  billboards?: BillboardSlot[];
  streetSigns?: StreetSignRec[];
  /** arquivo das faixas de tráfego (veículos NPC) */
  traffic?: string;
  attribution: string;
  osmTimestamp: string | null;
}

export const CURB_HEIGHT = 0.15;
export const PLATFORM_HEIGHT = 1.0;

/** Faixa de tráfego dirigível (sentido = ordem dos pontos). */
export interface TrafficLane {
  id: number;
  pts: XZ[];
  pv?: 1;
  next: number[];
  /** velocidade de cruzeiro (m/s) */
  speed: number;
  /** linhas de retenção: distância ao longo da faixa, cruzamento, fase */
  stops?: { s: number; j: number; ph: number }[];
}

/** Cruzamento semaforizado (controlador de fases). */
export interface Junction {
  id: number;
  c: XZ;
  /** defasagem do ciclo (s) — onda verde ao longo da Pres. Vargas */
  offset: number;
}

/** Faixa de pedestres utilizável por NPCs. */
export interface PedCrossing {
  a: XZ;
  b: XZ;
  /** cruzamento semaforizado (ou −1) e fase dos VEÍCULOS que a faixa atravessa */
  j: number;
  ph: number;
}

export interface TrafficData {
  lanes: TrafficLane[];
  junctions: Junction[];
  crossings: PedCrossing[];
}

/** Monumentos e mobiliário notável com posição real (OSM). */
export interface MonumentRec {
  kind: 'equestrian' | 'statue' | 'bust' | 'kinetic' | 'clock';
  p: XZ;
  name?: string;
  /** direção (rad) para onde a figura "olha" (padrão: eixo da avenida) */
  r?: number;
  /** altura da base (pedestal/edifício mapeado sob o monumento) */
  base?: number;
}

/** Placa de logradouro (padrão carioca: azul, letras brancas, faixa amarela) */
export interface StreetSignRec {
  p: XZ;
  /** direção (rad) da face principal */
  r: number;
  names: string[];
}

/** Local identificado para painel de LED virtual (fachada voltada para a avenida). */
export interface BillboardSlot {
  id: string;
  /** centro do painel (x, z) e altura do centro */
  p: XZ;
  y: number;
  w: number;
  h: number;
  /** direção (rad, atan2 dx,dz) para onde a face do painel aponta */
  r: number;
  /** zona: nome do cruzamento/marco mais próximo */
  zone: string;
  buildingId: number;
}
