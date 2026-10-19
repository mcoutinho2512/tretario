/**
 * Rodada 11 — DESKTOP FIRST (docs/DESKTOP_CONTROLS.md): mapa de teclas único e remapeamento, pilha do Esc (ordem,
 * prioridade, menu do jogo), regra de campo de texto, clique × arrasto (esquerdo e direito), câmera de veículo (volta
 * ~1 s depois de soltar) e "UI consome antes do mundo" (InputManager com janela/canvas falsos, sem DOM real).
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  ACTION_TOGGLE, CLICK_MAX_MS, CLICK_SLOP_PX, DEFAULT_KEYMAP, KEY_GROUP_ORDER, MOUSE_CONTROLS, RESERVED_KEYS, applyRemap, controlsRows,
  isTypingTarget, keyLabel, keymapConflicts, keysFor, resolveKeymap,
} from '../src/input/keymap';
import { EscSlot, escLayers, escTop, handleEsc, installEscKey, pushEsc, setEscMenu } from '../src/ui/escStack';
import { MouseGesture, isWorldTarget } from '../src/input/mouseGesture';
import { RETURN_DELAY_MS, VehicleCamFollow } from '../src/camera/vehicleCam';
import { sanitizeInputPrefs } from '../src/input/inputPrefs';
import { farFor, highlightText } from '../src/interaction/select';
import type { Interactable } from '../src/interaction/types';

describe('mapa de teclas único', () => {
  it('padrão sem conflitos; combate R/Q/C/F; clique esquerdo nunca é soco; direito é câmera', () => {
    expect(keymapConflicts({})).toEqual([]);
    const m = resolveKeymap({});
    expect(m.get('KeyR')).toBe('punch');
    expect(m.get('KeyQ')).toBe('kick');
    expect(m.get('KeyC')).toBe('dodge');
    expect(m.get('KeyF')).toBe('push');
    expect(m.get('KeyE')).toBe('use');
    expect(m.get('KeyI')).toBe('inventory');
    for (let i = 1; i <= 5; i++) expect(m.get(`Digit${i}`)).toBe(`quick_${i}`);
    const left = MOUSE_CONTROLS.find((c) => c.input === 'Clique esquerdo')!;
    expect(left.label).toMatch(/Selecionar/);
    expect(MOUSE_CONTROLS.some((c) => /soco|chute/i.test(c.label))).toBe(false);
    expect(MOUSE_CONTROLS.filter((c) => c.input.startsWith('Botão direito')).every((c) => /câmera|Olhar/i.test(c.label))).toBe(true);
  });

  it('toda ação de toque único tem toggle (o Game/CombatClient consomem por nome)', () => {
    for (const b of DEFAULT_KEYMAP) {
      if (['move_forward', 'move_back', 'move_left', 'move_right', 'run', 'jump', 'chat', 'menu'].includes(b.action)) continue;
      expect(ACTION_TOGGLE[b.action], b.action).toBeTruthy();
    }
    expect(ACTION_TOGGLE.punch).toBe('cbt_punch');
    expect(ACTION_TOGGLE.push).toBe('action');
    expect(ACTION_TOGGLE.pickup).toBe('item');
  });

  it('remapeamento: troca a principal, mantém as secundárias, conflito pergunta, force tira da outra', () => {
    let r = applyRemap({}, 'move_forward', 'KeyI');
    expect(r.ok && r.conflict).toBe('inventory');
    expect(r.ok && r.applied).toBe(false);
    r = applyRemap({}, 'move_forward', 'KeyI', true);
    expect(r.ok && r.applied).toBe(true);
    if (!r.ok) throw new Error('falhou');
    expect(keysFor('move_forward', r.over)).toEqual(['KeyI', 'ArrowUp']);
    expect(keysFor('inventory', r.over)).toEqual([]);
    expect(resolveKeymap(r.over).get('KeyI')).toBe('move_forward');
    expect(resolveKeymap(r.over).get('KeyW')).toBeUndefined();
    expect(keymapConflicts(r.over)).toEqual([]);
    const free = applyRemap({}, 'punch', 'KeyV');
    expect(free.ok && free.applied && free.conflict).toBe(null);
    if (free.ok) expect(resolveKeymap(free.over).get('KeyV')).toBe('punch');
  });

  it('teclas de sistema não são trocadas nem tomadas', () => {
    expect(applyRemap({}, 'menu', 'KeyV')).toEqual({ ok: false, reason: 'fixa' });
    expect(applyRemap({}, 'jump', 'Escape')).toEqual({ ok: false, reason: 'reservada' });
    expect(applyRemap({}, 'jump', 'Enter')).toEqual({ ok: false, reason: 'reservada' });
    for (const k of ['Escape', 'Enter', 'F1', 'F3']) expect(RESERVED_KEYS.has(k)).toBe(true);
  });

  it('tela de controles: grupos na ordem, mouse incluído, alias de foto escondido, rótulos curtos', () => {
    const g = controlsRows({});
    expect(g.map((x) => x.group)).toEqual(KEY_GROUP_ORDER.filter((k) => g.some((x) => x.group === k)));
    expect(g.map((x) => x.group)).toEqual(['MOVIMENTO', 'CÂMERA', 'INTERAÇÃO', 'VEÍCULOS', 'COMBATE', 'ITENS', 'SOCIAL', 'SISTEMA']);
    expect(g.find((x) => x.group === 'CÂMERA')!.rows.some((r) => r.mouse === 'Botão direito + arrastar')).toBe(true);
    expect(g.flatMap((x) => x.rows).some((r) => r.action === 'photo')).toBe(false);
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('Digit3')).toBe('3');
    expect(keyLabel('Space')).toBe('Espaço');
    expect(keyLabel('ShiftLeft')).toBe('Shift');
  });

  it('preferências de entrada saneadas (sensibilidade 0,25–3; invertY booleano)', () => {
    expect(sanitizeInputPrefs(null)).toEqual({ sensitivity: 1, invertY: false });
    expect(sanitizeInputPrefs({ sensitivity: 99, invertY: 'sim' })).toEqual({ sensitivity: 3, invertY: false });
    expect(sanitizeInputPrefs({ sensitivity: 0.5, invertY: true })).toEqual({ sensitivity: 0.5, invertY: true });
  });
});

describe('campo de texto (regra global)', () => {
  it('INPUT, TEXTAREA, SELECT e contentEditable seguram as teclas; botão e canvas não', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) expect(isTypingTarget({ tagName } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: 'BUTTON', isContentEditable: false } as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget({ tagName: 'CANVAS' } as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('pilha do Esc', () => {
  const offs: (() => void)[] = [];
  afterEach(() => { while (offs.length) offs.pop()!(); setEscMenu(null); });

  it('fecha só o topo pela prioridade (modal > painel > popover > chat); vazio abre o menu', () => {
    const closed: string[] = [];
    const add = (id: string, priority: number) => offs.push(pushEsc({ id, priority, close: () => closed.push(id) }));
    let menu = 0;
    setEscMenu(() => menu++);
    add('chat', 10); add('painel', 100); add('roda', 50); add('modal', 300);
    expect(escTop()?.id).toBe('modal');
    expect(handleEsc()).toBe('closed');
    expect(handleEsc()).toBe('closed');
    expect(closed).toEqual(['modal', 'painel']);
    expect(handleEsc()).toBe('closed');
    expect(handleEsc()).toBe('closed');
    expect(closed).toEqual(['modal', 'painel', 'roda', 'chat']);
    expect(handleEsc()).toBe('menu');
    expect(menu).toBe(1);
  });

  it('mesma prioridade: o aberto por último fica por cima; inventário (painel) acima do chat', () => {
    const closed: string[] = [];
    offs.push(pushEsc({ id: 'inventario', priority: 100, close: () => closed.push('inventario') }));
    offs.push(pushEsc({ id: 'chat', priority: 10, close: () => closed.push('chat') }));
    offs.push(pushEsc({ id: 'pessoa', priority: 100, close: () => closed.push('pessoa') }));
    handleEsc();
    expect(closed).toEqual(['pessoa']);
    handleEsc();
    expect(closed).toEqual(['pessoa', 'inventario']);
  });

  it('EscSlot liga/desliga sem duplicar e o fechar pelo Esc não reentra', () => {
    let n = 0;
    const s = new EscSlot('teste', 100, () => { n++; s.set(false); });
    s.set(true); s.set(true);
    expect(escLayers().filter((l) => l === 'teste')).toHaveLength(1);
    expect(handleEsc()).toBe('closed');
    expect(n).toBe(1);
    expect(escLayers()).not.toContain('teste');
    s.set(true); s.set(false);
    expect(escLayers()).not.toContain('teste');
  });

  it('listener único (captura): Esc fecha o topo e para a propagação; sem nada e sem menu, deixa passar', () => {
    const t = new EventTarget();
    installEscKey(t as unknown as Window);
    let closed = 0;
    offs.push(pushEsc({ id: 'x', priority: 100, close: () => closed++ }));
    const ev = new Event('keydown', { cancelable: true }) as Event & { key: string; code: string; repeat: boolean };
    Object.assign(ev, { key: 'Escape', code: 'Escape', repeat: false });
    let after = 0;
    t.addEventListener('keydown', () => after++);
    t.dispatchEvent(ev);
    expect(closed).toBe(1);
    expect(ev.defaultPrevented).toBe(true);
    expect(after).toBe(0); // stopImmediatePropagation: componente nenhum vê o Esc tratado
    const ev2 = new Event('keydown', { cancelable: true });
    Object.assign(ev2, { key: 'Escape', code: 'Escape', repeat: false });
    t.dispatchEvent(ev2);
    expect(ev2.defaultPrevented).toBe(false);
    expect(after).toBe(1);
  });
});

describe('mouse: clique × arrasto', () => {
  it('esquerdo parado = clique; passou do limiar = arrasto (gira a câmera e não clica)', () => {
    const g = new MouseGesture();
    g.down(0, 100, 100, 0);
    g.move(102, 101);
    expect(g.looking).toBe(false);
    expect(g.up(0, 103, 102, 120)).toBe('click');
    expect(g.consumeLook()).toEqual({ dx: 0, dy: 0 });
    g.down(0, 100, 100, 0);
    g.move(100 + CLICK_SLOP_PX + 4, 100);
    expect(g.looking).toBe(true);
    g.move(140, 110);
    expect(g.up(0, 140, 110, 300)).toBe('drag'); // arrastar sobre um jogador não abre o painel
    expect(g.consumeLook().dx).toBeGreaterThan(0);
  });

  it('esquerdo segurado demais não é clique', () => {
    const g = new MouseGesture();
    g.down(0, 10, 10, 0);
    expect(g.up(0, 10, 10, CLICK_MAX_MS + 50)).toBe('none');
  });

  it('direito: gira desde o 1º pixel, solto encerra na hora; curto não faz nada (sem menu contextual)', () => {
    const g = new MouseGesture();
    g.down(2, 50, 50, 1000);
    expect(g.looking).toBe(true);
    g.move(53, 49);
    expect(g.consumeLook()).toEqual({ dx: 3, dy: -1 });
    g.move(80, 60);
    expect(g.up(2, 80, 60, 1500)).toBe('drag');
    expect(g.looking).toBe(false);
    expect(g.lastLookEnd).toBe(1500);
    g.down(2, 50, 50, 2000);
    expect(g.up(2, 51, 50, 2050)).toBe('none');
  });

  it('acorde (dois botões): o segundo não começa outro gesto; cancelar não clica', () => {
    const g = new MouseGesture();
    expect(g.down(2, 0, 0, 0)).toBe(true);
    expect(g.down(0, 0, 0, 10)).toBe(false);
    expect(g.up(0, 0, 0, 20)).toBe('none');
    g.cancel(30);
    expect(g.active).toBe(false);
    expect(g.lastLookEnd).toBe(30);
    expect(g.down(1, 0, 0, 40)).toBe(false); // botão do meio: ignorado
  });

  it('UI consome antes do mundo: só o canvas é alvo do mundo', () => {
    const canvas = {} as EventTarget, button = {} as EventTarget;
    expect(isWorldTarget(canvas, canvas)).toBe(true);
    expect(isWorldTarget(button, canvas)).toBe(false);
    expect(isWorldTarget(null, canvas)).toBe(false);
  });
});

describe('câmera de veículo', () => {
  const step = (f: VehicleCamFollow, yaw: number, heading: number, speed: number, now: number, looking: boolean, end: number, n = 1) => {
    for (let i = 0; i < n; i++) yaw = f.step(yaw, heading, speed, 1 / 60, now + i * 16.7, looking, end, 1.5);
    return yaw;
  };
  it('anda: acompanha o rumo suavemente', () => {
    const f = new VehicleCamFollow();
    const y = step(f, 0, 1, 5, 0, false, -Infinity, 60);
    expect(y).toBeGreaterThan(0.5);
    expect(y).toBeLessThan(1);
  });
  it('parado sem olhar em volta: a câmera fica', () => {
    const f = new VehicleCamFollow();
    expect(step(f, 0, 1, 0, 0, false, -Infinity, 60)).toBe(0);
  });
  it('olhando em volta (direito segurado) nada puxa; solto, espera ~1 s e volta atrás do veículo (mesmo parado)', () => {
    const f = new VehicleCamFollow();
    let y = step(f, 2.5, 0, 6, 0, true, -Infinity, 30);
    expect(y).toBe(2.5);
    const end = 1000;
    y = step(f, y, 0, 0, end + 100, false, end, 30); // ainda dentro do atraso
    expect(y).toBe(2.5);
    y = step(f, y, 0, 0, end + RETURN_DELAY_MS + 10, false, end, 240);
    expect(Math.abs(y)).toBeLessThan(0.05);
    expect(f.returning).toBe(false);
  });
});

describe('realce: identificar de longe sem usar', () => {
  beforeAll(() => { /* puro */ });
  it('"CARRO · longe" além do dobro do alcance; perto mas fora: "chegue mais perto"', () => {
    const c = { targetLabel: 'Carro', interactionLabel: 'Entrar', availability: 'available', maxDistance: 2.4 } as Interactable;
    expect(farFor(c)).toBeCloseTo(8.8);
    expect(highlightText(c, false, true)).toBe('CARRO · longe');
    expect(highlightText(c, false, false)).toBe('CARRO · chegue mais perto');
    expect(highlightText(c, true, false)).toBe('CARRO · Entrar');
  });
});
