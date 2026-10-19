/**
 * Rodada 10 — escolha de TORCIDA (tela "TORCIDA"): cartões gerados dos DADOS (public/gameplay/supporters.json), sem
 * caso especial por torcida. Não obrigatória ("Nenhuma / Neutro" é uma escolha válida). Torcida é SEPARADA do grupo
 * político/do evento e nada aqui infere política. "Vestir as cores" aplica a camisa da torcida (design) e as cores
 * sugeridas — dá para trocar depois no editor. Nenhuma torcida tem vantagem: regras, velocidade e acesso iguais.
 */
import type { SupporterData, SupporterGroupDefinition } from '../supporters/types';
import { DESIGN_BY_ID, type Design } from '../social/designs';
import './supporters.css';

export interface SupporterPick { group: string; wearColors: boolean }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** miniatura CSS da camisa (só cores/padrão do design; sem escudo) */
export function shirtSwatch(d: Design | undefined): string {
  if (!d) return 'background:#3a3f46';
  const p = d.palette, a = p.accent ?? p.fg, t = p.third ?? p.fg;
  switch (d.pattern) {
    case 'hoops_top': return `background:repeating-linear-gradient(180deg, ${p.bg} 0 14%, ${a} 14% 28%)`;
    // faixa do ombro ESQUERDO de quem veste (à direita de quem olha) ao quadril direito
    case 'sash_l': return `background:linear-gradient(135deg, ${p.bg} 0 42%, ${a} 42% 64%, ${p.bg} 64% 100%)`;
    case 'h_stripes': case 'hoops': return `background:repeating-linear-gradient(180deg, ${p.bg} 0 20%, ${a} 20% 40%)`;
    case 'tricolor_v': return `background:linear-gradient(90deg, ${p.bg} 0 33%, ${t} 33% 66%, ${a} 66% 100%)`;
    case 'split_h': return `background:linear-gradient(180deg, ${p.bg} 0 72%, ${a} 72% 100%)`;
    case 'stripes_pin': return `background:repeating-linear-gradient(90deg, ${p.bg} 0 9px, ${t} 9px 10.5px, ${a} 10.5px 19.5px, ${t} 19.5px 21px)`;
    case 'stripes_eq': case 'v_stripes': return `background:repeating-linear-gradient(90deg, ${p.bg} 0 11px, ${a} 11px 22px)`;
    default: return `background:${p.bg}`;
  }
}

/** cartão de uma torcida (ou do neutro) — também usado pela aba TORCIDA do editor (rodada 11) */
export function supporterCard(g: SupporterGroupDefinition | null, neutralId: string): string {
  const id = g?.id ?? neutralId;
  const shirt = g ? DESIGN_BY_ID.get(g.clothingSet.shirtDesign) : undefined;
  const flags = g ? [...g.flagSet, ...g.bannerSet].map((x) => DESIGN_BY_ID.get(x)).filter((x): x is Design => !!x) : [];
  return `<button type="button" class="group-card sup-card" role="radio" aria-checked="false" data-key="${esc(id)}">
    <span class="sup-shirt" aria-hidden="true"><i style="${shirtSwatch(shirt)}"></i></span>
    <b>${esc(g ? g.displayName : 'Nenhuma / Neutro')}</b>
    <span class="gdesc">${g ? esc(shirt?.label ?? '') : 'Sem torcida: nada muda no seu visual.'}</span>
    <span class="group-designs" aria-label="Bandeira e faixa">${flags.map((d) => `<span class="design-tile" title="${esc(d.label)}" style="${shirtSwatch(d)}"></span>`).join('')}</span>
  </button>`;
}

export class SupporterPicker {
  readonly root: HTMLElement;
  private selected: string | null = null;
  private resolve: ((c: SupporterPick | null) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('section');
    this.root.className = 'screen groups supporters hidden';
    this.root.setAttribute('aria-labelledby', 'sup-title');
    parent.appendChild(this.root);
  }

  /** abre; resolve com a escolha (null = voltar sem mudar). `current` = id atual (ou null) */
  open(data: SupporterData, current: string | null, opts: { account: boolean; pending?: string | null } = { account: false }): Promise<SupporterPick | null> {
    this.selected = current ?? null;
    const name = (id: string | null | undefined) => data.groups.find((g) => g.id === id)?.displayName ?? (id === data.neutralId ? 'Nenhuma' : '');
    this.root.innerHTML = `<div class="groups-inner">
      <span class="eyebrow">PERFIL · TORCIDA</span>
      <h2 id="sup-title">Para qual time você torce?</h2>
      <p class="lead">Escolha sua torcida ou fique sem nenhuma. A torcida muda só o visual (camisa, bandeira e faixa nas cores do time) e aparece no seu perfil. Ela não tem relação com grupos políticos ou do evento.</p>
      <div class="group-list sup-list" role="radiogroup" aria-label="Torcidas">
        ${data.groups.map((g) => supporterCard(g, data.neutralId)).join('')}
        ${supporterCard(null, data.neutralId)}
      </div>
      <div class="groups-opts">
        <label><input type="checkbox" id="s-wear" checked /> <span>Vestir as cores <small>(camisa da torcida e cores sugeridas; dá para trocar depois no editor)</small></span></label>
      </div>
      <p class="groups-note">Todas as torcidas têm exatamente as mesmas regras: velocidade, veículos, acesso, chat e visibilidade são iguais. Durante um evento competitivo em que você esteja inscrito, a troca fica pendente e vale ao sair dele.${opts.account ? '' : ' Sem conta, a escolha vale só nesta visita.'}${opts.pending ? ` <b>Troca pendente: ${esc(name(opts.pending))}.</b>` : ''}</p>
      <div class="groups-foot">
        <button type="button" class="home-btn primary" id="s-ok"><span>CONFIRMAR</span><small id="s-ok-sub">escolha uma opção</small></button>
        <button type="button" class="home-link" id="s-back">VOLTAR</button>
        <span class="status" id="s-status" role="status"></span>
      </div>
    </div>`;
    const cards = Array.from(this.root.querySelectorAll<HTMLButtonElement>('.sup-card'));
    const ok = this.root.querySelector<HTMLButtonElement>('#s-ok')!;
    const sync = () => {
      for (const c of cards) { c.setAttribute('aria-checked', String(c.dataset.key === this.selected)); c.tabIndex = c.dataset.key === this.selected || (!this.selected && c === cards[0]) ? 0 : -1; }
      ok.disabled = !this.selected;
      this.root.querySelector('#s-ok-sub')!.textContent = this.selected ? (this.selected === data.neutralId ? 'ficar sem torcida' : `torcer para ${name(this.selected)}`) : 'escolha uma opção';
      const wear = this.root.querySelector<HTMLInputElement>('#s-wear')!;
      wear.disabled = !this.selected || this.selected === data.neutralId;
    };
    cards.forEach((c, i) => {
      c.addEventListener('click', () => { this.selected = c.dataset.key!; sync(); });
      c.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        const n = cards[(i + d + cards.length) % cards.length];
        this.selected = n.dataset.key!; sync(); n.focus();
      });
    });
    sync();
    this.root.classList.remove('hidden');
    requestAnimationFrame(() => (cards.find((c) => c.tabIndex === 0) ?? cards[0])?.focus());
    return new Promise((res) => {
      this.resolve = res;
      ok.addEventListener('click', () => { if (this.selected) this.finish({ group: this.selected, wearColors: this.root.querySelector<HTMLInputElement>('#s-wear')!.checked && this.selected !== data.neutralId }); });
      this.root.querySelector('#s-back')!.addEventListener('click', () => this.finish(null));
    });
  }

  status(msg: string) { const s = this.root.querySelector('#s-status'); if (s) s.textContent = msg; }

  private finish(c: SupporterPick | null) {
    const r = this.resolve;
    this.resolve = null;
    r?.(c);
  }

  close() { this.root.classList.add('hidden'); this.finish(null); }
}
