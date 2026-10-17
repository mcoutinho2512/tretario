/**
 * Painel do PALCO DE DEBATE (rodada 9) — componente próprio, montado pelo HUD (`mountOverlay`). Abre sozinho quando o
 * servidor coloca a conexão na plateia (perto do palco) ou pela agenda (`dbt_watch`); fecha quando sai.
 * Mostra tema, quem fala, contagem regressiva do turno, lugares/fila, a própria posição, campo de texto SÓ no seu
 * turno, botões de reação e as "reações da plateia" (contagem do turno — nunca como resultado).
 *
 * Custo: nada por quadro — DOM só quando chega mensagem; a contagem regressiva anda por um intervalo de 1 s que só
 * existe com o painel aberto e alguém falando. Celular: folha no alto (não cobre joystick/botões), alvos de 44 px.
 */
import './agenda.css';
import { DEBATE_DENIAL_TEXT, DEBATE_REACTIONS, REACTION_LABEL, clock, reactionSummary, type DebateDenial, type DebateLine, type DebateMe, type DebateStateWire } from '../events/debate';
import type { DebateReaction } from '../events/schedule';
import { REPORT_LABELS, type ReportCategory } from '../chat/protocol';
import { TextSlot } from './hud/throttle';

export interface DebateTransport { send(type: string, payload?: unknown): void; on(type: string, fn: (msg: any) => void): void }

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const REPORT_QUICK: ReportCategory[] = ['SPAM', 'ASSEDIO', 'ODIO', 'OUTRO'];
const REPORT_RES: Record<string, string> = {
  repetida: 'Você já denunciou esta fala', limite: 'Muitas denúncias seguidas; tente mais tarde', inexistente: 'Fala antiga demais para denunciar',
  propria: 'Não dá para denunciar a própria fala', sem_permissao: 'Crie uma conta para denunciar', erro: 'Falha ao registrar; tente de novo',
};
const WHY: Record<string, string> = { espectador: 'Assistindo: entre no mundo como jogador para falar', suspenso: 'Conta suspensa: você pode assistir', sem_licenca: 'Assistindo: participe do evento para falar' };

export class DebatePanel {
  readonly el: HTMLElement;
  st: DebateStateWire | null = null;
  me: DebateMe | null = null;
  /** o servidor mandou o estado (o jogo marca os lugares/orador e faz a plateia NPC reagir) */
  onState?: (st: DebateStateWire, prev: DebateStateWire | null) => void;
  onToggle?: (open: boolean) => void;
  /** aviso curto do jogo */
  onNotice?: (m: string) => void;
  /** QA */
  stats = { states: 0, lines: 0, writes: 0 };

  private net: DebateTransport | null = null;
  private topic: TextSlot; private speaker: TextSlot; private timer: TextSlot; private queue: TextSlot; private reacts: TextSlot; private note: TextSlot;
  private seats: HTMLElement;
  private log: HTMLOListElement;
  private form: HTMLFormElement;
  private field: HTMLInputElement;
  private qBtn: HTMLButtonElement;
  private rBtns = new Map<DebateReaction, HTMLButtonElement>();
  private menu: HTMLDivElement;
  private tick = 0;
  private watching = false;
  private collapsed = false;

  constructor(private opts: { isTouch?: boolean; input?: { releaseAll(): void }; now?: () => number } = {}) {
    const root = (this.el = el('section', 'debate-panel'));
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Palco de debate');
    root.classList.toggle('touch', !!opts.isTouch);
    root.hidden = true;
    const head = el('header', 'dp-head');
    const kick = el('span', 'dp-kick', 'Palco de debate');
    const min = el('button', 'dp-min', '–'); min.type = 'button'; min.setAttribute('aria-label', 'Recolher');
    const x = el('button', 'dp-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Fechar');
    head.append(kick, min, x);
    const topic = el('div', 'dp-topic');
    const spk = el('div', 'dp-speaker');
    const name = el('span', 'dp-name'), time = el('span', 'dp-time');
    spk.append(name, time);
    this.seats = el('div', 'dp-seats');
    const q = el('div', 'dp-queue');
    const reacts = el('div', 'dp-reacts');
    this.log = el('ol', 'dp-log');
    this.form = el('form', 'dp-form');
    this.field = el('input', 'dp-field');
    this.field.maxLength = 200; this.field.placeholder = 'Sua fala (o seu turno)'; this.field.autocomplete = 'off'; this.field.enterKeyHint = 'send';
    const send = el('button', 'dp-send', 'Falar'); send.type = 'submit';
    this.form.append(this.field, send);
    this.form.hidden = true;
    const bar = el('div', 'dp-bar');
    this.qBtn = el('button', 'dp-q', 'Entrar na fila'); this.qBtn.type = 'button';
    bar.appendChild(this.qBtn);
    for (const r of DEBATE_REACTIONS) {
      const b = el('button', `dp-react dp-${r}`, REACTION_LABEL[r].button); b.type = 'button';
      b.addEventListener('click', (e) => { e.stopPropagation(); this.react(r); });
      this.rBtns.set(r, b); bar.appendChild(b);
    }
    const note = el('p', 'dp-note');
    this.menu = el('div', 'dp-menu'); this.menu.hidden = true;
    root.append(head, topic, spk, this.seats, q, reacts, this.log, this.form, bar, note, this.menu);
    this.topic = new TextSlot(topic); this.speaker = new TextSlot(name); this.timer = new TextSlot(time); this.queue = new TextSlot(q); this.reacts = new TextSlot(reacts); this.note = new TextSlot(note);

    x.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(false); });
    min.addEventListener('click', (e) => { e.stopPropagation(); this.collapsed = !this.collapsed; root.classList.toggle('collapsed', this.collapsed); });
    this.qBtn.addEventListener('click', (e) => { e.stopPropagation(); this.queueToggle(); });
    this.form.addEventListener('submit', (e) => { e.preventDefault(); this.say(); });
    // digitando: teclas não chegam ao jogo
    this.field.addEventListener('focus', () => this.opts.input?.releaseAll());
    for (const t of ['keydown', 'keyup'] as const) this.field.addEventListener(t, (e) => e.stopPropagation());
    root.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (!this.menu.contains(e.target as Node)) this.menu.hidden = true; });
  }

  get open() { return !this.el.hidden; }
  private get now() { return (this.opts.now ?? Date.now)(); }

  attach(net: DebateTransport) {
    this.net = net;
    net.on('dbt', (s: DebateStateWire) => this.onDbt(s));
    net.on('dbt_me', (m: DebateMe) => { this.me = m; this.renderMe(); });
    net.on('dbt_line', (l: DebateLine) => this.addLine(l));
    net.on('dbt_hide', (h: { ids?: string[] }) => { for (const id of h?.ids ?? []) this.log.querySelector(`[data-id="${CSS.escape(id)}"]`)?.remove(); });
    net.on('dbt_bye', () => { if (!this.watching) this.toggle(false); this.st = null; });
    net.on('dbt_denied', (d: { kind: string; reason: DebateDenial; retryMs?: number }) => this.sayNote(DEBATE_DENIAL_TEXT[d.reason] ?? `Não foi possível (${d.reason})`));
    net.on('dbt_report_res', (r: { ok: boolean; r?: string }) => this.sayNote(r.ok ? 'Denúncia registrada. Obrigado.' : REPORT_RES[r.r ?? ''] ?? 'Falha na denúncia'));
    // silenciar pela fala usa o mute do chat (por identidade): a resposta é a lista de mutes
    net.on('chat_mute_denied', () => { /* o chat mostra o motivo */ });
  }

  /** abrir pela agenda (de longe): o servidor passa a mandar o estado */
  watch(on = true) {
    this.watching = on;
    this.net?.send('dbt_watch', { on });
    if (on) this.toggle(true);
  }

  toggle(v = this.el.hidden) {
    if (v === !this.el.hidden) return;
    this.el.hidden = !v;
    if (!v && this.watching) { this.watching = false; this.net?.send('dbt_watch', { on: false }); }
    this.syncTimer();
    this.onToggle?.(v);
  }

  private onDbt(s: DebateStateWire) {
    const prev = this.st;
    this.st = s;
    this.stats.states++;
    if (!prev && !this.open) this.toggle(true); // entrou na plateia: abre (o jogador fecha no ×)
    this.render();
    this.onState?.(s, prev);
  }

  private set(slot: TextSlot, t: string) { if (slot.set(t)) this.stats.writes++; }

  private render() {
    const s = this.st;
    if (!s) return;
    this.set(this.topic, s.active ? s.topic : `Próximo debate: ${clock(s.nextAt - this.now)}`);
    this.set(this.speaker, s.speaker ? `Falando: ${s.speaker}` : s.active ? (s.queue.length ? 'Próximo orador subindo…' : 'Palco livre — entre na fila') : 'Sem debate agora');
    this.set(this.reacts, s.speaker ? reactionSummary(s.reactions) : '');
    // lugares: chips (lugar 0 = quem fala)
    const key = s.seats.join('\u0000');
    if (this.seats.dataset.k !== key) {
      this.seats.dataset.k = key;
      this.seats.replaceChildren(...s.seats.map((n, i) => { const c = el('span', `dp-seat${i === 0 ? ' on' : ''}${n ? '' : ' free'}`, n ?? 'livre'); c.title = i === 0 ? 'Falando' : `Lugar ${i + 1}`; return c; }));
      this.stats.writes++;
    }
    this.renderMe();
    this.syncTimer();
  }

  private renderMe() {
    const s = this.st, m = this.me;
    const pos = m?.pos ?? 0, speaking = !!m?.speaking;
    this.set(this.queue, !s?.active ? '' : speaking ? 'É a sua vez: escreva a sua fala' : pos ? `Você está na fila: ${pos}º · ${s.queue.length} na fila` : `${s.queue.length} na fila`);
    const label = speaking ? 'Passar a vez' : pos ? 'Sair da fila' : 'Entrar na fila';
    if (this.qBtn.textContent !== label) this.qBtn.textContent = label;
    this.qBtn.hidden = !!m && !m.canSpeak;
    this.qBtn.disabled = !s?.active;
    if (this.form.hidden === speaking) { this.form.hidden = !speaking; if (speaking && !this.opts.isTouch) this.field.focus({ preventScroll: true }); }
    const canR = !!s?.speaker && (m ? m.canReact : true);
    for (const b of this.rBtns.values()) if (b.disabled === canR) b.disabled = !canR;
    if (m && !m.canSpeak && m.why) this.set(this.note, WHY[m.why] ?? '');
  }

  /** contagem regressiva: 1 s, só aberto e com orador */
  private syncTimer() {
    const need = this.open && !!this.st?.speaker;
    if (need && !this.tick) this.tick = window.setInterval(() => this.updateClock(), 1000);
    else if (!need && this.tick) { clearInterval(this.tick); this.tick = 0; }
    this.updateClock();
  }
  private updateClock() {
    const s = this.st;
    this.set(this.timer, s?.speaker ? clock(s.turnEndsAt - this.now) : '');
    if (s && !s.active) this.set(this.topic, `Próximo debate: ${clock(s.nextAt - this.now)}`);
  }

  private addLine(l: DebateLine) {
    this.stats.lines++;
    const li = el('li', 'dp-line');
    li.dataset.id = l.id;
    const n = el('b', 'dp-nick', l.nick), t = el('span', 'dp-text', l.text);
    const more = el('button', 'dp-more', '⋯'); more.type = 'button'; more.setAttribute('aria-label', 'Denunciar ou silenciar');
    more.addEventListener('click', (e) => { e.stopPropagation(); this.lineMenu(l, more); });
    li.append(n, t, more);
    this.log.appendChild(li);
    while (this.log.children.length > 8) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }

  private lineMenu(l: DebateLine, anchor: HTMLElement) {
    const m = this.menu;
    m.replaceChildren(el('p', 'dp-menu-h', `Fala de ${l.nick}`));
    for (const c of REPORT_QUICK) {
      const b = el('button', '', `Denunciar: ${REPORT_LABELS[c]}`); b.type = 'button';
      b.addEventListener('click', (e) => { e.stopPropagation(); this.net?.send('dbt_report', { inst: l.inst, id: l.id, category: c }); m.hidden = true; });
      m.appendChild(b);
    }
    if (l.nid) {
      const b = el('button', 'warn', `Silenciar ${l.nick}`); b.type = 'button';
      b.addEventListener('click', (e) => { e.stopPropagation(); this.net?.send('chat_mute', { nid: l.nid, on: true }); this.sayNote(`${l.nick} silenciado (chat e debate)`); m.hidden = true; });
      m.appendChild(b);
    }
    m.hidden = false;
    m.style.top = `${anchor.offsetTop + anchor.offsetHeight}px`;
  }

  private queueToggle() {
    const s = this.st, m = this.me;
    if (!s?.active) return;
    this.net?.send('dbt_queue', { inst: s.inst, on: !(m?.pos || m?.speaking) });
  }

  private say() {
    const t = this.field.value.trim();
    if (!t || !this.st) return;
    this.net?.send('dbt_say', { inst: this.st.inst, text: t });
    this.field.value = '';
  }

  private react(r: DebateReaction) {
    if (!this.st?.speaker) return;
    this.net?.send('dbt_react', { inst: this.st.inst, r });
  }

  private sayNote(m: string) { this.set(this.note, m); this.onNotice?.(m); }

  info() { return { open: this.open, watching: this.watching, state: this.st, me: this.me, shown: [...this.log.querySelectorAll('.dp-text')].map((e) => e.textContent), ...this.stats }; }
}
