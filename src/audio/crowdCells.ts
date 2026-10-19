/**
 * Rodada 10 — MULTIDÃO AGREGADA para o áudio (puro). Nunca uma fonte por NPC: todo humano do quadro (pedestres,
 * concentração, remotos, multidão distante da rede — o que o CrowdDirector já junta) cai numa grade de células de
 * ~24 m em volta do ouvinte; cada célula vira UM `CrowdAudioCell` (densidade, atividade, perfil dominante e fração,
 * tipo de evento, confronto, comemoração) e só as `maxCells` mais relevantes (≈ volume × atenuação) viram vozes.
 *
 * Perfil de áudio: índice 0 = perfil do evento/ambiente; i+1 = `audioProfile` do grupo i de `supporters.json`
 * (mesma convenção de `NetPlayer.sup`). Quem veste a camisa/carrega a bandeira de um grupo vota no perfil dele —
 * tudo a partir dos DADOS (designs do grupo), sem nenhum ramo por grupo no código.
 */
import type { CrowdAudioCell } from './bus';
import { attenuation, crowdLoudness, FALLOFF } from './spatial';

export interface SupporterAudioData { groups: { audioProfile: string; clothingSet?: { shirtDesign?: number; npcShirtDesigns?: number[] }; flagSet?: number[]; bannerSet?: number[]; allowedCosmetics?: number[] }[] }

export interface AggregatorOptions { cellM: number; radiusM: number; maxCells: number; densityCap: number; maxProfiles: number }
export const DEFAULT_AGG: AggregatorOptions = { cellM: 24, radiusM: 132, maxCells: 4, densityCap: 80, maxProfiles: 8 };

export interface EventZone { x: number; z: number; r: number; type: string }

export class CrowdAudioAggregator {
  readonly opt: AggregatorOptions;
  /** perfis: [0] = ambiente/evento, [i+1] = grupo i */
  profiles: string[] = ['urbano'];
  private designProfile = new Map<number, number>();
  private G: number;
  private P: number;
  private ox = 0; private oz = 0; private lx = 0; private lz = 0;
  private count: Float32Array; private sx: Float32Array; private sz: Float32Array; private spd: Float32Array;
  private act: Float32Array; private down: Float32Array; private heat: Float32Array; private cheer: Float32Array;
  private votes: Float32Array;
  private mark: Uint8Array;
  private touched: number[] = [];
  private zones: EventZone[] = [];
  private out: CrowdAudioCell[] = [];
  private pool: CrowdAudioCell[] = [];
  private rel: number[] = [];
  /** QA: entidades somadas na última rodada */
  lastAdded = 0;

  constructor(o: Partial<AggregatorOptions> = {}) {
    this.opt = { ...DEFAULT_AGG, ...o };
    this.G = Math.ceil((this.opt.radiusM * 2) / this.opt.cellM) + 1;
    this.P = this.opt.maxProfiles;
    const n = this.G * this.G;
    this.count = new Float32Array(n); this.sx = new Float32Array(n); this.sz = new Float32Array(n); this.spd = new Float32Array(n);
    this.act = new Float32Array(n); this.down = new Float32Array(n); this.heat = new Float32Array(n); this.cheer = new Float32Array(n);
    this.votes = new Float32Array(n * this.P);
    this.mark = new Uint8Array(n);
  }

  /** perfil do ambiente/evento + perfis dos grupos (dados de supporters.json) */
  setProfiles(defaultProfile: string, data?: SupporterAudioData | null) {
    this.profiles = [defaultProfile];
    this.designProfile.clear();
    for (const g of data?.groups ?? []) {
      if (this.profiles.length >= this.P) break;
      const idx = this.profiles.length;
      this.profiles.push(g.audioProfile);
      const ids = [g.clothingSet?.shirtDesign, ...(g.clothingSet?.npcShirtDesigns ?? []), ...(g.flagSet ?? []), ...(g.bannerSet ?? []), ...(g.allowedCosmetics ?? [])];
      for (const d of ids) if (typeof d === 'number' && d > 0 && !this.designProfile.has(d)) this.designProfile.set(d, idx);
    }
  }
  /** perfil pelo design de camisa/item (0 = nenhum grupo) */
  profileOfDesign(d: number) { return d ? this.designProfile.get(d) ?? 0 : 0; }
  setDefaultProfile(p: string) { this.profiles[0] = p; }
  setEventZones(z: EventZone[]) { this.zones = z; }

  begin(lx: number, lz: number) {
    for (const i of this.touched) {
      this.count[i] = this.sx[i] = this.sz[i] = this.spd[i] = this.act[i] = this.down[i] = this.heat[i] = this.cheer[i] = 0;
      this.votes.fill(0, i * this.P, i * this.P + this.P);
      this.mark[i] = 0;
    }
    this.touched.length = 0;
    this.lastAdded = 0;
    const c = this.opt.cellM, h = (this.G - 1) / 2;
    this.lx = lx; this.lz = lz;
    // grade presa ao mundo (células não "andam" com o ouvinte); janela centrada na célula do ouvinte
    this.ox = (Math.floor(lx / c) - h) * c;
    this.oz = (Math.floor(lz / c) - h) * c;
  }

  private idx(x: number, z: number): number {
    const gx = Math.floor((x - this.ox) / this.opt.cellM), gz = Math.floor((z - this.oz) / this.opt.cellM);
    if (gx < 0 || gz < 0 || gx >= this.G || gz >= this.G) return -1;
    const i = gz * this.G + gx;
    if (!this.mark[i]) { this.mark[i] = 1; this.touched.push(i); }
    return i;
  }

  private addAt(i: number, x: number, z: number, w: number, speed: number, act: number, down: number, profile: number) {
    this.count[i] += w; this.sx[i] += x * w; this.sz[i] += z * w;
    this.spd[i] += speed * w; this.act[i] += act * w; this.down[i] += down * w;
    if (profile >= 0 && profile < this.P) this.votes[i * this.P + profile] += w;
  }

  /** um humano (NPC/remoto): velocidade, ação social (≠ 0 = gesticulando/comemorando), caído, design da camisa/item */
  addAgent(x: number, z: number, speed: number, act: number, tilt: number, shirt: number, design: number) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const i = this.idx(x, z);
    if (i < 0) return;
    this.lastAdded++;
    const p = this.profileOfDesign(shirt) || this.profileOfDesign(design);
    // agentes da multidão distante podem não ter velocidade/inclinação (NaN/ausente): contam como parados
    this.addAt(i, x, z, 1, Number.isFinite(speed) ? Math.abs(speed) : 0, act ? 1 : 0, Number.isFinite(tilt) && Math.abs(tilt) > 0.5 ? 1 : 0, p);
  }

  /** voto de perfil de um jogador (NetPlayer.sup: 0 neutro, i+1 grupo i) — sem somar densidade (já veio como agente) */
  addVote(x: number, z: number, sup: number, w = 1) {
    if (!(sup > 0)) return;
    const i = this.idx(x, z);
    if (i < 0 || sup >= this.P) return;
    this.votes[i * this.P + sup] += w;
  }

  /** massa agregada (células do espectador no alto): `count` pessoas com atividade 0..1 */
  addMass(x: number, z: number, count: number, activity: number) {
    if (!(count > 0)) return;
    const i = this.idx(x, z);
    if (i < 0) return;
    this.lastAdded += count;
    this.addAt(i, x, z, count, activity * 2, activity, 0, 0);
  }

  /** calor de evento curto (golpes/quedas recentes, comemoração) em (x, z) — 0..1 */
  addHeat(x: number, z: number, combat: number, celebration: number) {
    const i = this.idx(x, z);
    if (i < 0) return;
    this.heat[i] += combat; this.cheer[i] += celebration;
  }

  /** células mais relevantes (≤ maxCells), mais relevante primeiro; objetos reutilizados entre chamadas */
  end(): readonly CrowdAudioCell[] {
    this.out.length = 0; this.rel.length = 0;
    const P = this.P, max = this.opt.maxCells;
    let k = 0;
    for (const i of this.touched) {
      const n = this.count[i];
      if (n < 0.5) continue;
      const x = this.sx[i] / n, z = this.sz[i] / n;
      const dens = crowdLoudness(n, this.opt.densityCap);
      const r = dens * attenuation(Math.hypot(x - this.lx, z - this.lz), FALLOFF.crowdCell);
      if (r <= 0) continue;
      // inserção ordenada nas top-N (N pequeno)
      let pos = this.rel.length;
      while (pos > 0 && this.rel[pos - 1] < r) pos--;
      if (pos >= max) continue;
      let best = 0, bestV = -1, tot = 0;
      for (let p = 0; p < P; p++) { const v = this.votes[i * P + p]; tot += v; if (v > bestV) { bestV = v; best = p; } }
      const cell = this.pool[k] ?? (this.pool[k] = { x: 0, z: 0, density: 0, activity: 0, profile: '', profileShare: 0, combatIntensity: 0, celebrationIntensity: 0 });
      k++;
      const actFrac = this.act[i] / n, downFrac = this.down[i] / n, avgSpd = this.spd[i] / n;
      cell.x = x; cell.z = z; cell.density = n;
      cell.combatIntensity = Math.min(1, downFrac * 2 + this.heat[i]);
      cell.celebrationIntensity = Math.min(1, actFrac * 1.3 + this.cheer[i]);
      cell.activity = Math.min(1, 0.35 * Math.min(1, avgSpd / 2.5) + 0.9 * actFrac + 0.5 * cell.combatIntensity);
      cell.profile = this.profiles[tot > 0 ? best : 0] ?? this.profiles[0];
      cell.profileShare = tot > 0 ? bestV / tot : 1;
      cell.eventType = undefined;
      for (const zn of this.zones) if (Math.hypot(zn.x - x, zn.z - z) <= zn.r) { cell.eventType = zn.type; break; }
      this.rel.splice(pos, 0, r);
      this.out.splice(pos, 0, cell);
      if (this.out.length > max) { this.out.length = max; this.rel.length = max; }
    }
    return this.out;
  }
}
