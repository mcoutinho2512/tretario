/**
 * Rodada 10 — painel contextual da PESSOA (clique/toque em outro jogador perto; docs/INTERACTION_SYSTEM.md,
 * docs/PRIVACY_ARCHITECTURE.md). Compacto: VER PERFIL · INTERAGIR · SILENCIAR · DENUNCIAR — sem "atacar".
 *
 * Privacidade: só o que já é PÚBLICO no mundo — apelido (NetPlayer.name) e torcida pelo `displayName` dos DADOS
 * (public/gameplay/supporters.json, índice `NetPlayer.sup`). Nunca e-mail, conta, IP, sessão, ids ou dado
 * administrativo: o painel não recebe nada disso. Silenciar = mute por identidade do chat (`chat_mute {nid}`, o
 * servidor resolve a conta); denunciar = `user_report {nid, category}` (o servidor valida, limita e guarda a
 * evidência; a resposta não traz ids).
 */
import { EscSlot } from './escStack'; // rodada 11 — entrada
import { REPORT_CATEGORIES, REPORT_LABELS, type ReportCategory } from '../chat/protocol';

export interface PersonPanelDeps {
  touch: boolean;
  /** dados públicos da pessoa (null = saiu do mundo / da área) */
  profile(id: string): { name: string; sup: number } | null;
  /** distância atual (m) até a pessoa; null = sumiu */
  distance(id: string): number | null;
  /** nome de exibição da torcida pelos dados (sup = índice + 1; 0 = sem torcida) */
  supporter(sup: number): string | null;
  /** gestos sociais existentes que dá para fazer "para" a pessoa (vira para ela e faz) */
  gestures: { id: number; label: string }[];
  gesture(id: string, actionId: number): void;
  /** a pessoa está silenciada por mim (lista do servidor, por apelido no momento) */
  muted(name: string): boolean;
  setMuted(nid: number, name: string, on: boolean): void;
  report(nid: number, category: ReportCategory): void;
  onModal(open: boolean): void;
  flash(msg: string): void;
}

type View = 'main' | 'profile' | 'interact' | 'report';
/** o painel fecha sozinho quando a pessoa se afasta disto (m) */
export const PERSON_PANEL_CLOSE_M = 14;

export class PersonPanel {
  readonly el: HTMLDivElement;
  private body: HTMLDivElement;
  private nameEl: HTMLDivElement;
  private subEl: HTMLDivElement;
  private target: { id: string; nid: number; name: string; sup: number } | null = null;
  private view: View = 'main';
  private acc = 0;
  private esc = new EscSlot('pessoa', 100, () => this.close());
  /** QA */
  readonly log: string[] = [];

  constructor(private d: PersonPanelDeps) {
    const el = (this.el = document.createElement('div'));
    el.className = 'person-panel';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Pessoa');
    const head = document.createElement('div'); head.className = 'pp-head';
    const who = document.createElement('div'); who.style.flex = '1'; who.style.minWidth = '0';
    this.nameEl = document.createElement('div'); this.nameEl.className = 'pp-name';
    this.subEl = document.createElement('div'); this.subEl.className = 'pp-sub';
    who.append(this.nameEl, this.subEl);
    const x = document.createElement('button'); x.type = 'button'; x.className = 'pp-close'; x.textContent = '×'; x.setAttribute('aria-label', 'Fechar');
    x.addEventListener('click', () => this.close());
    head.append(who, x);
    this.body = document.createElement('div');
    el.append(head, this.body);
    // não deixa o toque/clique atravessar para o mundo (câmera, interação)
    for (const ev of ['pointerdown', 'touchstart', 'mousedown'] as const) el.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    // clique esquerdo fora fecha (o direito é a câmera: girar não fecha o painel); Esc pela pilha única (rodada 11)
    document.addEventListener('pointerdown', (e) => { if (!el.hidden && e.button === 0 && !el.contains(e.target as Node)) this.close(); }, true);
  }

  get open() { return !this.el.hidden; }

  show(id: string, nid: number) {
    const p = this.d.profile(id);
    if (!p) { this.d.flash('Essa pessoa saiu daqui'); return; }
    this.target = { id, nid, name: p.name, sup: p.sup };
    this.view = 'main';
    this.render();
    const was = this.open;
    this.el.hidden = false;
    this.log.push(`open:${p.name}`);
    if (!was) { this.esc.set(true); this.d.onModal(true); }
    (this.body.querySelector('button') as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }

  close() {
    if (!this.open) return;
    this.el.hidden = true;
    this.esc.set(false);
    this.target = null;
    this.log.push('close');
    this.d.onModal(false);
  }

  /** ~4 Hz: fecha se a pessoa sumiu ou se afastou */
  tick(dt: number) {
    if (!this.open || !this.target) return;
    this.acc += dt;
    if (this.acc < 0.25) return;
    this.acc = 0;
    const dist = this.d.distance(this.target.id);
    if (dist === null || dist > PERSON_PANEL_CLOSE_M) { this.close(); this.d.flash(dist === null ? 'A pessoa saiu daqui' : 'A pessoa se afastou'); }
  }

  private btn(label: string, fn: () => void, cls = '') {
    const b = document.createElement('button');
    b.type = 'button'; b.className = `pp-btn ${cls}`.trim(); b.textContent = label;
    b.addEventListener('click', (e) => { e.preventDefault(); fn(); });
    return b;
  }

  private render() {
    const t = this.target;
    if (!t) return;
    const sup = this.d.supporter(t.sup);
    this.nameEl.textContent = t.name;
    this.subEl.textContent = sup ? `Torcida: ${sup}` : 'Sem torcida escolhida';
    const b = this.body;
    b.replaceChildren();
    if (this.view === 'main') {
      const g = document.createElement('div'); g.className = 'pp-grid';
      const muted = this.d.muted(t.name);
      g.append(
        this.btn('VER PERFIL', () => this.go('profile')),
        this.btn('INTERAGIR', () => this.go('interact')),
        this.btn(muted ? 'DESSILENCIAR' : 'SILENCIAR', () => { this.d.setMuted(t.nid, t.name, !muted); this.log.push(muted ? 'unmute' : 'mute'); this.close(); }),
        this.btn('DENUNCIAR', () => this.go('report'), 'warn'),
      );
      b.append(g);
    } else if (this.view === 'profile') {
      const row = (k: string, v: string) => { const r = document.createElement('div'); r.className = 'pp-row'; const a = document.createElement('span'); a.textContent = k; const c = document.createElement('span'); c.textContent = v; r.append(a, c); return r; };
      b.append(row('Apelido', t.name), row('Torcida', sup ?? 'Nenhuma'));
      const n = document.createElement('div'); n.className = 'pp-note'; n.textContent = 'Só dados públicos. Conta, e-mail e localização real nunca aparecem.';
      b.append(n, this.back());
    } else if (this.view === 'interact') {
      const l = document.createElement('div'); l.className = 'pp-list';
      for (const gst of this.d.gestures) l.append(this.btn(gst.label, () => { this.d.gesture(t.id, gst.id); this.log.push(`gesture:${gst.id}`); this.close(); }));
      b.append(l, this.back());
    } else {
      const l = document.createElement('div'); l.className = 'pp-list';
      const k = document.createElement('div'); k.className = 'pp-sub'; k.textContent = `Denunciar ${t.name} por:`;
      l.append(k);
      for (const c of REPORT_CATEGORIES) l.append(this.btn(REPORT_LABELS[c], () => { this.d.report(t.nid, c); this.log.push(`report:${c}`); this.close(); }));
      b.append(l, this.back());
    }
  }

  private back() { return this.btn('Voltar', () => this.go('main')); }
  private go(v: View) { this.view = v; this.log.push(`view:${v}`); this.render(); (this.body.querySelector('button') as HTMLButtonElement | null)?.focus({ preventScroll: true }); }

  /** QA */
  info() { return { open: this.open, view: this.view, name: this.target?.name ?? null, text: this.open ? this.el.innerText : '', log: this.log.slice(-20) }; }
}
