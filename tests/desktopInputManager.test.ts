/**
 * Rodada 11 — InputManager sem DOM real (janela/canvas = EventTarget do Node): nunca pede pointer lock; clique
 * esquerdo parado interage, arrasto não; botão direito gira a câmera; roda dá zoom; teclas pelo mapa único; campo de
 * texto segura as teclas; roda de ações aberta fica com 1–4 (sem acesso rápido); menu de contexto bloqueado.
 */
import { beforeAll, describe, expect, it } from 'vitest';

type Fake = EventTarget & Record<string, unknown>;
let InputManager: typeof import('../src/input/InputManager').InputManager;
const lockCalls: number[] = [];
const win = new EventTarget() as Fake;

beforeAll(async () => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = win;
  g.document = { activeElement: null, body: {}, pointerLockElement: null };
  ({ InputManager } = await import('../src/input/InputManager'));
});

function canvas(): Fake {
  const c = new EventTarget() as Fake;
  Object.assign(c, {
    style: {}, classList: { toggle: () => {} }, setPointerCapture: () => {}, releasePointerCapture: () => {},
    requestPointerLock: () => { lockCalls.push(1); }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
  });
  return c;
}
const ev = (type: string, o: Record<string, unknown>) => Object.assign(new Event(type, { cancelable: true }), o);
const mouse = (c: Fake, type: string, button: number, x: number, y: number, buttons = 1) => c.dispatchEvent(ev(type, { pointerType: 'mouse', button, buttons, clientX: x, clientY: y, pointerId: 1 }));
const key = (type: string, code: string, target: unknown = win) => {
  // o InputManager lê e.target: o despacho na janela falsa usa a própria janela; para campo de texto chamamos o handler
  const e = ev(type, { code, key: code, repeat: false });
  if (target === win) win.dispatchEvent(e);
  else ((im as unknown as Record<string, (e: unknown) => void>)[type === 'keydown' ? 'onKeyDown' : 'onKeyUp'])({ ...e, code, key: code, repeat: false, target, preventDefault() {} });
};
let im: InstanceType<typeof InputManager>;

describe('InputManager (desktop, cursor sempre visível)', () => {
  it('clique esquerdo parado → interação; arrasto → câmera sem interagir; nunca pointer lock', () => {
    const c = canvas();
    im = new InputManager(c as unknown as HTMLCanvasElement, false);
    const clicks: [number, number][] = [];
    im.pointFilter = (x, y) => { clicks.push([x, y]); return true; };
    mouse(c, 'pointerdown', 0, 400, 300);
    mouse(c, 'pointerup', 0, 401, 301, 0);
    expect(clicks).toEqual([[401, 301]]);
    mouse(c, 'pointerdown', 0, 400, 300);
    mouse(c, 'pointermove', 0, 460, 300);
    expect(im.looking).toBe(true);
    mouse(c, 'pointerup', 0, 470, 300, 0);
    expect(clicks).toHaveLength(1); // arrastar por cima de alguém não abre o painel
    expect(im.consumeLook().dx).toBeGreaterThan(0);
    expect(lockCalls).toHaveLength(0);
    im.requestLock();
    expect(lockCalls).toHaveLength(0);
    expect(im.pointerLocked).toBe(false);
  });

  it('botão direito arrastando gira (yaw muda) e soltar para; nada de soco/chute pelo mouse', () => {
    const c = canvas();
    const m = new InputManager(c as unknown as HTMLCanvasElement, false);
    m.pointFilter = () => { throw new Error('direito não interage'); };
    mouse(c, 'pointerdown', 2, 600, 300, 2);
    mouse(c, 'pointermove', 2, 650, 280, 2);
    expect(m.looking).toBe(true);
    const l = m.consumeLook();
    expect(l.dx).toBeGreaterThan(0);
    expect(l.dy).toBeLessThan(0);
    mouse(c, 'pointerup', 2, 650, 280, 0);
    expect(m.looking).toBe(false);
    mouse(c, 'pointermove', 2, 700, 280, 0);
    expect(m.consumeLook()).toEqual({ dx: 0, dy: 0 });
    expect(m.consumeToggle('cbt_punch')).toBe(false);
    expect(m.consumeToggle('cbt_kick')).toBe(false);
    const cm = ev('contextmenu', {});
    c.dispatchEvent(cm);
    expect(cm.defaultPrevented).toBe(true);
  });

  it('roda = zoom; toque não usa o gesto do mouse', () => {
    const c = canvas();
    const m = new InputManager(c as unknown as HTMLCanvasElement, false);
    c.dispatchEvent(ev('wheel', { deltaY: 120 }));
    expect(m.consumeZoom()).toBeGreaterThan(0);
    const t = canvas();
    const mt = new InputManager(t as unknown as HTMLCanvasElement, true);
    let hit = 0;
    mt.pointFilter = () => { hit++; return true; };
    mouse(t, 'pointerdown', 0, 1, 1);
    mouse(t, 'pointerup', 0, 1, 1, 0);
    expect(hit).toBe(0);
  });

  it('teclas pelo mapa: R/Q/C/F, E, I, 1–5; roda aberta fica com 1–4; campo de texto segura tudo', () => {
    const c = canvas();
    im = new InputManager(c as unknown as HTMLCanvasElement, false);
    for (const [code, t] of [['KeyR', 'cbt_punch'], ['KeyQ', 'cbt_kick'], ['KeyC', 'cbt_dodge'], ['KeyF', 'action'], ['KeyE', 'use'], ['KeyI', 'inventory'], ['Digit2', 'quick_2']]) {
      key('keydown', code); key('keyup', code);
      expect(im.consumeToggle(t), code).toBe(true);
    }
    let wheelOpen = true;
    im.quickBlocked = () => wheelOpen;
    key('keydown', 'Digit1'); key('keyup', 'Digit1');
    expect(im.consumeToggle('quick_1')).toBe(false);
    wheelOpen = false;
    key('keydown', 'Digit1'); key('keyup', 'Digit1');
    expect(im.consumeToggle('quick_1')).toBe(true);
    key('keydown', 'KeyW');
    expect(im.moveAxis().y).toBe(1);
    key('keyup', 'KeyW');
    // digitando no chat (INPUT) ou num seletor (SELECT): WASD não move, R não soca
    for (const tagName of ['INPUT', 'SELECT', 'TEXTAREA']) {
      key('keydown', 'KeyW', { tagName });
      key('keydown', 'KeyR', { tagName });
      expect(im.moveAxis().y).toBe(0);
      expect(im.consumeToggle('cbt_punch')).toBe(false);
    }
  });

  it('sensibilidade e eixo Y invertido aplicados no olhar do mouse', () => {
    const c = canvas();
    const m = new InputManager(c as unknown as HTMLCanvasElement, false);
    m.sensitivity = 0.01; m.invertY = true;
    mouse(c, 'pointerdown', 2, 0, 0, 2);
    mouse(c, 'pointermove', 2, 10, 10, 2);
    const l = m.consumeLook();
    expect(l.dx).toBeCloseTo(0.1);
    expect(l.dy).toBeCloseTo(-0.1);
  });
});
