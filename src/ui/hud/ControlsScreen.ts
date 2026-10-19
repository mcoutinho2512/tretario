/**
 * Rodada 11 — tela de CONTROLES (F1 e menu do jogo · docs/DESKTOP_CONTROLS.md). Gerada do mapa único
 * (DEFAULT_KEYMAP + MOUSE_CONTROLS + remapeamentos locais), agrupada MOVIMENTO, CÂMERA, INTERAÇÃO, VEÍCULOS, COMBATE,
 * ITENS, SOCIAL, SISTEMA. Remapeamento das teclas principais: clique na tecla, aperte a nova; conflito perguntado;
 * "Restaurar padrão"; salvo no aparelho (saveKeyOverrides). Esc cancela a captura / fecha a tela (pilha do Esc).
 * No toque mostra o resumo dos controles de tela.
 */
import { applyRemap, controlsRows, keyLabel, loadKeyOverrides, saveKeyOverrides, BINDING_BY_ACTION, type GameAction } from '../../input/keymap';
import { EscSlot } from '../escStack';

const TOUCH_HELP = [
  ['Joystick', 'andar (até o fim corre)'], ['Arrastar na tela', 'girar a câmera'], ['Pinça', 'zoom'],
  ['Tocar num objeto', 'interagir (veículo, item, pessoa)'], ['PULAR · USAR · CHAT · CORRER', 'botões de tela'],
  ['Barra de ícones', 'veículos, itens, pichar, confronto, gestos, personagem, mapa'],
  ['SOCO · CHUTE · ESQUIVA', 'só onde há confronto (zona de combate, treino, evento ou modo interação)'], ['☰', 'menu'],
];

export class ControlsScreen {
  readonly el: HTMLDivElement;
  private body: HTMLDivElement;
  private msg: HTMLParagraphElement;
  private esc = new EscSlot('controles', 100, () => this.toggle(false));
  private capEsc = new EscSlot('controles-tecla', 300, () => this.stopCapture('Troca cancelada'));
  private capturing: { action: GameAction; btn: HTMLButtonElement } | null = null;
  private pending: { action: GameAction; code: string; owner: GameAction } | null = null;
  onToggle?: (open: boolean) => void;
  /** o mapa mudou (o InputManager relê) */
  onRemap?: () => void;

  constructor(private touch: boolean) {
    const el = (this.el = document.createElement('div'));
    el.className = 'controls-screen';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Controles');
    const card = document.createElement('div');
    card.className = 'cs-card';
    const head = document.createElement('div');
    head.className = 'cs-head';
    const h = document.createElement('h2');
    h.textContent = 'Controles';
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'sheet-close'; x.textContent = '×'; x.setAttribute('aria-label', 'Fechar controles');
    x.addEventListener('click', () => this.toggle(false));
    head.append(h, x);
    this.body = document.createElement('div');
    this.body.className = 'cs-body';
    this.msg = document.createElement('p');
    this.msg.className = 'cs-msg';
    this.msg.setAttribute('role', 'status');
    card.append(head, this.body, this.msg);
    el.appendChild(card);
    el.addEventListener('pointerdown', (e) => { if (e.target === el) this.toggle(false); });
    el.addEventListener('click', (e) => this.onClick(e));
    // captura da nova tecla: antes do jogo (fase de captura); Esc fica com a pilha (cancela)
    window.addEventListener('keydown', (e) => {
      if (!this.capturing || e.key === 'Escape') return;
      e.preventDefault(); e.stopImmediatePropagation();
      this.tryKey(this.capturing.action, e.code);
    }, true);
  }

  get open() { return !this.el.hidden; }

  toggle(v = !this.open) {
    if (v === this.open) return;
    this.el.hidden = !v;
    this.esc.set(v);
    if (!v) { this.stopCapture(''); this.pending = null; }
    else { this.msg.textContent = ''; this.render(); this.el.querySelector<HTMLElement>('.sheet-close')?.focus({ preventScroll: true }); }
    this.onToggle?.(v);
  }

  render() {
    const b = this.body;
    b.replaceChildren();
    if (this.touch) {
      const g = this.group('TOQUE');
      for (const [k, d] of TOUCH_HELP) g.list.append(this.row(d, [k], null, false));
      b.append(g.el);
      return;
    }
    const intro = document.createElement('p');
    intro.className = 'cs-intro';
    intro.textContent = 'O cursor fica sempre visível. Clique esquerdo seleciona e interage; segure o botão direito e arraste para girar a câmera; roda do mouse aproxima e afasta.';
    b.append(intro);
    const over = loadKeyOverrides();
    for (const g of controlsRows(over)) {
      const ge = this.group(g.group);
      for (const r of g.rows) ge.list.append(this.row(r.label, r.mouse ? [r.mouse] : r.keys.map(keyLabel), r.action && r.remappable ? r.action : null, !!r.mouse));
      b.append(ge.el);
    }
    const foot = document.createElement('div');
    foot.className = 'cs-foot';
    const reset = document.createElement('button');
    reset.type = 'button'; reset.className = 'cs-reset'; reset.dataset.reset = '1';
    reset.textContent = 'Restaurar padrão';
    const note = document.createElement('small');
    note.textContent = 'Clique numa tecla para trocar (salvo só neste aparelho). Esc, Enter, F1 e F3 são fixos.';
    foot.append(reset, note);
    b.append(foot);
  }

  private group(name: string) {
    const el = document.createElement('section');
    el.className = 'cs-group';
    const h = document.createElement('h3');
    h.textContent = name;
    const list = document.createElement('div');
    list.className = 'cs-list';
    el.append(h, list);
    return { el, list };
  }

  private row(label: string, keys: string[], action: GameAction | null, mouse: boolean) {
    const r = document.createElement('div');
    r.className = 'cs-row';
    const l = document.createElement('span');
    l.className = 'cs-label';
    l.textContent = label;
    const k = document.createElement('span');
    k.className = 'cs-keys';
    if (action) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'cs-key'; btn.dataset.action = action;
      btn.textContent = keys[0] ?? '—';
      btn.title = 'Clique e aperte a nova tecla';
      k.append(btn);
      for (const s of keys.slice(1)) { const kb = document.createElement('kbd'); kb.textContent = s; k.append(kb); }
    } else for (const s of keys.length ? keys : ['—']) { const kb = document.createElement(mouse ? 'span' : 'kbd'); if (mouse) kb.className = 'cs-mouse'; kb.textContent = s; k.append(kb); }
    r.append(l, k);
    return r;
  }

  private onClick(e: MouseEvent) {
    const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!t) return;
    if (t.dataset.reset) { saveKeyOverrides({}); this.onRemap?.(); this.render(); this.say('Teclas restauradas para o padrão'); return; }
    if (t.dataset.confirm) {
      const p = this.pending;
      this.pending = null;
      if (p && t.dataset.confirm === 'yes') this.tryKey(p.action, p.code, true);
      else this.say('Troca cancelada');
      return;
    }
    const a = t.dataset.action as GameAction | undefined;
    if (!a) return;
    this.stopCapture('');
    this.capturing = { action: a, btn: t };
    t.classList.add('capturing');
    t.textContent = 'Aperte…';
    this.capEsc.set(true);
    this.say(`Aperte a nova tecla para "${BINDING_BY_ACTION.get(a)?.label ?? a}" (Esc cancela)`);
  }

  private stopCapture(msg: string) {
    if (this.capturing) { this.capturing = null; this.capEsc.set(false); if (this.open) this.render(); }
    if (msg) this.say(msg);
  }

  /** aplica a troca; conflito pergunta (Trocar mesmo assim / Cancelar) */
  tryKey(action: GameAction, code: string, force = false) {
    const r = applyRemap(loadKeyOverrides(), action, code, force);
    const label = (a: GameAction) => BINDING_BY_ACTION.get(a)?.label ?? a;
    if (!r.ok) { this.stopCapture(r.reason === 'reservada' ? `${keyLabel(code)} é reservada do sistema` : 'Esta ação não pode ser trocada'); return; }
    if (!r.applied && r.conflict) {
      this.stopCapture('');
      this.pending = { action, code, owner: r.conflict };
      this.msg.replaceChildren(`${keyLabel(code)} já é de "${label(r.conflict)}". `);
      const yes = document.createElement('button'); yes.type = 'button'; yes.dataset.confirm = 'yes'; yes.className = 'cs-confirm'; yes.textContent = 'Trocar mesmo assim';
      const no = document.createElement('button'); no.type = 'button'; no.dataset.confirm = 'no'; no.className = 'cs-confirm'; no.textContent = 'Cancelar';
      this.msg.append(yes, ' ', no);
      return;
    }
    saveKeyOverrides(r.over);
    this.onRemap?.();
    this.capturing = null; this.capEsc.set(false);
    this.render();
    this.say(r.conflict ? `${keyLabel(code)} agora é de "${label(action)}"; "${label(r.conflict)}" ficou sem essa tecla` : `${keyLabel(code)} agora é de "${label(action)}"`);
  }

  private say(t: string) { this.msg.textContent = t; }
}
