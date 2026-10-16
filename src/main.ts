/**
 * Entrada leve: mostra a tela inicial imediatamente; o motor (three.js + jogo) é carregado sob demanda
 * em um chunk separado (pré-buscado em segundo plano enquanto o jogador monta o personagem).
 * A prévia 3D do avatar (src/ui/AvatarPreview) usa o mesmo three.js e o mesmo personagem do jogo.
 */
import './ui/style.css';
import './ui/start.css';
import { detectQuality, loadQualityChoice, saveQualityChoice, resolveQualityChoice, type QualityChoice } from './core/qualityChoice';
import {
  ACCESSORIES, BOTTOMS, DEFAULT_PLAYER_APPEARANCE, HAIR_OLD, HAIR_YOUNG, SHOES, SKIN_TONES, TOPS, randomAppearance,
  type Accessory, type BodyType, type CharacterAppearance,
} from './characters/bodyTypes';
import type { AvatarPreview, PreviewPose } from './ui/AvatarPreview';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const start = $('start'), loading = $('loading'), errorEl = $('error');
const btn = $<HTMLButtonElement>('explore');
const fill = $('bar-fill'), label = $('loading-label');
const params = new URLSearchParams(location.search);
const autostart = params.get('autostart') === '1';

const enginePromise = import('./core/Game');
enginePromise.then(() => { btn.disabled = false; btn.querySelector('span')!.textContent = 'Explorar a avenida'; }).catch((e) => showError(e));

// ------------------------------------------------------------------ aparência (salva no navegador)
const BODIES: BodyType[] = ['homem', 'mulher', 'idoso', 'idosa'];
const ACC_COLORS = [0x1f1f1f, 0x2b4a7a, 0x8a2a2a, 0xd8d0c0, 0x3d6b3d, 0x6b4a2a, 0xe0b030];
const ACC_LABEL: Record<Accessory, string> = { nenhum: 'Nenhum', bone: 'Boné', chapeu: 'Chapéu', oculos: 'Óculos', mochila: 'Mochila', bolsa: 'Bolsa' };
const PALETTES = { skin: SKIN_TONES, hair: [...HAIR_YOUNG, ...HAIR_OLD], top: TOPS, bottom: BOTTOMS, shoes: SHOES, acc: ACC_COLORS };
type ColorKey = keyof typeof PALETTES;
const isOld = (b: BodyType) => b === 'idoso' || b === 'idosa';

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* sem storage */ } },
};

function loadLook(): CharacterAppearance {
  let body = (store.get('pv3d.avatar') as BodyType) || 'homem';
  const urlAvatar = params.get('avatar') as BodyType | null;
  if (urlAvatar && BODIES.includes(urlAvatar)) body = urlAvatar;
  if (!BODIES.includes(body)) body = 'homem';
  const base: CharacterAppearance = { ...DEFAULT_PLAYER_APPEARANCE[body], accessory: 'nenhum', acc: ACC_COLORS[0] };
  try {
    const saved = JSON.parse(store.get('pv3d.look') ?? 'null') as Partial<CharacterAppearance> | null;
    if (saved && typeof saved === 'object') {
      for (const k of Object.keys(PALETTES) as ColorKey[]) if (typeof saved[k] === 'number') base[k] = saved[k] as number;
      if (ACCESSORIES.includes(saved.accessory as Accessory)) base.accessory = saved.accessory;
    }
  } catch { /* ignora dado inválido */ }
  return { ...base, body, scale: 1 };
}
let look = loadLook();
const saveLook = () => { store.set('pv3d.look', JSON.stringify(look)); store.set('pv3d.avatar', look.body); };

// ------------------------------------------------------------------ qualidade, ajuda
const saved = loadQualityChoice();
const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[name=q]'));
radios.forEach((r) => { r.checked = r.value === saved; });
$('detected').textContent = `Automático detectou: ${({ low: 'Baixo', medium: 'Médio', high: 'Alto', ultra: 'Ultra' } as const)[detectQuality()]}`;

const pops: [HTMLElement, HTMLElement][] = [[$('btn-settings'), $('settings-pop')], [$('btn-help'), $('help-pop')]];
for (const [b, pop] of pops) {
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = pop.classList.contains('hidden');
    for (const [b2, p2] of pops) { p2.classList.add('hidden'); b2.setAttribute('aria-expanded', 'false'); }
    pop.classList.toggle('hidden', !open);
    b.setAttribute('aria-expanded', String(open));
  });
  pop.addEventListener('click', (e) => e.stopPropagation());
}
const closePops = () => pops.forEach(([b, p]) => { p.classList.add('hidden'); b.setAttribute('aria-expanded', 'false'); });
document.addEventListener('click', closePops);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePops(); });

// ------------------------------------------------------------------ montagem do personagem
let preview: AvatarPreview | null = null;
const avatarRadios = Array.from(document.querySelectorAll<HTMLInputElement>('input[name=av]'));
const nameInput = $<HTMLInputElement>('player-name');
nameInput.value = params.get('name') ?? store.get('pv3d.name') ?? '';
nameInput.addEventListener('input', () => {
  nameInput.value = nameInput.value.replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 20);
  store.set('pv3d.name', nameInput.value.trim());
});

function renderSwatches() {
  for (const el of document.querySelectorAll<HTMLElement>('.swatches[data-key]')) {
    const key = el.dataset.key as ColorKey;
    if (!el.childElementCount) {
      for (const c of PALETTES[key]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'swatch';
        b.style.background = `#${c.toString(16).padStart(6, '0')}`;
        b.dataset.color = String(c);
        b.setAttribute('aria-label', `cor #${c.toString(16).padStart(6, '0')}`);
        b.addEventListener('click', () => { look = { ...look, [key]: c }; changed(key !== 'acc'); });
        el.appendChild(b);
      }
    }
    for (const b of el.children as HTMLCollectionOf<HTMLElement>) b.setAttribute('aria-pressed', String(Number(b.dataset.color) === look[key]));
  }
  const chips = $('acc-chips');
  if (!chips.childElementCount) {
    for (const a of ACCESSORIES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.acc = a;
      b.textContent = ACC_LABEL[a];
      b.addEventListener('click', () => { look = { ...look, accessory: a }; changed(false); });
      chips.appendChild(b);
    }
  }
  for (const b of chips.children as HTMLCollectionOf<HTMLElement>) b.setAttribute('aria-pressed', String(b.dataset.acc === (look.accessory ?? 'nenhum')));
  document.querySelector('.acc-colors')!.classList.toggle('hidden', (look.accessory ?? 'nenhum') === 'nenhum');
  avatarRadios.forEach((r) => { r.checked = r.value === look.body; });
}

/** aparência que cada retrato mostra: as cores atuais, com cabelo coerente com a idade do corpo */
const lookFor = (body: BodyType): CharacterAppearance =>
  ({ ...look, body, hair: isOld(body) === HAIR_OLD.includes(look.hair) ? look.hair : DEFAULT_PLAYER_APPEARANCE[body].hair });

let portraitTimer = 0;
function schedulePortraits() {
  clearTimeout(portraitTimer);
  portraitTimer = window.setTimeout(() => {
    if (!preview) return;
    const urls = preview.portraits(BODIES.map(lookFor));
    BODIES.forEach((b, i) => { const img = document.querySelector<HTMLImageElement>(`img[data-portrait=${b}]`); if (img) img.src = urls[i]; });
  }, 220);
}

function changed(portraitsToo: boolean) {
  saveLook();
  renderSwatches();
  preview?.setAppearance(look);
  if (portraitsToo) schedulePortraits();
}

avatarRadios.forEach((r) => r.addEventListener('change', () => {
  if (!r.checked) return;
  look = lookFor(r.value as BodyType);
  changed(false);
}));

$('randomize').addEventListener('click', () => {
  const r = randomAppearance((Math.random() * 2 ** 32) >>> 0, look.body);
  look = { ...r, scale: 1, accessory: r.accessory ?? 'nenhum', acc: r.acc ?? ACC_COLORS[0] };
  changed(true);
});

for (const b of document.querySelectorAll<HTMLButtonElement>('.pose-btn[data-pose]')) {
  b.addEventListener('click', () => {
    preview?.setPose(b.dataset.pose as PreviewPose);
    for (const o of document.querySelectorAll('.pose-btn[data-pose]')) o.setAttribute('aria-pressed', String(o === b));
  });
}
for (const b of document.querySelectorAll<HTMLButtonElement>('.pose-btn[data-rot]')) {
  b.addEventListener('click', () => preview?.rotate(Number(b.dataset.rot) * Math.PI / 4));
}

renderSwatches();
if (!autostart) {
  import('./ui/AvatarPreview')
    .then(({ AvatarPreview }) => {
      preview = new AvatarPreview($<HTMLCanvasElement>('avatar-canvas'), look);
      $('preview-loading').classList.add('hidden');
      schedulePortraits();
      (window as any).__pvStart = { preview, look: () => look };
    })
    .catch((e) => { console.warn('[prévia] indisponível', e); $('preview-loading').textContent = 'Prévia 3D indisponível neste navegador'; });
}

// ------------------------------------------------------------------ jogo
function showError(e: unknown) {
  console.error(e);
  start.classList.add('hidden');
  loading.classList.add('hidden');
  errorEl.classList.remove('hidden');
  $('error-msg').textContent = e instanceof Error ? e.message : String(e);
}

async function launch(choice: QualityChoice) {
  saveQualityChoice(choice);
  saveLook();
  // libera o contexto WebGL da prévia antes de o jogo criar o seu
  preview?.dispose();
  preview = null;
  start.classList.add('hidden');
  loading.classList.remove('hidden');
  try {
    const { Game } = await enginePromise;
    const game = new Game($('app'), resolveQualityChoice(choice), { ...look });
    game.playerName = nameInput.value.trim();
    await game.load((f, l) => {
      fill.style.width = `${Math.round(f * 100)}%`;
      label.textContent = l;
    });
    loading.classList.add('hidden');
    game.start();
    (window as any).__pv = game.debugApi();
  } catch (e) {
    showError(e);
  }
}

btn.addEventListener('click', () => {
  const choice = (radios.find((r) => r.checked)?.value ?? 'auto') as QualityChoice;
  void launch(choice);
});

// automação/validação: ?autostart=1&quality=high
if (autostart) {
  const q = (params.get('quality') ?? 'auto') as QualityChoice;
  enginePromise.then(() => launch(q));
}
