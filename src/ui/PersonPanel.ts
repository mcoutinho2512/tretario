/**
 * Rodada 10 — painel contextual da PESSOA (clique/toque em outro jogador perto; docs/INTERACTION_SYSTEM.md,
 * docs/PRIVACY_ARCHITECTURE.md). Compacto: VER PERFIL · INTERAGIR · SILENCIAR · DENUNCIAR — sem "atacar".
 *
 * Privacidade: só o que já é PÚBLICO no mundo — apelido (NetPlayer.name), torcida pelo `displayName` dos DADOS
 * (public/gameplay/supporters.json, índice `NetPlayer.sup`) e, desde a rodada 11, nível (`NetPlayer.lvl`) e título
 * equipado (`NetPlayer.title`). Nunca e-mail, conta, IP, sessão, ids ou dado
 * administrativo: o painel não recebe nada disso. Silenciar = mute por identidade do chat (`chat_mute {nid}`, o
 * servidor resolve a conta); denunciar = `user_report {nid, category}` (o servidor valida, limita e guarda a
 * evidência; a resposta não traz ids).
 *
 * Rodada 12 — personagem AUTÔNOMO do mundo (NetPlayer.kind = 1; docs/AUTONOMOUS_CHARACTERS.md § Cliente): o painel
 * mostra apelido, título (quando houver) e torcida, e oferece VER PERFIL e INTERAGIR — sem SILENCIAR/DENUNCIAR (não
 * fazem sentido para um personagem do mundo; não há chat nem conta). Nunca rotula ninguém como "bot" nem afirma que
 * é humano: o texto é o mesmo de qualquer pessoa, só faltam as ações de moderação. Humano: igual à rodada 11.
 */
import { EscSlot } from './escStack'; // rodada 11 — entrada
import { REPORT_CATEGORIES, REPORT_LABELS, type ReportCategory } from '../chat/protocol';
import { ENTITY_KIND } from '../world/entityKind';

/** rodada 12 — personagem autônomo do mundo (sem moderação no painel) */
export const isAutonomous = (kind: number | undefined) => (kind ?? 0) === ENTITY_KIND.AUTONOMOUS;

export type PersonAction = 'profile' | 'interact' | 'mute' | 'report';
/** rodada 12 — ações do painel por tipo (puro): autônomo sem SILENCIAR/DENUNCIAR; humano/bot de carga como na rodada 11 */
export function personActions(kind: number | undefined): PersonAction[] {
  return isAutonomous(kind) ? ['profile', 'interact'] : ['profile', 'interact', 'mute', 'report'];
}
/** rodada 12 — linha de baixo do nome (puro): título · nível (só humano) · torcida — nunca "bot"/"NPC"/"humano" */
export function personSubtitle(p: { kind?: number; title?: string; lvl?: number }, supporter: string | null): string {
  return [p.title ?? '', !isAutonomous(p.kind) && p.lvl ? `Nível ${p.lvl}` : '', supporter ? `Torcida: ${supporter}` : 'Sem torcida escolhida'].filter(Boolean).join(' · ');
}
/** rodada 12 — linhas de VER PERFIL (puro) */
export function personProfileRows(p: { kind?: number; name: string; title?: string; lvl?: number }, supporter: string | null): [string, string][] {
  const rows: [string, string][] = [['Apelido', p.name], ['Título', p.title || 'Nenhum']];
  if (!isAutonomous(p.kind)) rows.push(['Nível', p.lvl ? String(p.lvl) : '—']); // rodada 11 (autônomo: sem progressão)
  rows.push(['Torcida', supporter ?? 'Nenhuma']);
  return rows;
}

export interface PersonPanelDeps {
  touch: boolean;
  /** dados públicos da pessoa (null = saiu do mundo / da área) */
  profile(id: string): { name: string; sup: number; lvl?: number; title?: string; kind?: number } | null;
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
  private target: { id: string; nid: number; name: string; sup: number; lvl: number; title: string; kind: number } | null = null;
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
    this.target = { id, nid, name: p.name, sup: p.sup, lvl: p.lvl ?? 0, title: p.title ?? '', kind: p.kind ?? 0 }; // rodada 11 — nível e título; rodada 12 — tipo
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
    // rodada 11 — título equipado e nível (públicos) antes da torcida; rodada 12 — autônomo: título e torcida
    const npc = isAutonomous(t.kind);
    this.subEl.textContent = personSubtitle(t, sup);
    const b = this.body;
    b.replaceChildren();
    if (this.view === 'main') {
      const g = document.createElement('div'); g.className = 'pp-grid';
      // rodada 12 — moderação só para pessoas com conta/chat (personagem do mundo: sem silenciar/denunciar)
      for (const a of personActions(t.kind)) {
        if (a === 'profile') g.append(this.btn('VER PERFIL', () => this.go('profile')));
        else if (a === 'interact') g.append(this.btn('INTERAGIR', () => this.go('interact')));
        else if (a === 'mute') { const muted = this.d.muted(t.name); g.append(this.btn(muted ? 'DESSILENCIAR' : 'SILENCIAR', () => { this.d.setMuted(t.nid, t.name, !muted); this.log.push(muted ? 'unmute' : 'mute'); this.close(); })); }
        else g.append(this.btn('DENUNCIAR', () => this.go('report'), 'warn'));
      }
      b.append(g);
    } else if (this.view === 'profile') {
      const row = (k: string, v: string) => { const r = document.createElement('div'); r.className = 'pp-row'; const a = document.createElement('span'); a.textContent = k; const c = document.createElement('span'); c.textContent = v; r.append(a, c); return r; };
      for (const [k, v] of personProfileRows(t, sup)) b.append(row(k, v));
      const n = document.createElement('div'); n.className = 'pp-note'; n.textContent = 'Só dados públicos. Conta, e-mail e localização real nunca aparecem.';
      b.append(n, this.back());
    } else if (this.view === 'interact') {
      const l = document.createElement('div'); l.className = 'pp-list';
      for (const gst of this.d.gestures) l.append(this.btn(gst.label, () => { this.d.gesture(t.id, gst.id); this.log.push(`gesture:${gst.id}`); this.close(); }));
      b.append(l, this.back());
    } else if (npc) {
      this.view = 'main'; this.render(); // rodada 12 — sem denúncia para personagem do mundo
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
  info() { return { open: this.open, view: this.view, name: this.target?.name ?? null, title: this.target?.title ?? null, lvl: this.target?.lvl ?? null, kind: this.target?.kind ?? null, selected: this.open ? this.target?.id ?? null : null, text: this.open ? this.el.innerText : '', log: this.log.slice(-20) }; }
  /** rodada 12 — pessoa selecionada (o rótulo dela ganha foco) */
  get selectedId(): string | null { return this.open ? this.target?.id ?? null : null; }
}
