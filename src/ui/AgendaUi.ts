/**
 * Agenda no CLIENTE (rodada 9): fonte `agenda` do servidor (src/events/schedule.ts), "Acontecendo agora" (HUD, até 3
 * itens, discreto, esmaece com o HUD) e a tela AGENDA DA AVENIDA (menu ☰: agora / a seguir / encerrados, entrar/sair
 * com `evt_join`/`evt_leave`). O cliente só EXIBE: estado, horário e contagem vêm do servidor.
 *
 * Custo: nada por quadro. Os relógios ("começa em 03:42") andam por um intervalo de 1 s que só existe enquanto há
 * algo para mostrar; cada linha escreve no DOM só quando o texto muda (TextSlot). Formatação: src/events/agendaFormat.ts.
 */
import './agenda.css';
import type { AgendaEntry, AgendaMessage } from '../events/schedule';
import { JOIN_DENIAL_TEXT, STATE_LABEL, agendaSections, entryLine, joinAction, pickNow } from '../events/agendaFormat';
import { TextSlot } from './hud/throttle';

export interface AgendaTransport { send(type: string, payload?: unknown): void; on(type: string, fn: (msg: any) => void): void }

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** lista atual + ouvintes; `apply` aceita a mensagem do servidor (ou de um alimentador local de QA) */
export class AgendaFeed {
  list: AgendaEntry[] = [];
  version = 0;
  private ls = new Set<() => void>();
  private net: AgendaTransport | null = null;
  /** resposta de evt_join/evt_leave (o jogo mostra o aviso) */
  onResult?: (r: { inst: string; ok: boolean; r?: string }) => void;

  constructor(public now: () => number = () => Date.now()) {}

  attach(net: AgendaTransport) {
    this.net = net;
    net.on('agenda', (m: AgendaMessage) => this.apply(m));
    net.on('evt_res', (r: { inst: string; ok: boolean; r?: string }) => this.onResult?.(r));
  }

  apply(m: AgendaMessage | null | undefined) {
    if (!m || !Array.isArray(m.list)) return;
    this.list = m.list.slice(0, 64);
    this.version++;
    for (const fn of this.ls) fn();
  }

  onChange(fn: () => void) { this.ls.add(fn); return () => this.ls.delete(fn); }
  join(inst: string, on: boolean) { this.net?.send(on ? 'evt_join' : 'evt_leave', { inst }); }
  get online() { return !!this.net; }
}

/** texto da recusa de evt_join */
export const joinDeniedText = (r?: string) => (r && JOIN_DENIAL_TEXT[r]) || 'Não foi possível entrar agora';

/** uma linha (título · estado) com escrita só na mudança */
class Row {
  readonly el: HTMLButtonElement;
  private t: TextSlot; private s: TextSlot; private z: TextSlot;
  entry: AgendaEntry | null = null;
  constructor(cls: string, onPick: (e: AgendaEntry) => void) {
    this.el = el('button', cls);
    this.el.type = 'button';
    const t = el('span', 'ag-title'), s = el('span', 'ag-status'), z = el('span', 'ag-zone');
    this.el.append(t, s, z);
    this.t = new TextSlot(t); this.s = new TextSlot(s); this.z = new TextSlot(z);
    this.el.addEventListener('click', (ev) => { ev.stopPropagation(); if (this.entry) onPick(this.entry); });
  }
  set(e: AgendaEntry, now: number, zoneName?: (id: string) => string | undefined) {
    this.entry = e;
    const l = entryLine(e, now, zoneName);
    this.t.set(l.title); this.s.set(l.status); this.z.set(l.zone);
    this.el.dataset.state = e.state;
    this.el.classList.toggle('joined', !!e.joined);
  }
}

/** "ACONTECENDO AGORA" — até 3 itens; clique → direção (zona no minimapa) / abrir o debate */
export class NowHappening {
  readonly el: HTMLElement;
  private rows: Row[] = [];
  private head: HTMLElement;
  private timer = 0;
  /** QA: renderizações (≤ 1/s + mudanças da agenda) */
  renders = 0;

  constructor(private feed: AgendaFeed, private onPick: (e: AgendaEntry) => void, private zoneName?: (id: string) => string | undefined) {
    this.el = el('div', 'now-happening');
    this.el.setAttribute('aria-label', 'Acontecendo agora');
    this.head = el('div', 'nh-head', 'Acontecendo agora');
    this.el.appendChild(this.head);
    for (let i = 0; i < 3; i++) { const r = new Row('nh-row', (e) => this.onPick(e)); r.el.hidden = true; this.rows.push(r); this.el.appendChild(r.el); }
    this.el.hidden = true;
    feed.onChange(() => this.render());
  }

  render() {
    this.renders++;
    const now = this.feed.now();
    const pick = pickNow(this.feed.list, now, 3);
    this.rows.forEach((r, i) => { const e = pick[i]; r.el.hidden = !e; if (e) r.set(e, now, this.zoneName); });
    this.el.hidden = !pick.length;
    // relógio só enquanto há algo na tela
    if (pick.length && !this.timer) this.timer = window.setInterval(() => this.render(), 1000);
    else if (!pick.length && this.timer) { clearInterval(this.timer); this.timer = 0; }
  }
}

/** tela AGENDA DA AVENIDA (menu ☰) */
export class AgendaPanel {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private timer = 0;
  private sections: { key: 'now' | 'next' | 'recent'; label: string; list: HTMLElement; empty: HTMLElement; rows: { row: Row; btn: HTMLButtonElement; li: HTMLElement }[] }[] = [];
  onToggle?: (open: boolean) => void;

  constructor(private feed: AgendaFeed, private onPick: (e: AgendaEntry) => void, private zoneName?: (id: string) => string | undefined) {
    this.el = el('section', 'agenda-panel');
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Agenda da avenida');
    this.el.hidden = true;
    const head = el('header', 'ap-head');
    head.append(el('h2', '', 'Agenda da avenida'));
    const x = el('button', 'ap-x', '×');
    x.type = 'button'; x.setAttribute('aria-label', 'Fechar');
    x.addEventListener('click', () => this.toggle(false));
    head.appendChild(x);
    this.body = el('div', 'ap-body');
    this.el.append(head, this.body);
    for (const [key, label] of [['now', 'Agora'], ['next', 'A seguir'], ['recent', 'Encerrados há pouco']] as const) {
      const sec = el('div', 'ap-sec');
      sec.append(el('h3', '', label));
      const list = el('ul', 'ap-list'), empty = el('p', 'ap-empty', key === 'now' ? 'Nada acontecendo agora' : key === 'next' ? 'Nada agendado' : '—');
      sec.append(list, empty);
      this.body.appendChild(sec);
      this.sections.push({ key, label, list, empty, rows: [] });
    }
    const foot = el('p', 'ap-foot', 'Horários e inscrições decididos pelo servidor. Toque num item para ver no mapa.');
    this.body.appendChild(foot);
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') this.toggle(false); });
    feed.onChange(() => { if (!this.el.hidden) this.render(); });
  }

  get open() { return !this.el.hidden; }

  toggle(v = this.el.hidden) {
    if (v === !this.el.hidden) return;
    this.el.hidden = !v;
    if (v) { this.render(); this.timer = window.setInterval(() => this.render(), 1000); this.el.querySelector<HTMLElement>('.ap-x')?.focus({ preventScroll: true }); }
    else { clearInterval(this.timer); this.timer = 0; }
    this.onToggle?.(v);
  }

  render() {
    const now = this.feed.now();
    const s = agendaSections(this.feed.list, now);
    for (const sec of this.sections) {
      const items = s[sec.key];
      while (sec.rows.length < items.length) {
        const li = el('li', 'ap-item');
        const row = new Row('ap-row', (e) => this.onPick(e));
        const btn = el('button', 'ap-join');
        btn.type = 'button';
        btn.addEventListener('click', (ev) => { ev.stopPropagation(); const e = row.entry; const a = e && joinAction(e); if (e && a) { btn.disabled = true; this.feed.join(e.inst, a === 'join'); } });
        li.append(row.el, btn);
        sec.list.appendChild(li);
        sec.rows.push({ row, btn, li });
      }
      sec.rows.forEach((r, i) => {
        const e = items[i];
        r.li.hidden = !e;
        if (!e) return;
        r.row.set(e, now, this.zoneName);
        const a = joinAction(e);
        const label = a === 'join' ? 'Participar' : a === 'leave' ? 'Sair' : STATE_LABEL[e.state];
        if (r.btn.textContent !== label) r.btn.textContent = label;
        r.btn.hidden = !a && sec.key !== 'next';
        r.btn.classList.toggle('leave', a === 'leave');
        const dis = !a || !this.feed.online;
        if (r.btn.disabled !== dis) r.btn.disabled = dis;
      });
      sec.empty.hidden = items.length > 0;
    }
  }
}
