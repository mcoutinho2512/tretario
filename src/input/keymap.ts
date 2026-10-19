/**
 * Rodada 11 — CONTRATO: mapa de teclas ÚNICO (docs/DESKTOP_CONTROLS.md). Desktop first, cursor sempre visível:
 * o mouse é interface (clique esquerdo seleciona/interage; botão direito arrastando gira a câmera; roda = zoom) e
 * NUNCA é capturado por padrão. Toda tecla de jogo sai daqui: InputManager, tela de Controles e remapeamento.
 * Acrescentar ações no FIM; ids estáveis (persistidos em remapeamentos locais).
 */
export type GameAction =
  | 'move_forward' | 'move_back' | 'move_left' | 'move_right' | 'run' | 'jump'
  | 'use' | 'pickup' | 'drop' | 'stow' | 'push' | 'wheel' | 'mode'
  | 'punch' | 'kick' | 'dodge'
  | 'map' | 'clean_hud' | 'photo' | 'controls' | 'debug'
  | 'inventory' | 'quick_1' | 'quick_2' | 'quick_3' | 'quick_4' | 'quick_5'
  | 'chat' | 'menu';

export type KeyGroup = 'MOVIMENTO' | 'CÂMERA' | 'INTERAÇÃO' | 'VEÍCULOS' | 'COMBATE' | 'ITENS' | 'SOCIAL' | 'SISTEMA';

export interface KeyBinding {
  action: GameAction;
  label: string;
  group: KeyGroup;
  /** códigos KeyboardEvent.code (o primeiro é o exibido) */
  keys: string[];
  /** pode ser remapeado pelo jogador (Esc/Enter/F-keys de sistema não) */
  remappable: boolean;
}

export const DEFAULT_KEYMAP: readonly KeyBinding[] = [
  { action: 'move_forward', label: 'Andar para a frente / acelerar', group: 'MOVIMENTO', keys: ['KeyW', 'ArrowUp'], remappable: true },
  { action: 'move_back', label: 'Andar para trás / frear e ré', group: 'MOVIMENTO', keys: ['KeyS', 'ArrowDown'], remappable: true },
  { action: 'move_left', label: 'Esquerda / virar', group: 'MOVIMENTO', keys: ['KeyA', 'ArrowLeft'], remappable: true },
  { action: 'move_right', label: 'Direita / virar', group: 'MOVIMENTO', keys: ['KeyD', 'ArrowRight'], remappable: true },
  { action: 'run', label: 'Correr / mais rápido no veículo', group: 'MOVIMENTO', keys: ['ShiftLeft', 'ShiftRight'], remappable: true },
  { action: 'jump', label: 'Pular', group: 'MOVIMENTO', keys: ['Space'], remappable: true },
  { action: 'use', label: 'Usar / entrar / sair (atalho do clique)', group: 'INTERAÇÃO', keys: ['KeyE'], remappable: true },
  { action: 'pickup', label: 'Pegar item do chão', group: 'ITENS', keys: ['KeyT'], remappable: true },
  { action: 'drop', label: 'Largar item', group: 'ITENS', keys: ['KeyZ'], remappable: true },
  { action: 'stow', label: 'Guardar / sacar item', group: 'ITENS', keys: ['KeyX'], remappable: true },
  { action: 'inventory', label: 'Inventário', group: 'ITENS', keys: ['KeyI'], remappable: true },
  { action: 'quick_1', label: 'Acesso rápido 1', group: 'ITENS', keys: ['Digit1'], remappable: true },
  { action: 'quick_2', label: 'Acesso rápido 2', group: 'ITENS', keys: ['Digit2'], remappable: true },
  { action: 'quick_3', label: 'Acesso rápido 3', group: 'ITENS', keys: ['Digit3'], remappable: true },
  { action: 'quick_4', label: 'Acesso rápido 4', group: 'ITENS', keys: ['Digit4'], remappable: true },
  { action: 'quick_5', label: 'Acesso rápido 5', group: 'ITENS', keys: ['Digit5'], remappable: true },
  { action: 'punch', label: 'Soco / golpe do item', group: 'COMBATE', keys: ['KeyR'], remappable: true },
  { action: 'kick', label: 'Chute', group: 'COMBATE', keys: ['KeyQ'], remappable: true },
  { action: 'dodge', label: 'Esquiva', group: 'COMBATE', keys: ['KeyC'], remappable: true },
  { action: 'push', label: 'Empurrão', group: 'COMBATE', keys: ['KeyF'], remappable: true },
  { action: 'mode', label: 'Modo pacífico / interação', group: 'COMBATE', keys: ['KeyK'], remappable: true },
  { action: 'wheel', label: 'Roda de ações (gestos, danças, itens)', group: 'SOCIAL', keys: ['KeyG'], remappable: true },
  { action: 'chat', label: 'Chat (Enter abre, Esc sai)', group: 'SOCIAL', keys: ['Enter'], remappable: false },
  { action: 'map', label: 'Mapa', group: 'SISTEMA', keys: ['KeyM'], remappable: true },
  { action: 'clean_hud', label: 'HUD limpo (foto)', group: 'SISTEMA', keys: ['KeyH', 'KeyP'], remappable: true },
  { action: 'photo', label: 'HUD limpo (foto)', group: 'SISTEMA', keys: [], remappable: false },
  { action: 'controls', label: 'Tela de controles', group: 'SISTEMA', keys: ['F1'], remappable: false },
  { action: 'debug', label: 'Painel de desempenho', group: 'SISTEMA', keys: ['F3'], remappable: false },
  { action: 'menu', label: 'Fecha o painel aberto / menu do jogo', group: 'SISTEMA', keys: ['Escape'], remappable: false },
];

/** controles de MOUSE (exibidos na tela de Controles; não remapeáveis nesta rodada) */
export const MOUSE_CONTROLS: readonly { label: string; group: KeyGroup; input: string }[] = [
  { label: 'Selecionar / interagir (veículo, item, pessoa, botões)', group: 'INTERAÇÃO', input: 'Clique esquerdo' },
  { label: 'Girar a câmera (o cursor continua visível)', group: 'CÂMERA', input: 'Botão direito + arrastar' },
  { label: 'Aproximar / afastar', group: 'CÂMERA', input: 'Roda do mouse' },
  { label: 'Olhar em volta dirigindo (volta atrás do veículo ao soltar)', group: 'VEÍCULOS', input: 'Botão direito + arrastar' },
];

/** limiar clique × arrasto (px e ms) — mesmo para mouse e toque */
export const CLICK_SLOP_PX = 6;
export const CLICK_MAX_MS = 400;

const STORE = 'pv3d.keys';
/** remapeamentos locais (ação → códigos); só ações `remappable` */
export function loadKeyOverrides(): Partial<Record<GameAction, string[]>> {
  try { const v = JSON.parse(localStorage.getItem(STORE) ?? '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
export function saveKeyOverrides(o: Partial<Record<GameAction, string[]>>) { try { localStorage.setItem(STORE, JSON.stringify(o)); } catch { /* sem armazenamento */ } }

/** mapa efetivo código → ação (padrão + remapeamentos; conflito: o remapeado vence e o padrão sai) */
export function resolveKeymap(over: Partial<Record<GameAction, string[]>> = loadKeyOverrides()): Map<string, GameAction> {
  const m = new Map<string, GameAction>();
  for (const b of DEFAULT_KEYMAP) for (const k of (b.remappable && over[b.action]) || b.keys) m.set(k, b.action);
  for (const b of DEFAULT_KEYMAP) if (b.remappable && over[b.action]) for (const k of over[b.action]!) m.set(k, b.action);
  return m;
}

/** foco em campo de texto: atalhos de jogo não valem (regra global) */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable === true;
}

// ---------------------------------------------------------------- rodada 11 (agente A) — acréscimos
/** nome do "toggle" do InputManager que cada ação de toque único dispara (o Game/CombatClient consomem por nome) */
export const ACTION_TOGGLE: Partial<Record<GameAction, string>> = {
  use: 'use', pickup: 'item', drop: 'drop', stow: 'stow', push: 'action', wheel: 'wheel', mode: 'mode',
  punch: 'cbt_punch', kick: 'cbt_kick', dodge: 'cbt_dodge', map: 'map', clean_hud: 'help', photo: 'photo',
  controls: 'controls', debug: 'debug', inventory: 'inventory',
  quick_1: 'quick_1', quick_2: 'quick_2', quick_3: 'quick_3', quick_4: 'quick_4', quick_5: 'quick_5',
};

export const BINDING_BY_ACTION: ReadonlyMap<GameAction, KeyBinding> = new Map(DEFAULT_KEYMAP.map((b) => [b.action, b]));

type Overrides = Partial<Record<GameAction, string[]>>;

/** teclas efetivas de uma ação (padrão ou remapeada; uma tecla tomada por outro remapeamento sai daqui) */
export function keysFor(action: GameAction, over: Overrides = loadKeyOverrides()): string[] {
  const b = BINDING_BY_ACTION.get(action);
  if (!b) return [];
  const m = resolveKeymap(over);
  return ((b.remappable && over[action]) || b.keys).filter((k) => m.get(k) === action);
}

/** códigos reservados (sistema): não podem ir para outra ação */
export const RESERVED_KEYS: ReadonlySet<string> = new Set(DEFAULT_KEYMAP.filter((b) => !b.remappable).flatMap((b) => b.keys).concat(['Tab', 'MetaLeft', 'MetaRight']));

export type RemapResult =
  | { ok: true; over: Overrides; conflict: GameAction | null; applied: boolean }
  | { ok: false; reason: 'reservada' | 'fixa' };

/**
 * troca a tecla PRINCIPAL de `action` por `code` (as secundárias, ex.: setas, continuam). Conflito (`code` já é de
 * outra ação): sem `force` devolve `conflict` sem mudar nada (a tela pergunta); com `force` a outra perde essa tecla.
 */
export function applyRemap(over: Overrides, action: GameAction, code: string, force = false): RemapResult {
  const b = BINDING_BY_ACTION.get(action);
  if (!b || !b.remappable) return { ok: false, reason: 'fixa' };
  if (RESERVED_KEYS.has(code)) return { ok: false, reason: 'reservada' };
  const owner = resolveKeymap(over).get(code) ?? null;
  const conflict = owner && owner !== action ? owner : null;
  if (conflict && !force) return { ok: true, over, conflict, applied: false };
  const next: Overrides = { ...over };
  const cur = keysFor(action, over);
  next[action] = [code, ...cur.slice(1).filter((k) => k !== code)];
  if (conflict) next[conflict] = keysFor(conflict, over).filter((k) => k !== code); // pode ficar sem tecla (a tela avisa)
  return { ok: true, over: next, conflict, applied: true };
}

/**
 * teclas declaradas para mais de uma ação (padrão + remapeamentos, antes de resolver). O mapa padrão não tem nenhuma;
 * um remapeamento salvo por versão antiga pode ter — `resolveKeymap` dá a tecla ao remapeado e a tela avisa.
 */
export function keymapConflicts(over: Overrides = {}): { code: string; actions: GameAction[] }[] {
  const by = new Map<string, Set<GameAction>>();
  for (const b of DEFAULT_KEYMAP) for (const k of (b.remappable && over[b.action]) || b.keys) {
    let s = by.get(k);
    if (!s) by.set(k, (s = new Set()));
    s.add(b.action);
  }
  const out: { code: string; actions: GameAction[] }[] = [];
  for (const [code, s] of by) if (s.size > 1) out.push({ code, actions: [...s] });
  return out;
}

const KEY_NAMES: Record<string, string> = {
  Space: 'Espaço', Enter: 'Enter', Escape: 'Esc', ShiftLeft: 'Shift', ShiftRight: 'Shift dir.', ControlLeft: 'Ctrl', ControlRight: 'Ctrl dir.',
  AltLeft: 'Alt', AltRight: 'Alt dir.', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Tab: 'Tab', Backspace: '⌫',
  CapsLock: 'Caps', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: 'Ç', Quote: "'",
  Backslash: '\\', Comma: ',', Period: '.', Slash: ';', IntlBackslash: '\\',
};
/** rótulo curto de um KeyboardEvent.code ("KeyW" → "W", "Digit1" → "1", "Space" → "Espaço") */
export function keyLabel(code: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`;
  return code;
}

export const KEY_GROUP_ORDER: readonly KeyGroup[] = ['MOVIMENTO', 'CÂMERA', 'INTERAÇÃO', 'VEÍCULOS', 'COMBATE', 'ITENS', 'SOCIAL', 'SISTEMA'];

export interface ControlsRow { action?: GameAction; label: string; keys: string[]; mouse?: string; remappable: boolean }

/** linhas da tela de Controles por grupo (teclas efetivas + mouse); `photo` é alias de `clean_hud` e não aparece */
export function controlsRows(over: Overrides = {}): { group: KeyGroup; rows: ControlsRow[] }[] {
  return KEY_GROUP_ORDER.map((kg) => ({
    group: kg,
    rows: [
      ...DEFAULT_KEYMAP.filter((b) => b.group === kg && b.action !== 'photo').map((b): ControlsRow => ({ action: b.action, label: b.label, keys: keysFor(b.action, over), remappable: b.remappable })),
      ...MOUSE_CONTROLS.filter((m) => m.group === kg).map((m): ControlsRow => ({ label: m.label, keys: [], mouse: m.input, remappable: false })),
      ...(kg === 'VEÍCULOS' ? [
        { label: 'Dirigir: acelerar / frear / virar (as teclas de andar)', keys: ['move_forward', 'move_back', 'move_left', 'move_right'].map((a) => keysFor(a as GameAction, over)[0]).filter(Boolean), remappable: false },
        { label: 'Sair do veículo (ou o botão SAIR do HUD)', keys: keysFor('use', over), remappable: false },
      ] : []),
    ],
  })).filter((g) => g.rows.length > 0);
}
