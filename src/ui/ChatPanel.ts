/**
 * Painel de chat (rodada 8) — componente PRÓPRIO, discreto. Só DOM, atualizado por evento (mensagem chegou, tecla,
 * clique): nada por quadro. O servidor decide quem recebe (server/src/chat/ChatService.ts · docs/CHAT.md).
 *
 * Estados: 'min' (só a pílula "Chat"), 'idle' (últimas linhas, esmaecem; não captura nada) e 'open' (digitando: lista
 * rolável, menu por mensagem). Desktop: Enter abre/envia, Esc fecha, Tab troca o canal. Toque: botão CHAT (`button`)
 * abre uma folha inferior. Enquanto digita, as teclas NÃO chegam ao jogo (stopPropagation no campo + releaseAll()).
 *
 * Montagem (o layout do HUD é de quem monta): `mountChat(hud, net, { isTouch, input, onToggle })` — ou `new ChatPanel()`,
 * `attach(net)` e posicionar `panel.el` / `panel.button` à mão.
 */
import './chat.css';
import { CHAT_RULES, REPORT_CATEGORIES, REPORT_LABELS, type ChatChannel, type ChatMessage, type ChatRejection, type ReportCategory } from '../chat/protocol';
import { textModeration } from '../moderation/text';

export interface ChatTransport { send(type: string, payload?: unknown): void; on(type: string, fn: (msg: any) => void): void }
export interface ChatPanelOptions {
  isTouch?: boolean;
  /** solta as teclas seguradas ao começar a digitar (InputManager.releaseAll) */
  input?: { releaseAll(): void };
  /** abriu/fechou a digitação (o jogo solta/recupera o pointer lock) */
  onToggle?: (open: boolean) => void;
}

interface Hello { canWrite: boolean; why?: 'visitante' | 'suspenso' | 'sem_licenca'; group: string | null; canReport: boolean; radius: number; nick?: string; history: ChatMessage[] }
type State = 'min' | 'idle' | 'open';

const LABEL: Record<ChatChannel, string> = { geral: 'Geral', proximidade: 'Perto', grupo: 'Grupo' };
const DENY: Record<ChatRejection, string> = {
  sem_permissao: 'Você não pode escrever aqui', vazio: 'Mensagem vazia', longo: `Mensagem longa demais (máx. ${CHAT_RULES.maxChars})`,
  bloqueado: 'Mensagem bloqueada pela moderação', spam: 'Parece propaganda ou spam', flood: 'Devagar: muitas mensagens seguidas',
  repetida: 'Mensagem repetida', cooldown: 'Aguarde para escrever de novo', sem_grupo: 'Você ainda não tem grupo neste evento',
  caracteres: 'Caracteres não permitidos',
};
const WHY: Record<NonNullable<Hello['why']>, string> = {
  visitante: 'Crie uma conta para conversar', suspenso: 'Conta suspensa: você pode ler, mas não escrever', sem_licenca: 'Leitura apenas: participe do evento para conversar',
};
const REPORT_RES: Record<string, string> = {
  repetida: 'Você já denunciou esta mensagem', limite: 'Muitas denúncias seguidas; tente mais tarde', inexistente: 'Mensagem antiga demais para denunciar',
  propria: 'Não dá para denunciar a própria mensagem', sem_permissao: 'Crie uma conta para denunciar', erro: 'Falha ao registrar; tente de novo',
};
const MUTED_KEY = 'pv.chat.muted';
const STATE_KEY = 'pv.chat.state';
const MAX_LINES = 200;
const STALE_MS = 14_000;

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* sem storage */ } },
};
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const hue = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; };
const hhmm = (t: number) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export class ChatPanel {
  readonly el: HTMLElement;
  /** botão CHAT para toque (quem monta o HUD posiciona) */
  readonly button: HTMLButtonElement;
  private log: HTMLOListElement;
  private form: HTMLFormElement;
  private field: HTMLInputElement;
  private chLabel: HTMLSpanElement;
  private note: HTMLParagraphElement;
  private ro: HTMLParagraphElement;
  private tabs = new Map<ChatChannel, HTMLButtonElement>();
  private unread: Record<ChatChannel, number> = { geral: 0, proximidade: 0, grupo: 0 };
  private menu: HTMLDivElement;
  private pill: HTMLButtonElement;
  private net: ChatTransport | null = null;
  private hello: Hello | null = null;
  private ch: ChatChannel = 'geral';
  private state: State = 'idle';
  private muted = new Set<string>();
  private lines = new Map<string, { li: HTMLLIElement; m: ChatMessage }>();
  private noteTimer = 0;
  private cooldownUntil = 0;
  /** QA */
  readonly received: ChatMessage[] = [];
  readonly events: { type: string; msg: unknown }[] = [];

  constructor(private o: ChatPanelOptions = {}) {
    for (const n of JSON.parse(store.get(MUTED_KEY) ?? '[]') as unknown[]) if (typeof n === 'string') this.muted.add(this.key(n));
    this.el = el('section', 'chat');
    this.el.setAttribute('aria-label', 'Chat');
    if (o.isTouch) this.el.classList.add('touch');

    const head = el('header', 'chat-head');
    const tabs = el('div', 'chat-tabs');
    tabs.setAttribute('role', 'tablist');
    for (const c of ['geral', 'proximidade', 'grupo'] as ChatChannel[]) {
      const b = el('button', 'chat-tab', LABEL[c]);
      b.type = 'button';
      b.dataset.ch = c;
      b.setAttribute('role', 'tab');
      b.append(el('i', 'chat-unread'));
      b.addEventListener('click', (e) => { e.stopPropagation(); this.setChannel(c); if (this.state !== 'open') this.open(); else this.field.focus(); });
      this.tabs.set(c, b);
      tabs.append(b);
    }
    this.pill = el('button', 'chat-pill', 'Chat');
    this.pill.type = 'button';
    this.pill.title = 'Mostrar/ocultar o chat';
    this.pill.addEventListener('click', (e) => { e.stopPropagation(); this.setState(this.state === 'min' ? 'idle' : 'min'); });
    const close = el('button', 'chat-x', '×');
    close.type = 'button';
    close.title = 'Fechar (Esc)';
    close.addEventListener('click', (e) => { e.stopPropagation(); this.close(); });
    head.append(this.pill, tabs, close);

    this.log = el('ol', 'chat-log');
    this.log.setAttribute('aria-live', 'polite');
    this.log.addEventListener('click', (e) => this.onLogClick(e));

    this.form = el('form', 'chat-form');
    this.chLabel = el('span', 'chat-ch');
    this.field = el('input', 'chat-field');
    this.field.type = 'text';
    this.field.maxLength = CHAT_RULES.maxChars;
    this.field.autocomplete = 'off';
    this.field.enterKeyHint = 'send';
    this.field.placeholder = 'Mensagem…';
    this.field.setAttribute('aria-label', 'Mensagem');
    const send = el('button', 'chat-send', 'Enviar');
    send.type = 'submit';
    this.form.append(this.chLabel, this.field, send);
    this.form.addEventListener('submit', (e) => { e.preventDefault(); this.submit(); });
    // digitando: nenhuma tecla chega ao jogo (o InputManager escuta em window)
    this.field.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      else if (e.key === 'Tab') { e.preventDefault(); this.cycle(e.shiftKey ? -1 : 1); }
    });
    this.field.addEventListener('keyup', (e) => e.stopPropagation());

    this.ro = el('p', 'chat-ro hidden');
    this.note = el('p', 'chat-note');
    this.menu = el('div', 'chat-menu hidden');
    this.menu.addEventListener('click', (e) => this.onMenuClick(e));
    this.el.append(head, this.log, this.form, this.ro, this.note, this.menu);
    // cliques no painel aberto não vão para o canvas (pointer lock)
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());

    this.button = el('button', 'touch-btn chat-btn', 'CHAT');
    this.button.type = 'button';
    this.button.append(el('i', 'chat-unread'));
    this.button.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); this.toggle(); }, { passive: false });
    this.button.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });

    window.addEventListener('keydown', this.onGlobalKey);
    const saved = store.get(STATE_KEY);
    this.setState(o.isTouch ? 'min' : saved === 'min' ? 'min' : 'idle');
    this.setChannel('geral');
    this.applyHello();
  }

  /** liga à rede (NetworkClient.on/send) */
  attach(net: ChatTransport) {
    this.net = net;
    net.on('chat_hello', (h: Hello) => { this.events.push({ type: 'chat_hello', msg: h }); this.hello = h; this.applyHello(); for (const m of h.history ?? []) this.add(m, true); if (this.muted.size) net.send('chat_mute', { list: [...this.muted] }); });
    net.on('chat', (m: ChatMessage) => this.add(m));
    net.on('chat_denied', (d: { reason: ChatRejection; retryMs: number }) => {
      this.events.push({ type: 'chat_denied', msg: d });
      if (d.retryMs > 0) this.cooldownUntil = Date.now() + d.retryMs;
      this.flash(d.reason === 'cooldown' || d.retryMs > 1500 ? `${DENY[d.reason] ?? d.reason} (${Math.ceil(d.retryMs / 1000)} s)` : DENY[d.reason] ?? d.reason, true);
    });
    net.on('chat_report_res', (r: { ok: boolean; id: string; r?: string }) => {
      this.events.push({ type: 'chat_report_res', msg: r });
      this.flash(r.ok ? 'Denúncia registrada. Obrigado.' : REPORT_RES[r.r ?? ''] ?? 'Denúncia não registrada', !r.ok);
    });
  }

  /** acrescenta painel e (no toque) o botão CHAT ao HUD */
  mount(parent: HTMLElement, buttonParent: HTMLElement = parent) {
    parent.append(this.el);
    if (this.o.isTouch) buttonParent.append(this.button);
  }

  get typing() { return this.state === 'open'; }

  open(ch?: ChatChannel) {
    if (ch) this.setChannel(ch);
    this.setState('open');
  }
  close() { this.setState(this.o.isTouch ? 'min' : 'idle'); }
  toggle() { if (this.state === 'open') this.close(); else this.open(); }

  dispose() { window.removeEventListener('keydown', this.onGlobalKey); this.el.remove(); this.button.remove(); }

  // ------------------------------------------------------------------ estado
  private setState(s: State) {
    const was = this.state;
    this.state = s;
    this.el.dataset.state = s;
    this.hideMenu();
    if (s !== 'open' && document.activeElement === this.field) this.field.blur();
    if (s === 'open') {
      this.o.input?.releaseAll();
      this.zero(this.ch);
      for (const { li } of this.lines.values()) li.classList.remove('stale');
      this.log.scrollTop = this.log.scrollHeight;
      if (this.hello?.canWrite !== false) setTimeout(() => this.field.focus(), 0);
    }
    if (s !== 'open') store.set(STATE_KEY, s === 'min' ? 'min' : 'idle');
    this.button.classList.toggle('on', s === 'open');
    if ((was === 'open') !== (s === 'open')) this.o.onToggle?.(s === 'open');
  }

  private setChannel(c: ChatChannel) {
    if (this.tabs.get(c)?.disabled) return;
    this.ch = c;
    this.log.dataset.view = c;
    for (const [k, b] of this.tabs) { b.setAttribute('aria-selected', String(k === c)); b.classList.toggle('on', k === c); }
    this.chLabel.textContent = LABEL[c];
    this.chLabel.dataset.ch = c;
    this.field.placeholder = c === 'proximidade' ? `Quem está a até ${this.hello?.radius ?? CHAT_RULES.proximityRadius} m` : c === 'grupo' ? `Seu grupo${this.hello?.group ? ` (${this.hello.group})` : ''}` : 'Todos no evento';
    this.zero(c);
    this.log.scrollTop = this.log.scrollHeight;
  }

  private cycle(d: number) {
    const all = (['geral', 'proximidade', 'grupo'] as ChatChannel[]).filter((c) => !this.tabs.get(c)!.disabled);
    this.setChannel(all[(all.indexOf(this.ch) + d + all.length) % all.length]);
  }

  private applyHello() {
    const h = this.hello;
    const write = !!h?.canWrite;
    this.form.classList.toggle('hidden', !write);
    this.ro.classList.toggle('hidden', write || !h);
    this.ro.textContent = h?.why ? WHY[h.why] : '';
    // quem só lê recebe apenas o GERAL (e o grupo, se tiver)
    this.tabs.get('proximidade')!.disabled = !write;
    this.tabs.get('grupo')!.disabled = !h?.group;
    this.tabs.get('grupo')!.title = h?.group ? `Grupo ${h.group}` : 'Escolha um grupo do evento para usar este canal';
    if (this.tabs.get(this.ch)!.disabled) this.setChannel('geral');
    this.el.classList.toggle('readonly', !!h && !write);
  }

  private onGlobalKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'Enter' && this.state !== 'open') { e.preventDefault(); this.open(); }
    else if (e.key === 'Escape' && this.state === 'open') this.close();
  };

  // ------------------------------------------------------------------ mensagens
  private key(nick: string) { return textModeration.nicknameKey(nick) || nick.toLowerCase(); }
  private mine(m: ChatMessage) { return !!this.hello?.nick && m.nick === this.hello.nick; }

  private add(m: ChatMessage, history = false) {
    if (!m || typeof m.id !== 'string' || this.lines.has(`${m.ch}:${m.id}`)) return;
    this.received.push(m);
    if (this.received.length > MAX_LINES) this.received.shift();
    if (this.muted.has(this.key(m.nick))) return;
    const li = el('li', 'chat-line');
    li.dataset.ch = m.ch;
    li.dataset.id = m.id;
    if (this.mine(m)) li.classList.add('mine');
    const time = el('time', 'chat-t', hhmm(m.t));
    const tag = el('span', 'chat-tag', m.ch === 'geral' ? 'G' : m.ch === 'proximidade' ? 'P' : 'Gr');
    tag.title = LABEL[m.ch];
    const nick = el('b', 'chat-nick', m.nick);
    nick.style.color = `hsl(${hue(m.nick)} 70% 72%)`;
    const text = el('span', 'chat-text', m.text);
    const more = el('button', 'chat-more', '⋯');
    more.type = 'button';
    more.title = 'Opções da mensagem';
    li.append(time, tag, nick, text);
    if (!this.mine(m)) li.append(more);
    const stick = this.log.scrollTop + this.log.clientHeight >= this.log.scrollHeight - 24;
    this.log.append(li);
    this.lines.set(`${m.ch}:${m.id}`, { li, m });
    while (this.lines.size > MAX_LINES) { const [k, v] = this.lines.entries().next().value!; v.li.remove(); this.lines.delete(k); }
    if (stick || this.state !== 'open') this.log.scrollTop = this.log.scrollHeight;
    if (history) li.classList.add('stale');
    else {
      setTimeout(() => { if (this.state !== 'open') li.classList.add('stale'); }, STALE_MS);
      if (m.ch !== this.ch || this.state === 'min' || (this.o.isTouch && this.state !== 'open')) this.bump(m.ch);
    }
  }

  private bump(c: ChatChannel) {
    this.unread[c]++;
    this.paintUnread();
  }
  private zero(c: ChatChannel) { this.unread[c] = 0; this.paintUnread(); }
  private paintUnread() {
    for (const [c, b] of this.tabs) { const i = b.querySelector('i')!; i.textContent = this.unread[c] ? String(Math.min(99, this.unread[c])) : ''; }
    const total = this.unread.geral + this.unread.proximidade + this.unread.grupo;
    this.pill.dataset.n = total ? String(Math.min(99, total)) : '';
    this.button.querySelector('i')!.textContent = total ? String(Math.min(99, total)) : '';
  }

  private submit() {
    const raw = this.field.value;
    if (!this.net || !this.hello?.canWrite) return;
    const text = textModeration.sanitize(raw, 'chat');
    if (!text) { this.close(); return; }
    if (Date.now() < this.cooldownUntil) { this.flash(`Aguarde ${Math.ceil((this.cooldownUntil - Date.now()) / 1000)} s`, true); return; }
    // aviso antecipado (o servidor decide de novo)
    const v = textModeration.check(raw, 'chat');
    if (!v.ok && (v.reason === 'bloqueado' || v.reason === 'spam' || v.reason === 'longo')) { this.flash(DENY[v.reason as ChatRejection], true); return; }
    this.net.send('chat_send', { ch: this.ch, text });
    this.field.value = '';
    if (this.o.isTouch) return; // folha continua aberta
    this.close();
  }

  private flash(msg: string, err = false) {
    this.note.textContent = msg;
    this.note.classList.toggle('err', err);
    this.note.classList.add('show');
    clearTimeout(this.noteTimer);
    this.noteTimer = window.setTimeout(() => this.note.classList.remove('show'), 3500);
  }

  // ------------------------------------------------------------------ menu por mensagem
  private menuFor: { m: ChatMessage; li: HTMLLIElement } | null = null;

  private onLogClick(e: MouseEvent) {
    const b = (e.target as HTMLElement).closest('.chat-more');
    if (!b) return;
    e.stopPropagation();
    const li = b.closest('li') as HTMLLIElement;
    const it = this.lines.get(`${li.dataset.ch}:${li.dataset.id}`);
    if (it) this.showMenu(it.m, li);
  }

  private showMenu(m: ChatMessage, li: HTMLLIElement, reporting = false) {
    this.menuFor = { m, li };
    const items: HTMLElement[] = [el('div', 'chat-menu-h', reporting ? `Denunciar ${m.nick}` : m.nick)];
    const opt = (label: string, act: string, extra = '') => { const b = el('button', `chat-menu-i ${extra}`, label); b.type = 'button'; b.dataset.act = act; return b; };
    if (!reporting) {
      items.push(opt(`Mutar ${m.nick}`, 'mute'), opt('Ocultar mensagem', 'hide'));
      if (this.hello?.canReport) items.push(opt('Denunciar…', 'report', 'warn'));
    } else {
      for (const c of REPORT_CATEGORIES) items.push(opt(REPORT_LABELS[c], `cat:${c}`));
    }
    items.push(opt('Cancelar', 'cancel', 'quiet'));
    this.menu.replaceChildren(...items);
    this.menu.classList.remove('hidden');
    const top = Math.max(0, Math.min(li.offsetTop - this.log.scrollTop + this.log.offsetTop, this.el.clientHeight - this.menu.offsetHeight - 8));
    this.menu.style.top = `${top}px`;
  }

  private hideMenu() { this.menu.classList.add('hidden'); this.menuFor = null; }

  private onMenuClick(e: MouseEvent) {
    e.stopPropagation();
    const act = ((e.target as HTMLElement).closest('button') as HTMLButtonElement | null)?.dataset.act;
    const f = this.menuFor;
    if (!act || !f) return;
    if (act === 'cancel') return this.hideMenu();
    if (act === 'hide') { f.li.remove(); this.lines.delete(`${f.m.ch}:${f.m.id}`); this.hideMenu(); return this.flash('Mensagem oculta para você'); }
    if (act === 'mute') { this.hideMenu(); return this.mute(f.m.nick, true); }
    if (act === 'report') return this.showMenu(f.m, f.li, true);
    if (act.startsWith('cat:')) { this.hideMenu(); this.report(f.m.id, act.slice(4) as ReportCategory); }
  }

  // ------------------------------------------------------------------ moderação pessoal
  /** mutar/desmutar por apelido: some na hora daqui e o servidor deixa de enviar */
  mute(nick: string, on: boolean) {
    const k = this.key(nick);
    if (on) this.muted.add(k); else this.muted.delete(k);
    store.set(MUTED_KEY, JSON.stringify([...this.muted]));
    this.net?.send('chat_mute', { nick, on });
    if (on) for (const [id, { li, m }] of this.lines) if (this.key(m.nick) === k) { li.remove(); this.lines.delete(id); }
    this.flash(on ? `${nick} mutado (só para você)` : `${nick} desmutado`);
  }

  report(id: string, category: ReportCategory, details?: string) {
    this.net?.send('chat_report', { id, category, ...(details ? { details } : {}) });
  }

  /** QA/automação */
  get qa() {
    return {
      state: () => this.state, channel: () => this.ch, hello: () => this.hello,
      received: () => this.received.map((m) => ({ ...m })),
      visible: () => [...this.lines.values()].map(({ m }) => ({ id: m.id, ch: m.ch, nick: m.nick, text: m.text })),
      events: () => this.events.slice(), open: (ch?: ChatChannel) => this.open(ch), close: () => this.close(),
      type: (text: string, ch?: ChatChannel) => { this.open(ch); this.field.value = text; this.submit(); },
      send: (text: string, ch: ChatChannel) => this.net?.send('chat_send', { ch, text }),
      mute: (nick: string, on = true) => this.mute(nick, on), report: (id: string, c: ReportCategory) => this.report(id, c),
      menu: (id: string) => { const it = [...this.lines.values()].find((x) => x.m.id === id); if (it) this.showMenu(it.m, it.li); },
      reportMenu: (id: string) => { const it = [...this.lines.values()].find((x) => x.m.id === id); if (it) this.showMenu(it.m, it.li, true); },
      muted: () => [...this.muted],
    };
  }
}

/** monta o painel no HUD e liga à rede — gancho único para o jogo / HUD */
export function mountChat(hud: HTMLElement, net: ChatTransport, o: ChatPanelOptions = {}): ChatPanel {
  const p = new ChatPanel(o);
  p.attach(net);
  p.mount(hud);
  return p;
}
