/**
 * Escolha de grupo do evento atual (rodada 8): cartões gerados dos DADOS (GET /api/events/current), sem nenhum caso
 * especial por grupo. Grupo = só aparência (camiseta opcional nas cores; designs sugeridos para bandeira, cartaz e
 * faixa — nunca obrigatórios). Vale só para este evento.
 */
import type { PublicGroup } from '../events/groups';
import { groupDesigns } from '../events/groups';
import type { Design } from '../social/designs';

export interface GroupChoice { groupKey: string | null; wearColors: boolean }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** miniatura CSS de um design (cores + texto curto), para o cartão */
function tile(d: Design): string {
  const p = d.palette;
  const bg = d.pattern === 'split_h' || d.pattern === 'brazil' ? `linear-gradient(180deg, ${p.bg} 0 55%, ${p.accent ?? p.fg} 55% 100%)`
    : d.pattern === 'border' ? `${p.bg}` : p.bg;
  const txt = d.number ?? d.lines?.[0]?.slice(0, 9) ?? '';
  const border = d.pattern === 'border' && p.accent ? `box-shadow: inset 0 0 0 3px ${p.accent};` : '';
  return `<span class="design-tile" title="${esc(d.label)}" style="background:${bg};color:${p.fg};${border}">${esc(txt)}</span>`;
}

export class GroupPicker {
  readonly root: HTMLElement;
  private selected: string | null = null;
  private resolve: ((c: GroupChoice | null) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('section');
    this.root.className = 'screen groups hidden';
    this.root.setAttribute('aria-labelledby', 'groups-title');
    parent.appendChild(this.root);
  }

  /** mostra a escolha; resolve com o grupo escolhido (null = voltar sem mudar) */
  open(eventName: string, groups: PublicGroup[], current: string | null): Promise<GroupChoice | null> {
    this.selected = current;
    this.root.innerHTML = `<div class="groups-inner">
      <span class="eyebrow">${esc(eventName)} · ESCOLHA DE GRUPO</span>
      <h2 id="groups-title">Com quem você vai?</h2>
      <p class="lead">Escolha um grupo para este evento ou fique sem grupo. O grupo muda só o visual sugerido: a camiseta nas cores e as artes de bandeira, cartaz e faixa.</p>
      <div class="group-list" role="radiogroup" aria-label="Grupos do evento">
        ${groups.map((g) => {
          const designs = [...groupDesigns(g, 'flag'), ...groupDesigns(g, 'sign'), ...groupDesigns(g, 'banner')].filter((d, i, a) => a.indexOf(d) === i).slice(0, 6);
          return `<button type="button" class="group-card" role="radio" aria-checked="false" data-key="${esc(g.key)}">
            <span class="group-band" aria-hidden="true">${g.colors.map((c) => `<i style="background:${c}"></i>`).join('')}</span>
            <b>${esc(g.name)}</b>
            <span class="gdesc">${g.neutral ? 'Sem lado: cores neutras e cartazes cívicos.' : 'Cores e artes do grupo para camiseta, bandeira e cartaz.'}</span>
            <span class="group-designs" aria-label="Artes sugeridas">${designs.map(tile).join('')}</span>
          </button>`;
        }).join('')}
      </div>
      <div class="groups-opts">
        <label><input type="checkbox" id="g-wear" checked /> <span>Vestir camiseta nas cores do grupo <small>(dá para trocar depois no editor)</small></span></label>
      </div>
      <p class="groups-note">Todos os grupos têm exatamente as mesmas regras: velocidade, veículos, acesso, chat e visibilidade são iguais. A escolha vale só para este evento e não fica no seu perfil público.</p>
      <div class="groups-foot">
        <button type="button" class="home-btn primary" id="g-ok"><span>CONFIRMAR</span><small id="g-ok-sub">escolha um grupo</small></button>
        <button type="button" class="home-btn" id="g-none"><span>SEM GRUPO</span><small>entrar sem lado</small></button>
        <button type="button" class="home-link" id="g-back">VOLTAR</button>
        <span class="status" id="g-status" role="status"></span>
      </div>
    </div>`;
    const cards = Array.from(this.root.querySelectorAll<HTMLButtonElement>('.group-card'));
    const ok = this.root.querySelector<HTMLButtonElement>('#g-ok')!;
    const sync = () => {
      for (const c of cards) { c.setAttribute('aria-checked', String(c.dataset.key === this.selected)); c.tabIndex = c.dataset.key === this.selected || (!this.selected && c === cards[0]) ? 0 : -1; }
      const g = groups.find((x) => x.key === this.selected);
      ok.disabled = !g;
      this.root.querySelector('#g-ok-sub')!.textContent = g ? `entrar com ${g.name}` : 'escolha um grupo';
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
      const wear = () => this.root.querySelector<HTMLInputElement>('#g-wear')!.checked;
      ok.addEventListener('click', () => this.finish({ groupKey: this.selected, wearColors: wear() }));
      this.root.querySelector('#g-none')!.addEventListener('click', () => this.finish({ groupKey: null, wearColors: false }));
      this.root.querySelector('#g-back')!.addEventListener('click', () => this.finish(null));
    });
  }

  status(msg: string) { const s = this.root.querySelector('#g-status'); if (s) s.textContent = msg; }

  private finish(c: GroupChoice | null) {
    const r = this.resolve;
    this.resolve = null;
    r?.(c);
  }

  close() { this.root.classList.add('hidden'); this.finish(null); }
}
