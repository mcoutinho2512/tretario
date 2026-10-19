/**
 * Rodada 12 — POOL FIXO de rótulos de apelido (DOM). Antes cada remoto criava o próprio <div> (500 remotos = 500 nós,
 * escondidos); agora existem só `size` nós (≈ NAME_LOD.cap + folga), emprestados a quem a decisão de LOD escolheu.
 * Texto/classe só mudam quando mudam; por quadro só o `transform` dos emprestados (e só quando muda de pixel).
 * O custo de DOM fica limitado pelo teto de rótulos, não pelo tamanho da população.
 */
export interface TagSlot {
  readonly el: HTMLDivElement;
  owner: unknown;
  text: string;
  cls: number;
  pos: string;
}

/** bits de classe do rótulo */
export const TAG_CLS = { short: 1, away: 2, combat: 4 } as const;
const CLS_NAMES: [number, string][] = [[TAG_CLS.short, 'short'], [TAG_CLS.away, 'away'], [TAG_CLS.combat, 'combat']];

export class NameTagPool {
  private free: TagSlot[] = [];
  private all: TagSlot[] = [];
  /** QA: escritas de DOM (texto/classe) desde o início */
  writes = 0;

  constructor(private parent: HTMLElement, readonly size: number) {
    for (let i = 0; i < size; i++) {
      const el = document.createElement('div');
      el.className = 'name-label';
      el.hidden = true;
      parent.appendChild(el);
      const s: TagSlot = { el, owner: null, text: '', cls: 0, pos: '' };
      this.all.push(s);
      this.free.push(s);
    }
  }

  get inUse() { return this.size - this.free.length; }
  get nodes() { return this.all.length; }

  /** empresta um rótulo (null = pool esgotado: o chamador simplesmente não mostra) */
  acquire(owner: unknown): TagSlot | null {
    const s = this.free.pop();
    if (!s) return null;
    s.owner = owner;
    s.pos = '';
    s.el.hidden = false;
    return s;
  }

  release(s: TagSlot | null) {
    if (!s || s.owner === null) return;
    s.owner = null;
    s.el.hidden = true;
    s.el.style.transform = '';
    s.pos = '';
    this.free.push(s);
  }

  /** texto e classes (só escreve o que mudou) */
  set(s: TagSlot, text: string, cls: number) {
    if (s.text !== text) { s.text = text; s.el.textContent = text; this.writes++; }
    if (s.cls !== cls) {
      for (const [bit, name] of CLS_NAMES) if ((s.cls ^ cls) & bit) s.el.classList.toggle(name, (cls & bit) !== 0);
      s.cls = cls;
      this.writes++;
    }
  }

  /** posição em px (só escreve quando muda) — devolve se escreveu */
  move(s: TagSlot, px: number, py: number): boolean {
    const pos = `translate3d(${px}px,${py}px,0) translate(-50%,-100%)`;
    if (pos === s.pos) return false;
    s.pos = pos;
    s.el.style.transform = pos;
    return true;
  }

  dispose() { for (const s of this.all) s.el.remove(); this.all.length = this.free.length = 0; void this.parent; }
}
