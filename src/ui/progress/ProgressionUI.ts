/**
 * Missões e progressão no cliente (rodada 9) — SÓ exibe o que o servidor manda (`prog` completo, `prog_ev` notícias);
 * nunca calcula nem informa progresso. Pede apenas preferências de UI: `mission_track {id}` e `prog_seen {k}`.
 *
 *  rastreador   missão em destaque (escolhida ou a primeira ativa) + objetivos, no encaixe do HUD (HudShell.mountTracker);
 *               recolhe para uma linha depois de alguns segundos sem mudança; DOM só quando chega `prog`
 *  avisos       objetivo/missão/conquista/nível/recompensa → HudShell.notice (fila, um por vez)
 *  PROGRESSO    item do menu ☰: nível, barra de XP, missões (ativas/concluídas), conquistas, recompensas (liberadas,
 *               bloqueadas com requisito, "em breve")
 *  boas-vindas  1ª entrada: "BEM-VINDO À PRESIDENTE VARGAS — Explore a avenida" com UM objetivo; as outras missões
 *               aparecem aos poucos (requisitos no servidor). "Visto": conta no servidor; visitante também no aparelho
 */
import './progress.css';
import type { HudShell } from '../hud/HudShell';
import type { PlayerProgression, ProgressionMessage, ProgressionNotice } from '../../progression/types';
import { levelBounds, objectiveTarget, parseCatalog, requirementOf, type ProgressionCatalog } from '../../progression/engine';
import { setLocalEntitlements } from '../../characters/unlocks';

export interface ProgressNet {
  on(type: string, fn: (m: any) => void): void;
  send(type: string, payload?: unknown): void;
}

const CATEGORY: Record<string, string> = { exploracao: 'Exploração', social: 'Social', mobilidade: 'Mobilidade', confronto: 'Confronto (opcional)', evento: 'Eventos' };
const SEEN_KEY = 'pv3d.seen';
const local = {
  get(): string[] { try { return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]'); } catch { return []; } },
  add(k: string) { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...this.get(), k])])); } catch { /* sem storage */ } },
};

export async function loadProgressionCatalog(base = '/'): Promise<ProgressionCatalog> {
  const get = (f: string) => fetch(`${base}gameplay/${f}`).then((r) => (r.ok ? r.json() : undefined)).catch(() => undefined);
  const [missions, achievements, levels, rewards] = await Promise.all([get('missions.json'), get('achievements.json'), get('levels.json'), get('rewards.json')]);
  return parseCatalog({ missions, achievements, levels, rewards });
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export class ProgressionUI {
  p: PlayerProgression | null = null;
  persistent = false;
  cat: ProgressionCatalog | null = null;
  private tracker = el('div', 'prog-tracker hud-fadeable');
  private screen: HTMLDivElement | null = null;
  private welcome: HTMLDivElement | null = null;
  private collapseTimer = 0;
  private knownActive = new Set<string>();
  private first = true;
  /** QA: mensagens recebidas */
  readonly stats = { prog: 0, notices: 0, renders: 0 };

  constructor(private shell: HudShell, private net: ProgressNet, base = '/') {
    this.tracker.hidden = true;
    this.tracker.addEventListener('click', () => this.open());
    this.tracker.title = 'Abrir PROGRESSO';
    shell.mountTracker({ el: this.tracker });
    shell.addMenuItem('Progresso', () => this.open());
    net.on('prog', (m: ProgressionMessage) => this.onProg(m));
    net.on('prog_ev', (n: ProgressionNotice) => this.onNotice(n));
    void loadProgressionCatalog(base).then((c) => { this.cat = c; if (this.p) this.render(); });
    window.addEventListener('keydown', (e) => { if (e.code === 'Escape') { this.close(); } });
  }

  // ------------------------------------------------------------------ mensagens
  private onProg(m: ProgressionMessage) {
    if (!m?.p) return;
    this.stats.prog++;
    const before = this.knownActive;
    this.p = m.p; this.persistent = !!m.persistent;
    setLocalEntitlements(m.p.unlocks);
    this.knownActive = new Set(m.p.active.map((a) => a.missionId));
    // missões que acabaram de aparecer (revelação progressiva): aviso discreto, sem tutorial
    if (!this.first && this.cat) for (const id of this.knownActive) if (!before.has(id)) { const d = this.def(id); if (d) this.shell.notice(`Nova missão: ${d.title}`, 'new', 2800); }
    this.first = false;
    this.render();
    if (this.screen) this.fillScreen();
    this.maybeWelcome();
  }

  private onNotice(n: ProgressionNotice) {
    if (!n?.kind) return;
    this.stats.notices++;
    const xp = n.xp ? ` · +${n.xp} XP` : '';
    if (n.kind === 'objective') this.shell.notice(`✓ ${n.label}`, 'objective', 2400);
    else if (n.kind === 'mission') this.shell.notice(`MISSÃO CONCLUÍDA — ${n.label}${xp}`, 'mission', 3800);
    else if (n.kind === 'achievement') this.shell.notice(`CONQUISTA — ${n.label}${xp}`, 'achievement', 3600);
    else if (n.kind === 'level') this.shell.notice(`NÍVEL ${n.level ?? ''}! Novos itens podem ter sido liberados`, 'level', 4200);
    else if (n.kind === 'reward') this.shell.notice(n.item ? `RECOMPENSA — ${n.label}` : `${n.label}${xp}`, 'reward', 3400);
  }

  // ------------------------------------------------------------------ rastreador
  private def(id: string) { return this.cat?.missions.find((m) => m.id === id); }

  /** missão em destaque: a escolhida, senão a primeira ativa não opcional (ordem do catálogo) */
  current() {
    const p = this.p;
    if (!p || !this.cat) return null;
    const act = new Map(p.active.map((a) => [a.missionId, a]));
    const id = p.tracked && act.has(p.tracked) ? p.tracked
      : this.cat.missions.find((m) => act.has(m.id) && !m.optional)?.id ?? p.active[0]?.missionId;
    const def = id ? this.def(id) : undefined;
    return def ? { def, prog: act.get(def.id)! } : null;
  }

  private render() {
    this.stats.renders++;
    const cur = this.current();
    this.tracker.hidden = !cur;
    if (!cur) return;
    const rows = cur.def.objectives.map((o) => {
      const v = cur.prog.values[o.id] ?? 0, t = objectiveTarget(o), done = v >= t;
      const li = el('li', done ? 'done' : '');
      li.append(el('span', 'ck', done ? '✓' : '•'), el('span', 'lb', o.label));
      if (t > 1 && !done) li.append(el('span', 'ct', o.sumField === 'meters' ? `${Math.floor(v)}/${t} m` : o.sumField === 'seconds' ? `${Math.floor(v / 60)}/${Math.round(t / 60)} min` : `${Math.floor(v)}/${t}`));
      return li;
    });
    const head = el('div', 'pt-head');
    head.append(el('span', 'pt-kicker', `MISSÃO · NÍVEL ${this.p!.level}`), el('span', 'pt-title', cur.def.title));
    const ul = el('ul', 'pt-objs');
    ul.append(...rows);
    this.tracker.replaceChildren(head, ul);
    // mostra por inteiro ao mudar; recolhe para o título depois de 9 s
    this.tracker.classList.remove('collapsed');
    clearTimeout(this.collapseTimer);
    this.collapseTimer = window.setTimeout(() => this.tracker.classList.add('collapsed'), 9000);
  }

  // ------------------------------------------------------------------ boas-vindas
  private maybeWelcome() {
    const p = this.p;
    if (!p || this.welcome || !this.cat) return;
    const seen = new Set([...(p.seen ?? []), ...(this.persistent ? [] : local.get())]);
    if (seen.has('welcome')) return;
    const m = this.def('boas_vindas');
    if (!m || !p.active.some((a) => a.missionId === m.id)) { this.markSeen(); return; } // já passou da primeira missão
    const w = (this.welcome = el('div', 'prog-welcome'));
    w.setAttribute('role', 'dialog');
    w.setAttribute('aria-label', m.title);
    const card = el('div', 'pw-card');
    card.append(el('div', 'pw-kicker', 'PRIMEIRA VISITA'), el('h2', 'pw-title', m.title), el('p', 'pw-sub', 'Explore a avenida'),
      el('p', 'pw-obj', `Objetivo: ${m.objectives[0].label}`), el('p', 'pw-note', 'As próximas atividades aparecem aos poucos, no canto da tela. Progresso completo em ☰ → Progresso.'));
    const ok = el('button', 'pw-ok', 'Começar');
    ok.type = 'button';
    ok.addEventListener('click', () => this.dismissWelcome());
    card.append(ok);
    w.append(card);
    document.querySelector('.hud')?.appendChild(w);
    this.shell.onModal?.(true);
    setTimeout(() => ok.focus({ preventScroll: true }), 50);
  }

  dismissWelcome() {
    if (!this.welcome) return;
    this.welcome.remove();
    this.welcome = null;
    this.markSeen();
    this.shell.onModal?.(false);
  }

  private markSeen() { this.net.send('prog_seen', { k: 'welcome' }); if (!this.persistent) local.add('welcome'); }

  // ------------------------------------------------------------------ tela PROGRESSO
  open() {
    if (this.screen) return;
    const s = (this.screen = el('div', 'prog-screen'));
    s.setAttribute('role', 'dialog');
    s.setAttribute('aria-label', 'Progresso');
    s.addEventListener('click', (e) => { if (e.target === s) this.close(); });
    document.querySelector('.hud')?.appendChild(s);
    this.fillScreen();
    this.shell.onModal?.(true);
  }

  close() {
    if (!this.screen) return;
    this.screen.remove();
    this.screen = null;
    this.shell.onModal?.(false);
  }

  get isOpen() { return !!this.screen; }

  private fillScreen() {
    const s = this.screen!, p = this.p, cat = this.cat;
    const panel = el('div', 'ps-panel');
    const close = el('button', 'ps-close', '✕');
    close.type = 'button'; close.setAttribute('aria-label', 'Fechar');
    close.addEventListener('click', () => this.close());
    panel.append(close, el('div', 'ps-kicker', 'PRESIDENTE VARGAS'), el('h2', 'ps-title', 'PROGRESSO'));
    if (!p || !cat) { panel.append(el('p', 'ps-empty', 'Conecte-se ao mundo compartilhado para ver seu progresso.')); s.replaceChildren(panel); return; }
    // nível + barra
    const b = levelBounds(cat.levels, p.level);
    const frac = b.next === null ? 1 : Math.max(0, Math.min(1, (p.xp - b.cur) / Math.max(1, b.next - b.cur)));
    const lvl = el('div', 'ps-level');
    lvl.append(el('span', 'ps-lv', `NÍVEL ${p.level}`), el('span', 'ps-xp', b.next === null ? `${p.xp} XP · nível máximo` : `${p.xp} / ${b.next} XP`));
    const bar = el('div', 'ps-bar'), fill = el('i');
    fill.style.width = `${(frac * 100).toFixed(1)}%`;
    bar.append(fill);
    panel.append(lvl, bar);
    if (p.titles?.length) panel.append(el('p', 'ps-titles', `Títulos: ${p.titles.join(' · ')}`));
    panel.append(el('p', 'ps-note', this.persistent ? 'Salvo na sua conta.' : 'Visitante: o progresso vale só nesta visita — crie uma conta para guardar.'));
    // missões
    const act = new Map(p.active.map((a) => [a.missionId, a]));
    const cur = this.current()?.def.id;
    const sec = (title: string) => { const h = el('h3', 'ps-h', title); panel.append(h); };
    sec('MISSÕES ATIVAS');
    const ul = el('ul', 'ps-missions');
    for (const m of cat.missions) {
      const a = act.get(m.id);
      if (!a) continue;
      const li = el('li', m.id === cur ? 'tracked' : '');
      const top = el('div', 'pm-top');
      top.append(el('b', '', m.title), el('span', 'pm-cat', CATEGORY[m.category] ?? m.category));
      const objs = el('ul', 'pm-objs');
      for (const o of m.objectives) {
        const v = a.values[o.id] ?? 0, t = objectiveTarget(o);
        objs.append(el('li', v >= t ? 'done' : '', `${v >= t ? '✓' : '•'} ${o.label}${t > 1 && v < t ? ` (${Math.floor(v)}/${t})` : ''}`));
      }
      li.append(top, el('p', 'pm-desc', m.description), objs);
      if (m.id !== cur) {
        const tb = el('button', 'pm-track', 'Acompanhar');
        tb.type = 'button';
        tb.addEventListener('click', () => this.net.send('mission_track', { id: m.id }));
        li.append(tb);
      }
      ul.append(li);
    }
    if (!ul.childElementCount) ul.append(el('li', 'ps-empty', 'Nenhuma missão ativa agora.'));
    panel.append(ul);
    const done = cat.missions.filter((m) => p.completedMissions.includes(m.id));
    sec(`CONCLUÍDAS (${done.length}/${cat.missions.length})`);
    panel.append(el('p', 'ps-list', done.length ? done.map((m) => `✓ ${m.title}`).join('   ') : '—'));
    // conquistas
    sec(`CONQUISTAS (${p.achievements.length}/${cat.achievements.length})`);
    const ag = el('div', 'ps-grid');
    for (const a of cat.achievements) {
      const got = p.achievements.includes(a.id);
      if (a.hidden && !got) continue;
      const c = el('div', `ps-ach${got ? ' got' : ''}`);
      c.append(el('b', '', a.title), el('span', '', a.description));
      ag.append(c);
    }
    panel.append(ag);
    // recompensas
    sec('RECOMPENSAS');
    const rg = el('div', 'ps-grid rewards');
    const owned = new Set(p.unlocks);
    for (const r of cat.rewards) {
      const got = owned.has(r.item), soon = r.source === 'PREMIUM_FUTURE';
      const c = el('div', `ps-rw${got ? ' got' : ''}${soon ? ' soon' : ''}`);
      c.append(el('b', '', r.label), el('span', '', got ? 'Liberado' : soon ? 'Em breve — nada é cobrado' : `🔒 ${requirementOf(cat, r.item)}`));
      rg.append(c);
    }
    panel.append(rg);
    s.replaceChildren(panel);
  }
}
