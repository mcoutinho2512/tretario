/** Barra de ações (rodada 9.1): estado do popover, teclado, veículos perto, dica de controles e opções compartilhadas com a roda. */
import { describe, expect, it } from 'vitest';
import { BAR_CATS, HINT_AFTER_MOVE_MS, HINT_MAX_MS, PopoverState, distLabel, hintText, hintVisible, moveIndex, nearbyVehicles } from '../src/ui/hud/actionBarState';
import { actionOptions, itemOptions, type SocialLike } from '../src/ui/actionOptions';
import { ACTIONS } from '../src/social/actions';
import { SOCIAL_PROPS } from '../src/social/props';

describe('PopoverState', () => {
  it('alterna, troca de categoria e fecha; categoria sem popover fecha o aberto', () => {
    const s = new PopoverState();
    const log: [string | null, string | null][] = [];
    s.onChange = (o, p) => log.push([o, p]);
    expect(s.toggle('itens')).toBe(true);
    expect(s.open).toBe('itens');
    expect(s.toggle('gestos')).toBe(true);
    expect(s.open).toBe('gestos');
    expect(s.toggle('gestos')).toBe(false);
    expect(s.open).toBeNull();
    s.toggle('confronto');
    expect(s.toggle('mapa')).toBe(false);
    expect(s.open).toBeNull();
    expect(log).toEqual([['itens', null], ['gestos', 'itens'], [null, 'gestos'], ['confronto', null], [null, 'confronto']]);
  });

  it('clique fora fecha, dentro não', () => {
    const s = new PopoverState();
    s.toggle('veiculos');
    s.pointerDown(true);
    expect(s.open).toBe('veiculos');
    s.pointerDown(false);
    expect(s.open).toBeNull();
  });

  it('teclado no popover: setas andam com volta, Home/End, Esc fecha', () => {
    const s = new PopoverState();
    s.toggle('gestos');
    expect(s.keyInPopover('ArrowDown', 3)).toEqual({ kind: 'focus', index: 1 });
    expect(s.keyInPopover('ArrowDown', 3)).toEqual({ kind: 'focus', index: 2 });
    expect(s.keyInPopover('ArrowDown', 3)).toEqual({ kind: 'focus', index: 0 });
    expect(s.keyInPopover('ArrowUp', 3)).toEqual({ kind: 'focus', index: 2 });
    expect(s.keyInPopover('Home', 3)).toEqual({ kind: 'focus', index: 0 });
    expect(s.keyInPopover('End', 3)).toEqual({ kind: 'focus', index: 2 });
    expect(s.keyInPopover('KeyW', 3)).toEqual({ kind: 'none' });
    expect(s.keyInPopover('Escape', 3)).toEqual({ kind: 'close' });
    expect(s.open).toBeNull();
    expect(s.keyInPopover('ArrowDown', 3)).toEqual({ kind: 'none' });
  });

  it('teclado na barra: ←/→ trocam de botão, ↑ abre só quem tem popover', () => {
    const s = new PopoverState();
    const i = BAR_CATS.findIndex((c) => c.key === 'pichar');
    expect(s.keyOnBar('ArrowRight', i)).toEqual({ kind: 'focus', index: i + 1 });
    expect(s.keyOnBar('ArrowLeft', 0)).toEqual({ kind: 'focus', index: BAR_CATS.length - 1 });
    expect(s.keyOnBar('ArrowUp', i)).toEqual({ kind: 'none' });
    expect(s.keyOnBar('ArrowUp', 0)).toEqual({ kind: 'open', cat: 'veiculos' });
    expect(s.open).toBe('veiculos');
    expect(s.keyOnBar('Escape', 0)).toEqual({ kind: 'close' });
  });

  it('moveIndex com lista vazia', () => { expect(moveIndex(0, 0, 'ArrowDown')).toBeNull(); });

  it('sete categorias, quatro com popover', () => {
    expect(BAR_CATS.map((c) => c.key)).toEqual(['veiculos', 'itens', 'pichar', 'confronto', 'gestos', 'personagem', 'mapa']);
    expect(BAR_CATS.filter((c) => c.popover).map((c) => c.key)).toEqual(['veiculos', 'itens', 'confronto', 'gestos']);
  });
});

describe('veículos perto', () => {
  const list = [
    { id: 'b1', kind: 'bicycle', x: 10, z: 0, free: true },
    { id: 'b2', kind: 'bicycle', x: 4, z: 0, free: true },
    { id: 'c1', kind: 'car', x: 0, z: 30, free: true },
    { id: 'c2', kind: 'car', x: 0, z: 2, free: false },
    { id: 'm1', kind: 'moto', x: 0, z: 900, free: true },
  ];
  it('um por tipo (o livre mais perto), ordenado, até o raio', () => {
    const r = nearbyVehicles(list, 0, 0, 250);
    expect(r.map((v) => v.id)).toEqual(['b2', 'c1']);
    expect(r[0].d).toBeCloseTo(4);
  });
  it('limite', () => { expect(nearbyVehicles(list, 0, 0, 2000, 1).map((v) => v.id)).toEqual(['b2']); });
  it('distância legível e estável', () => {
    expect(distLabel(2)).toBe('aqui');
    expect(distLabel(33)).toBe('35 m');
    expect(distLabel(34.9)).toBe('35 m');
    expect(distLabel(244)).toBe('240 m');
    expect(distLabel(1240)).toBe('1,2 km');
  });
});

describe('dica de controles', () => {
  it('fica até o 1º movimento (+ alguns segundos) ou os primeiros minutos', () => {
    expect(hintVisible(1000, null)).toBe(true);
    expect(hintVisible(HINT_MAX_MS + 1, null)).toBe(false);
    expect(hintVisible(5000, 1000)).toBe(true);
    expect(hintVisible(20000, HINT_AFTER_MOVE_MS + 1)).toBe(false);
  });
  it('texto por aparelho', () => {
    expect(hintText(false)).toContain('W A S D mover');
    expect(hintText(false)).toContain('G roda');
    expect(hintText(true)).toBe('joystick mover · arraste para olhar');
  });
});

describe('opções compartilhadas (roda e barra)', () => {
  const fake = (): SocialLike & { calls: string[] } => {
    const calls: string[] = [];
    return { prop: 0, act: 0, calls, requestProp(id) { calls.push(`prop ${id}`); this.prop = id; }, requestAction(id) { calls.push(`act ${id}`); } };
  };
  it('itens: mãos vazias + sociais + extras; mãos vazias com nada na mão não pede nada', () => {
    const s = fake();
    const o = itemOptions(s, [11]);
    expect(o[0].label).toBe('Mãos vazias');
    expect(o.length).toBe(1 + SOCIAL_PROPS.length + 1);
    expect(o[o.length - 1].id).toBe(11);
    o[0].pick();
    expect(s.calls).toEqual([]);
    o[1].pick();
    expect(s.calls).toEqual([`prop ${o[1].id}`]);
    const again = itemOptions(s);
    expect(again[1].active).toBe(true);
    again[0].pick();
    expect(s.calls.at(-1)).toBe('prop 0');
  });
  it('ações por categoria; as que pedem item ficam apagadas sem o item', () => {
    const s = fake();
    const g = actionOptions(s, 'manifestacao');
    expect(g.length).toBe(ACTIONS.filter((a) => a.category === 'manifestacao').length);
    const needs = ACTIONS.find((a) => a.category === 'manifestacao' && a.needs)!;
    expect(g.find((x) => x.id === needs.id)!.disabled).toBe(true);
    g[0].pick();
    expect(s.calls).toEqual([`act ${g[0].id}`]);
  });
});
