/**
 * Cliente dos EVENTOS AGENDADOS (rodada 9): só EXIBE o que o servidor decide (agenda, progresso, resultado) e PEDE
 * inscrição/saída/acompanhar. Nunca informa checkpoint, chegada ou participação.
 *  - `agenda`     guardada para a UI de agenda (agente E) — `list`, `onAgenda`
 *  - `evt_pts`    concentrações dos eventos → RallyPoint kind 'event' (RallyCrowd: NPCs SIMULADOS caminham com o líder
 *                 da caminhada / assistem à corrida; nunca contados como jogadores) + rótulo no minimapa
 *  - corrida      `race_def` → marcadores baratos (anéis instanciados de uma geometria só) para inscritos e quem
 *                 acompanha; `race` → painel (checkpoint, volta, posição, tempo); `evt_result` → classificação
 *  - caminhada    `walk` → painel (quanto falta / quanto você acompanhou); confronto: `clash` → placar por grupo
 *  - rodada 12    `dyn` → sinais do mundo dinâmico (`dyn`, `onDyn`): áudio/minimapa leem daqui (nada decide no cliente)
 */
import * as THREE from 'three';
import type { AgendaEntry, AgendaMessage, ClashStateMessage, DynamicSignalWire, DynamicSignalsMessage, EventPointsMessage, EventResultMessage, RaceDefMessage, RaceProgress, WalkStateMessage } from './schedule';
import { rallyPoints, RALLY_DEFAULT_WEIGHTS } from '../social/rally';
import { worldClock } from '../net/clock';
import { loadSupporterData, supAt, supporterData } from '../supporters/data'; // rodada 10 — concentrações de torcida
import './events.css';

interface NetLike { on(type: string, fn: (m: any) => void): () => void; send(type: string, payload?: unknown): void; sessionId: string }
interface MapLike { eventMarks: { x: number; z: number; color: string; label?: string; r?: number; ring?: string }[] }

const DENIAL: Record<string, string> = {
  inexistente: 'Evento não encontrado', fechado: 'Inscrições fechadas', lotado: 'Evento lotado', grupo: 'Seu grupo não participa deste evento',
  veiculo: 'Monte no veículo da corrida para se inscrever', ja_inscrito: 'Você já está inscrito em um evento', sem_permissao: 'Sem permissão para participar',
};
const fmtT = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

export class EventClient {
  list: AgendaEntry[] = [];
  agendaMsgs = 0;
  onAgenda: ((l: AgendaEntry[]) => void) | null = null;
  race: RaceProgress & { status?: string; reason?: string } | null = null;
  raceDef: RaceDefMessage | null = null;
  walk: WalkStateMessage | null = null;
  clash: ClashStateMessage | null = null;
  result: EventResultMessage | null = null;
  lastRes: { inst: string; ok: boolean; r?: string } | null = null;
  /** nome exibido de um grupo (chave → nome dos dados do evento; o Game liga) */
  groupName: (key: string) => string = (k) => k;
  done: string[] = [];
  points: EventPointsMessage['list'] = [];
  /** rodada 12 — eventos dinâmicos vivos (`dyn`): tipo, posição, raio, escalada e intensidades 0..1 */
  dyn: DynamicSignalWire[] = [];
  dynMsgs = 0;
  onDyn: ((l: DynamicSignalWire[]) => void) | null = null;
  private marks = new THREE.Group();
  private rings: THREE.InstancedMesh | null = null;
  private next: THREE.Mesh | null = null;
  private panel = document.createElement('div');
  private timer = 0;
  private pointIds = new Set<string>();

  constructor(private net: NetLike, scene: THREE.Scene, hud: HTMLElement, private flash: (m: string) => void, private map: MapLike | null) {
    this.marks.name = 'event-markers';
    void loadSupporterData().then(() => this.syncMap()); // rodada 10 — cores/siglas das concentrações de torcida
    scene.add(this.marks);
    this.panel.className = 'evt-panel';
    this.panel.hidden = true;
    hud.appendChild(this.panel);
    net.on('agenda', (m: AgendaMessage) => { this.list = m?.list ?? []; this.agendaMsgs++; this.onAgenda?.(this.list); this.pruneEnded(); });
    net.on('evt_pts', (m: EventPointsMessage) => this.onPoints(m));
    // rodada 12 — sinais do MUNDO DINÂMICO (docs/DYNAMIC_WORLD.md): guardados para o áudio/minimapa (agente D liga)
    net.on('dyn', (m: DynamicSignalsMessage) => { this.dyn = Array.isArray(m?.list) ? m.list.slice(0, 32) : []; this.dynMsgs++; this.onDyn?.(this.dyn); });
    net.on('evt_res', (m: { inst: string; ok: boolean; r?: string }) => { this.lastRes = m; if (!m.ok && m.r) this.flash(DENIAL[m.r] ?? `Inscrição negada (${m.r})`); });
    net.on('evt_done', (m: { inst: string }) => { this.done.push(m.inst); this.flash('Participação concluída no evento!'); });
    net.on('race_def', (m: RaceDefMessage) => this.onRaceDef(m));
    net.on('race', (m: RaceProgress) => { this.race = m; this.updateNext(); this.render(); });
    net.on('race_board', () => {});
    net.on('walk', (m: WalkStateMessage) => { this.walk = m; this.render(); });
    net.on('clash', (m: ClashStateMessage) => { this.clash = m; this.render(); });
    net.on('evt_result', (m: EventResultMessage) => { this.result = m; this.render(); setTimeout(() => { if (this.result === m) { this.result = null; this.clearRace(); this.render(); } }, 20_000); });
  }

  /** pedidos (a UI de agenda do agente E chama estes) */
  join(inst: string) { this.net.send('evt_join', { inst }); }
  leave(inst: string) { this.net.send('evt_leave', { inst }); }
  watch(inst: string, on = true) { this.net.send('evt_watch', { inst, on }); }

  // ---------------------------------------------------------------- concentrações (NPCs simulados + minimapa)
  private onPoints(m: EventPointsMessage) {
    this.points = m?.list ?? [];
    const ids = new Set<string>();
    for (const p of this.points) {
      const id = `evt_${p.id}`;
      ids.add(id);
      const cur = rallyPoints.get(id);
      // andar (caminhada) só atualiza a posição; o RallyCrowd faz cada NPC caminhar até o novo lugar
      if (cur && cur.radius === p.radius && (cur.sup ?? 0) === (p.sup ?? 0)) { cur.x = p.x; cur.z = p.z; continue; }
      // rodada 10 — concentração de torcida: mais bandeira/palmas/percussão corporal (sem cantos), NPCs nas cores (RallyCrowd)
      const sw: Record<string, number> = p.sup ? { flag_wave: 7, rhythm_clap: 5, arms_up: 4, jump_cheer: 2, banner_hold: 3 } : {};
      rallyPoints.upsert({ id, kind: 'event', x: p.x, z: p.z, inner: p.inner, radius: p.radius, strength: p.strength, crowd: p.crowd, label: p.label, ...(p.sup ? { sup: p.sup } : {}), actionWeights: { ...RALLY_DEFAULT_WEIGHTS.event, clap: 4, cheer: 3, flag_wave: 4, ...sw } });
    }
    for (const id of this.pointIds) if (!ids.has(id)) rallyPoints.remove(id);
    this.pointIds = ids;
    this.syncMap();
  }

  private syncMap() {
    if (!this.map) return;
    // rodada 10 — concentração de torcida: cor principal e sigla da torcida (marcador AGREGADO do ponto, nunca de jogador)
    const marks: MapLike['eventMarks'] = this.points.map((p) => { const g = p.sup ? supAt(supporterData(), p.sup) : null; return { x: p.x, z: p.z, color: g?.primaryColors[0] ?? '#ffd23f', label: (g?.shortName ?? p.label).toUpperCase(), r: g ? 4 : 5, ...(g ? { ring: g.primaryColors[1] ?? '#ffffff' } : {}) }; });
    if (this.raceDef) {
      const nx = this.nextTarget();
      for (const c of this.raceDef.cps) marks.push({ x: c.x, z: c.z, color: nx && nx.x === c.x && nx.z === c.z ? '#3dffa2' : 'rgba(61, 255, 162, 0.45)', r: nx && nx.x === c.x && nx.z === c.z ? 4 : 2.5 });
      marks.push({ x: this.raceDef.start.x, z: this.raceDef.start.z, color: '#ffffff', label: 'LARGADA', r: 3.5 });
    }
    this.map.eventMarks = marks;
  }

  // ---------------------------------------------------------------- corrida: marcadores
  private onRaceDef(m: RaceDefMessage) {
    this.clearRace();
    this.raceDef = m;
    const ring = new THREE.TorusGeometry(1, 0.06, 6, 28);
    ring.rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x3dffa2, transparent: true, opacity: 0.45, depthWrite: false });
    const all = [...m.cps, m.start];
    this.rings = new THREE.InstancedMesh(ring, mat, all.length);
    const o = new THREE.Object3D();
    all.forEach((c, i) => { o.position.set(c.x, 0.25, c.z); o.scale.setScalar(c.r); o.updateMatrix(); this.rings!.setMatrixAt(i, o.matrix); });
    this.rings.instanceMatrix.needsUpdate = true;
    this.rings.frustumCulled = false;
    this.marks.add(this.rings);
    // próximo checkpoint: coluna de luz (um cilindro aberto, sem iluminação)
    const col = new THREE.CylinderGeometry(1, 1, 14, 20, 1, true);
    col.translate(0, 7, 0);
    this.next = new THREE.Mesh(col, new THREE.MeshBasicMaterial({ color: 0x3dffa2, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
    this.marks.add(this.next);
    this.updateNext();
    this.render();
  }

  private nextTarget(): { x: number; z: number; r: number } | null {
    const d = this.raceDef;
    if (!d) return null;
    const step = this.race?.inst === d.inst ? this.race.cp : 0;
    if (this.race?.finished) return null;
    return step < d.laps * d.cps.length ? d.cps[step % d.cps.length] : d.start;
  }

  private updateNext() {
    const t = this.nextTarget();
    if (this.next) { this.next.visible = !!t; if (t) { this.next.position.set(t.x, 0, t.z); this.next.scale.set(t.r, 1, t.r); } }
    this.syncMap();
  }

  private clearRace() {
    for (const c of [...this.marks.children]) {
      this.marks.remove(c);
      const m = c as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose?.();
    }
    this.rings = null; this.next = null; this.raceDef = null; this.race = null;
    this.syncMap();
  }

  /** instância encerrada saiu da agenda / terminou: limpa o painel que ficou para trás */
  private pruneEnded() {
    const live = new Set(this.list.filter((e) => e.state === 'REGISTRATION' || e.state === 'STARTING' || e.state === 'ACTIVE').map((e) => e.inst));
    if (this.walk && !live.has(this.walk.inst)) this.walk = null;
    if (this.clash && !live.has(this.clash.inst)) this.clash = null;
    if (this.raceDef && !live.has(this.raceDef.inst) && !this.result) this.clearRace();
    this.render();
  }

  // ---------------------------------------------------------------- painel
  private render() {
    const rows: string[] = [];
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const name = (inst: string) => esc(this.list.find((e) => e.inst === inst)?.name ?? 'Evento');
    if (this.result) {
      const r = this.result;
      rows.push(`<b>${name(r.inst)} — resultado</b>`);
      if (r.score) rows.push(Object.entries(r.score).map(([g, v]) => `${esc(this.groupName(g))}: ${v}`).join(' · '));
      for (const x of r.rows.slice(0, 8)) rows.push(`${x.rank}º ${esc(x.group ? this.groupName(x.group) : x.name)} ${x.status === 'ok' && x.timeMs ? fmtT(x.timeMs) : x.status === 'ok' ? '' : x.status.toUpperCase()}${x.reason ? ` (${esc(x.reason)})` : ''}`);
    } else if (this.race && this.raceDef) {
      const r = this.race, d = this.raceDef, n = d.cps.length;
      const t = r.t < 0 ? `LARGADA EM ${Math.ceil(-r.t / 1000)} s` : fmtT(r.t);
      rows.push(`<b>${name(r.inst)}</b> · ${t}`);
      rows.push(r.status ? `${r.status.toUpperCase()}${r.reason ? ` — ${esc(r.reason)}` : ''}` : r.finished ? `CHEGOU · ${r.rank}º de ${r.total}` : `${r.cp >= d.laps * n ? 'Rumo à chegada' : `Checkpoint ${(r.cp % n) + 1}/${n}`} · volta ${r.lap}/${d.laps} · ${r.rank}º de ${r.total}`);
    } else if (this.walk) {
      const w = this.walk;
      rows.push(`<b>${name(w.inst)}</b> · ${Math.round((w.d / Math.max(1, w.total)) * 100)}% da rota`);
      rows.push(w.done ? 'Participação concluída — acompanhe até o fim!' : `Você acompanhou ${w.mine} de ${w.need} m · fique perto da concentração`);
    } else if (this.clash) {
      const c = this.clash;
      rows.push(`<b>${name(c.inst)}</b> · ${fmtT(c.endsAt - worldClock.now())}`);
      rows.push(Object.entries(c.score).map(([g, v]) => `${esc(this.groupName(g))} ${v}`).join(' × ') + (c.hold ? ` · área: ${esc(this.groupName(c.hold))}` : ''));
    }
    this.panel.hidden = !rows.length;
    this.panel.innerHTML = rows.map((r) => `<div>${r}</div>`).join('');
    // relógio do confronto anda entre mensagens (1 Hz) só enquanto há painel; corrida: o servidor manda a 2 Hz
    if (rows.length && !this.timer) this.timer = window.setInterval(() => this.render(), 1000);
    if (!rows.length && this.timer) { clearInterval(this.timer); this.timer = 0; }
  }

  info() {
    return { agenda: this.list, agendaMsgs: this.agendaMsgs, race: this.race, raceDef: this.raceDef ? { inst: this.raceDef.inst, cps: this.raceDef.cps.length } : null, walk: this.walk, clash: this.clash, result: this.result, lastRes: this.lastRes, done: this.done, points: this.points, markers: this.marks.children.length, panel: this.panel.hidden ? '' : this.panel.textContent };
  }
}
