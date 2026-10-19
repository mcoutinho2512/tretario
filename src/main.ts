/**
 * Entrada leve (rodada 8): tela INICIAL imediata (avenida ao fundo, evento atual, pessoas pelo servidor) com
 * ASSISTIR GRÁTIS (espectador, sem conta), PARTICIPAR (conta → personagem → grupo → avenida) e ENTRAR.
 * O motor (three.js + jogo) é pré-buscado em segundo plano num chunk separado; a prévia 3D do editor
 * (src/ui/AvatarPreview) só carrega quando o editor abre. A identidade vem do servidor (cookie HttpOnly + GET /api/me);
 * o localStorage guarda só o visual de VISITANTE (sem conta/sem servidor) e a qualidade gráfica.
 */
import './debug/memProbe'; // sondas de memória (WASM; GPU com ?mem=1) — antes de qualquer módulo WASM/WebGL
performance.mark('pv:script');
import './ui/style.css';
import './ui/start.css';
import './ui/home.css';
import { deviceProfile } from './core/settings';
import { loadQualityChoice, saveQualityChoice, resolveQualityChoice, type QualityChoice } from './core/qualityChoice';
import {
  ACCESSORIES, BOTTOMS, DEFAULT_PLAYER_APPEARANCE, HAIR_OLD, HAIR_YOUNG, SHOES, SKIN_TONES, TOPS, randomAppearance,
  type Accessory, type BodyType, type CharacterAppearance,
} from './characters/bodyTypes';
import { SLOT_FIELD, STYLE_LABELS, resolveStyle, stylesFor, type GarmentSlot } from './characters/garments';
import { validateAppearance, sameAppearance } from './characters/validateAppearance';
import { DESIGNS, DESIGN_BY_ID, registerCampaigns } from './social/designs';
import type { AvatarPreview, PreviewPose } from './ui/AvatarPreview';
import type { Game, GameStartOptions } from './core/Game';
import type { MeResponse, WorldRole } from './identity/types';
import { can } from './access/policy';
import { accountApi, errorText } from './identity/client';
import { groupDesigns, withGroupShirt, type CurrentEventResponse, type PublicGroup } from './events/groups';
import { AccountDialog } from './ui/accountDialog';
import { GroupPicker } from './ui/groupPicker';
import { SupporterPicker, shirtSwatch } from './ui/supporterPicker'; // rodada 10 — torcidas
import { loadSupporterData, supporterGroup, supporterOutfit } from './supporters/data'; // rodada 10 — torcidas
import { localSupporter, setLocalSupporter } from './supporters/session'; // rodada 10 — torcida sem conta (só a sessão)
import { metricsLine } from './ui/metricsText';
import { openCharacterEditor, registerCharacterEditor } from './ui/editorBridge';
import { registerInventoryAccount } from './inventory/accountBridge'; // rodada 11 — inventário
import type { EventDef } from './events/types';
// rodada 9 — recompensas: itens bloqueados no editor (cadeado + requisito); direitos vêm do servidor (GET /api/me/progress)
import { isAvailable, localEntitlements, setLocalEntitlements, type ItemKey } from './characters/unlocks';
import { parseCatalog, requirementOf, type ProgressionCatalog } from './progression/engine';
import { gameEndpoint } from './net/endpoint'; // rodada 9.1 — produção: wss://<host>/game (mesma origem)
import './ui/beta.css';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const appEl = $('app');
const home = $('home'), start = $('start'), loading = $('loading'), errorEl = $('error');
const btn = $<HTMLButtonElement>('explore');
const watchBtn = $<HTMLButtonElement>('btn-watch');
const fill = $('bar-fill'), label = $('loading-label');
const params = new URLSearchParams(location.search);
const autostart = params.get('autostart') === '1' || params.get('bench') === '1';
/** servidor do mundo compartilhado: ?mp=ws://… (QA), ?mp=off (sem rede); padrão: dev ws://<host>:2567 · produção wss://<host>/game */
const MP = params.get('mp') === 'off' ? undefined : params.get('mp') && params.get('mp') !== '1' ? params.get('mp')! : gameEndpoint();

const enginePromise = import('./core/Game');
enginePromise.then(() => { watchBtn.disabled = false; btn.disabled = false; }).catch((e) => showError(e));
// campanhas são DADOS (mesmo arquivo do jogo): artes dos grupos na escolha de grupo
void fetch('/designs/campaigns.json').then((r) => (r.ok ? r.json() : [])).then(registerCampaigns).catch(() => {});

// ------------------------------------------------------------------ estado da conta (servidor = fonte da verdade)
let me: MeResponse | null = null;
let ev: CurrentEventResponse | null = null;
let game: Game | null = null;
const authed = () => !!me?.authenticated;
const nick = () => me?.user?.nickname ?? '';

// ------------------------------------------------------------------ aparência
const BODIES: BodyType[] = ['homem', 'mulher', 'idoso', 'idosa'];
const ACC_COLORS = [0x1f1f1f, 0x2b4a7a, 0x8a2a2a, 0xd8d0c0, 0x3d6b3d, 0x6b4a2a, 0xe0b030];
const ACC_LABEL: Record<Accessory, string> = { nenhum: 'Nenhum', bone: 'Boné', chapeu: 'Chapéu', oculos: 'Óculos', mochila: 'Sacola', bolsa: 'Bolsa' };
const PALETTES = { skin: SKIN_TONES, hair: [...HAIR_YOUNG, ...HAIR_OLD], top: TOPS, bottom: BOTTOMS, shoes: SHOES, acc: ACC_COLORS };
type ColorKey = keyof typeof PALETTES;
const isOld = (b: BodyType) => b === 'idoso' || b === 'idosa';
/** camada da peça → prefixo do ItemKey (src/characters/unlocks.ts) */
const STYLE_ITEM: Record<GarmentSlot, string> = { SHIRT: 'top', PANTS: 'bottom', SHOES: 'shoes', HAIR: 'hair' };
/** camisas de futebol: só cores/padrões (designs.ts, alvo 'shirt') */
const SHIRT_DESIGNS = DESIGNS.filter((d) => d.targets.includes('shirt'));

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* sem storage */ } },
};

/** validador ÚNICO com os direitos da conta (rodada 9): o que se vê no editor é o que o servidor aceita */
function vApp(raw: unknown) { return validateAppearance(raw, null, localEntitlements); }

// ------------------------------------------------------------------ rodada 9 — itens liberados por progressão
let progCat: ProgressionCatalog | null = null;
async function refreshUnlocks() {
  if (!progCat) {
    const get = (f: string) => fetch(`/gameplay/${f}`).then((r) => (r.ok ? r.json() : undefined)).catch(() => undefined);
    const [missions, achievements, levels, rewards] = await Promise.all(['missions.json', 'achievements.json', 'levels.json', 'rewards.json'].map(get));
    progCat = parseCatalog({ missions, achievements, levels, rewards });
  }
  if (!authed()) return;
  const r = await fetch('/api/me/progress', { credentials: 'same-origin' }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
  if (r && Array.isArray(r.unlocks)) setLocalEntitlements(r.unlocks);
}
/** item bloqueado: marca o botão (cadeado + requisito); devolve o requisito ou '' */
function lockState(b: HTMLElement, item: string): string {
  const locked = !isAvailable(item as ItemKey, localEntitlements);
  const req = locked ? (progCat ? requirementOf(progCat, item) : 'Bloqueado') : '';
  b.classList.toggle('locked', locked);
  if (locked) b.title = `Bloqueado — ${req}`; else b.removeAttribute('title');
  return req;
}
/** clique num item bloqueado: explica o requisito e não troca */
function blocked(item: string): boolean {
  if (isAvailable(item as ItemKey, localEntitlements)) return false;
  setNote(`Bloqueado — ${progCat ? requirementOf(progCat, item) : 'liberado por progressão'}. Veja em ☰ → Progresso, na avenida.`, 'bad');
  return true;
}

/** visual de VISITANTE guardado no navegador (fallback sem conta/sem servidor) */
function loadLocalLook(): CharacterAppearance {
  let body = (store.get('pv3d.avatar') as BodyType) || 'homem';
  const urlAvatar = params.get('avatar') as BodyType | null;
  if (urlAvatar && BODIES.includes(urlAvatar)) body = urlAvatar;
  if (!BODIES.includes(body)) body = 'homem';
  let saved: unknown = null;
  try { saved = JSON.parse(store.get('pv3d.look') ?? 'null'); } catch { /* ignora */ }
  const base = { ...DEFAULT_PLAYER_APPEARANCE[body], accessory: 'nenhum' as Accessory, acc: ACC_COLORS[0] };
  return vApp(saved && typeof saved === 'object' ? { ...base, ...saved, body } : base) ?? base;
}
let look = loadLocalLook();
/** último visual salvo no servidor (para "alterações não salvas") */
let savedLook: CharacterAppearance | null = null;
const saveLocalLook = () => { if (!authed()) { store.set('pv3d.look', JSON.stringify(look)); store.set('pv3d.avatar', look.body); } };

// ------------------------------------------------------------------ qualidade, ajuda
const savedQ = loadQualityChoice();
const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[name=q]'));
const homeQ = $<HTMLSelectElement>('home-quality');
radios.forEach((r) => { r.checked = r.value === savedQ; });
homeQ.value = savedQ;
const qualityChoice = () => homeQ.value as QualityChoice;
function setQuality(q: QualityChoice, persist: boolean) {
  homeQ.value = q;
  radios.forEach((r) => { r.checked = r.value === q; });
  saveQualityChoice(q);
  if (persist && authed()) void accountApi.putPreferences({ quality: q });
}
homeQ.addEventListener('change', () => setQuality(qualityChoice(), true));
radios.forEach((r) => r.addEventListener('change', () => { if (r.checked) setQuality(r.value as QualityChoice, true); }));
$('detected').textContent = deviceProfile().label;
requestAnimationFrame(() => performance.mark('pv:home'));

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

// ------------------------------------------------------------------ editor de personagem
let preview: AvatarPreview | null = null;
const avatarRadios = Array.from(document.querySelectorAll<HTMLInputElement>('input[name=av]'));
const nameInput = $<HTMLInputElement>('player-name');
const note = $('editor-note');
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
        b.addEventListener('click', () => {
          look = { ...look, [key]: c };
          if (key === 'top') look.shirtDesign = 0; // cor lisa escolhida: sai da camisa de time
          changed(key !== 'acc');
        });
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
      b.addEventListener('click', () => { if (blocked(`acc:${a}`)) return; look = { ...look, accessory: a }; changed(false); });
      chips.appendChild(b);
    }
  }
  for (const b of chips.children as HTMLCollectionOf<HTMLElement>) { b.setAttribute('aria-pressed', String(b.dataset.acc === (look.accessory ?? 'nenhum'))); lockState(b, `acc:${b.dataset.acc}`); }
  // modelo de cada peça (depende do corpo: só o que ele veste)
  for (const el of document.querySelectorAll<HTMLElement>('.style-chips[data-slot]')) {
    const slot = el.dataset.slot as GarmentSlot, field = SLOT_FIELD[slot];
    const styles = stylesFor(look.body, slot);
    if (el.dataset.body !== look.body) {
      el.dataset.body = look.body;
      el.replaceChildren(...styles.map((st) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.dataset.style = st;
        b.textContent = STYLE_LABELS[st as keyof typeof STYLE_LABELS] ?? st;
        b.addEventListener('click', () => {
          if (blocked(`${STYLE_ITEM[slot]}:${st}`)) return;
          look = { ...look, [field]: st };
          if (slot === 'SHIRT' && st !== 'camiseta') look.shirtDesign = 0; // camisa de time é modelo camiseta
          changed(false);
        });
        return b;
      }));
    }
    const cur = resolveStyle(look.body, slot, look[field]);
    for (const b of el.children as HTMLCollectionOf<HTMLElement>) { b.setAttribute('aria-pressed', String(b.dataset.style === cur)); lockState(b, `${STYLE_ITEM[slot]}:${b.dataset.style}`); }
  }
  const des = $('shirt-designs');
  if (!des.childElementCount) {
    for (const d of [null, ...SHIRT_DESIGNS]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.design = String(d?.id ?? 0);
      const dot = document.createElement('i');
      dot.className = 'dot';
      const p = d?.palette;
      dot.style.background = p ? `linear-gradient(90deg, ${p.bg} 0 50%, ${p.accent ?? p.fg} 50% 100%)` : 'transparent';
      b.append(dot, d ? d.label : 'Nenhuma');
      b.addEventListener('click', () => {
        if (d && blocked(`shirt:${d.id}`)) return;
        look = { ...look, shirtDesign: d?.id ?? 0 };
        if (d) { look.topStyle = 'camiseta'; look.top = parseInt(d.palette.bg.slice(1), 16); }
        changed(false);
      });
      des.appendChild(b);
    }
  }
  for (const b of des.children as HTMLCollectionOf<HTMLElement>) { b.setAttribute('aria-pressed', String(Number(b.dataset.design) === (DESIGN_BY_ID.has(look.shirtDesign ?? 0) ? look.shirtDesign : 0))); if (b.dataset.design !== '0') lockState(b, `shirt:${b.dataset.design}`); }
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
    void preview.portraits(BODIES.map(lookFor)).then((urls) => {
      BODIES.forEach((b, i) => { const img = document.querySelector<HTMLImageElement>(`img[data-portrait=${b}]`); if (img && urls[i]) img.src = urls[i]; });
    });
  }, 220);
}

function changed(portraitsToo: boolean) {
  look = vApp(look) ?? look; // mesmo validador do servidor: o que se vê é o que será salvo
  saveLocalLook();
  renderSwatches();
  preview?.setAppearance(look);
  if (portraitsToo) schedulePortraits();
  setNote(authed() && savedLook && !sameAppearance(look, savedLook) ? 'Alterações não salvas.' : '');
}

avatarRadios.forEach((r) => r.addEventListener('change', () => {
  if (!r.checked) return;
  look = lookFor(r.value as BodyType);
  changed(false);
}));

/** chapéu/boné sobre cabelo crespo volumoso atravessa a malha: o sorteio evita (escolha manual continua livre) */
const clashes = (a: CharacterAppearance) => (a.accessory === 'bone' || a.accessory === 'chapeu') && a.hairStyle === 'afro';
$('randomize').addEventListener('click', () => {
  // SURPREENDA-ME: corpo, peças e cores pelas mesmas regras da multidão (randomAppearance), validado e sem repetir
  let r = look;
  for (let i = 0; i < 20 && (sameAppearance(r, look) || clashes(r)); i++) {
    const body = BODIES[Math.floor(Math.random() * BODIES.length)];
    const a = randomAppearance((Math.random() * 2 ** 32) >>> 0, body, { football: 0.2 });
    r = vApp({ ...a, accessory: a.accessory ?? 'nenhum', acc: a.acc ?? ACC_COLORS[0] }) ?? r;
  }
  look = r;
  changed(true);
});

for (const b of document.querySelectorAll<HTMLButtonElement>('.pose-btn[data-pose]')) {
  b.addEventListener('click', () => {
    preview?.setPose(b.dataset.pose as PreviewPose);
    for (const o of document.querySelectorAll('.pose-btn[data-pose]')) o.setAttribute('aria-pressed', String(o === b));
  });
}
for (const b of document.querySelectorAll<HTMLButtonElement>('.pose-btn[data-rot]')) b.addEventListener('click', () => preview?.rotate(Number(b.dataset.rot) * Math.PI / 4));
for (const b of document.querySelectorAll<HTMLButtonElement>('.pose-btn[data-zoom]')) b.addEventListener('click', () => preview?.zoom(Number(b.dataset.zoom) * 0.5));

// retratos estáticos (gerados por tools/qa/make_portraits.mjs): nada de baixar 4 personagens só para abrir o editor
BODIES.forEach((b) => { const img = document.querySelector<HTMLImageElement>(`img[data-portrait=${b}]`); if (img) img.src = `/ui/portraits/${b}.webp`; });

function setNote(msg: string, kind: '' | 'ok' | 'bad' = '') {
  note.textContent = msg || 'Horário e iluminação reais do Rio, agora.';
  note.className = `foot-note ${msg ? kind : ''}`;
}

type EditorDone = (saved: boolean) => void;
let editorDone: EditorDone | null = null;

/** abre o editor (conta: salva no servidor; sem conta: só no navegador) */
function openEditor(opts: { first?: boolean; overlay?: boolean } = {}): Promise<boolean> {
  renderSwatches();
  void refreshUnlocks().then(() => { if (!start.classList.contains('hidden')) renderSwatches(); }); // rodada 9 — cadeados
  const acc = authed();
  $('name-field').classList.toggle('hidden', acc);
  const an = $('account-nick');
  an.classList.toggle('hidden', !acc);
  an.innerHTML = acc ? `Seu apelido na avenida: <b></b>` : '';
  if (acc) an.querySelector('b')!.textContent = nick();
  $('editor-title').textContent = opts.first ? 'CRIE SEU PERSONAGEM' : 'PERSONAGEM';
  $('editor-eyebrow').textContent = opts.first ? 'PASSO 2 DE 3 · DEPOIS: GRUPO E AVENIDA' : 'PERSONAGEM · CUSTOMIZAR';
  btn.querySelector('span')!.textContent = acc ? (opts.first ? 'Salvar e continuar' : 'Salvar personagem') : 'Salvar neste aparelho';
  btn.disabled = false;
  setNote('');
  start.classList.toggle('overlay', !!opts.overlay);
  home.classList.add('hidden');
  start.classList.remove('hidden');
  start.scrollTop = 0;
  if (!preview) {
    $('preview-loading').classList.remove('hidden');
    void import('./ui/AvatarPreview')
      .then(({ AvatarPreview }) => {
        if (start.classList.contains('hidden')) return;
        preview = new AvatarPreview($<HTMLCanvasElement>('avatar-canvas'), look);
        void preview.ready.then(() => $('preview-loading').classList.add('hidden'));
        (window as any).__pvStart = { preview, look: () => look };
      })
      .catch((e) => { console.warn('[prévia] indisponível', e); $('preview-loading').textContent = 'Prévia 3D indisponível neste navegador'; });
  } else preview.setAppearance(look);
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>('input[name=av]:checked')?.focus({ preventScroll: true }));
  return new Promise((res) => { editorDone = res; });
}

function closeEditor(saved: boolean) {
  // libera o contexto WebGL da prévia (o jogo usa o seu)
  preview?.dispose();
  preview = null;
  start.classList.add('hidden');
  start.classList.remove('overlay');
  const d = editorDone;
  editorDone = null;
  d?.(saved);
}

btn.addEventListener('click', async () => {
  look = vApp(look) ?? look;
  if (!authed()) { saveLocalLook(); closeEditor(true); return; }
  btn.disabled = true;
  setNote('Salvando…');
  const r = await accountApi.putAppearance(look);
  btn.disabled = false;
  if (!r.ok || !r.data) {
    setNote(errorText(r.error), 'bad');
    if (r.status === 401) { me = null; renderHome(); dialog.open('login'); }
    return;
  }
  look = r.data.appearance; // o que o SERVIDOR aceitou
  savedLook = look;
  if (me) me.appearance = look;
  game?.setAppearance(look);
  setNote('Personagem salvo.', 'ok');
  closeEditor(true);
});

$('btn-back').addEventListener('click', () => {
  if (authed() && savedLook && !sameAppearance(look, savedLook)) look = { ...savedLook }; // descarta o não salvo
  const inGame = start.classList.contains('overlay');
  closeEditor(false);
  if (!inGame) showHome();
});

// ------------------------------------------------------------------ início
const dialog = new AccountDialog(appEl);
const picker = new GroupPicker(appEl);
// ------------------------------------------------------------------ rodada 10 — torcida (src/supporters; não obrigatória)
const supPicker = new SupporterPicker(appEl);
let mySupporter: { current: string | null; pending: string | null } = { current: null, pending: null };
function renderSupporterChip() {
  void loadSupporterData().then((data) => {
    const el = document.getElementById('btn-supporter-label');
    if (!el) return;
    const g = supporterGroup(data, mySupporter.current);
    el.innerHTML = '';
    if (g) { const sw = document.createElement('span'); sw.className = 'swatch-shirt'; sw.setAttribute('style', shirtSwatch(DESIGN_BY_ID.get(g.clothingSet.shirtDesign))); el.append(sw, `TORCIDA: ${g.shortName}`); }
    else el.textContent = mySupporter.current ? 'TORCIDA: NENHUMA' : 'TORCIDA';
    $('home-sup').classList.toggle('hidden', !data?.groups.length);
  });
}
async function refreshSupporter() {
  if (authed()) { const r = await accountApi.getSupporter(); mySupporter = r.ok && r.data ? { current: r.data.current, pending: r.data.pending } : { current: null, pending: null }; }
  else mySupporter = { current: localSupporter(), pending: null };
  renderSupporterChip();
}
async function pickSupporter(): Promise<void> {
  const data = await loadSupporterData();
  if (!data) return;
  home.classList.add('hidden');
  const choice = await supPicker.open(data, mySupporter.current, { account: authed(), pending: mySupporter.pending });
  if (!choice) { supPicker.root.classList.add('hidden'); showHome(); return; }
  let msg = '';
  if (authed()) {
    supPicker.status('Salvando…');
    const r = await accountApi.putSupporter(choice.group);
    if (!r.ok || !r.data) { supPicker.status(errorText(r.error)); return pickSupporter(); }
    mySupporter = { current: r.data.current, pending: r.data.pending };
    if (r.data.deferred) msg = 'Troca de torcida pendente: vale quando você sair do evento em andamento.';
  } else { setLocalSupporter(choice.group === data.neutralId ? null : choice.group); mySupporter = { current: localSupporter(), pending: null }; }
  // "vestir as cores": camisa da torcida + cores sugeridas (o resto do visual fica igual)
  const g = supporterGroup(data, choice.group);
  if (g && choice.wearColors) {
    const next = vApp({ ...look, topStyle: 'camiseta', ...supporterOutfit(g) });
    if (next) {
      if (authed()) { const a = await accountApi.putAppearance(next); if (a.ok && a.data) { look = a.data.appearance; savedLook = look; if (me) me.appearance = look; } }
      else { look = next; saveLocalLook(); }
      game?.setAppearance(look);
    }
  } else if (authed()) game?.setAppearance(look); // avisa a sala para reler
  supPicker.root.classList.add('hidden');
  showHome(msg || (g ? `Torcida: ${g.displayName}.` : 'Você está sem torcida.'));
}
$('btn-supporter').addEventListener('click', () => void pickSupporter());

function showHome(msg = '') {
  start.classList.add('hidden');
  picker.root.classList.add('hidden');
  supPicker.root.classList.add('hidden'); // rodada 10 — torcida
  home.classList.remove('hidden');
  renderHome();
  homeMsg(msg);
}
function homeMsg(msg: string) { $('home-msg').textContent = msg; }

function groupOf(key: string | null | undefined): PublicGroup | null {
  return ev?.groups.find((g) => g.key === key) ?? null;
}

function renderHome() {
  const a = authed();
  const who = $('home-who');
  who.classList.toggle('hidden', !a);
  who.innerHTML = a ? 'Olá, <b></b>' : '';
  if (a) who.querySelector('b')!.textContent = nick();
  $('btn-login').classList.toggle('hidden', a);
  $('home-have').classList.toggle('hidden', a);
  $('home-me').classList.toggle('hidden', !a);
  const canPlay = a && can(me!.access.state, 'world.play');
  $('btn-join-label').textContent = a ? 'ENTRAR NA AVENIDA' : 'PARTICIPAR';
  // rodada 9.1 — cadastro BETA pendente: sem código; a equipe libera (npm run prod:approve)
  $('btn-join-sub').textContent = !a ? 'crie sua conta e seu personagem' : me?.registration === 'beta' ? 'cadastro recebido — aguardando liberação beta' : canPlay ? `como ${nick()}` : 'sua conta assiste até liberar a participação';
  const g = groupOf(me?.membership?.groupKey);
  const gl = $('btn-group-label');
  gl.innerHTML = '';
  if (g) {
    const sw = document.createElement('span');
    sw.className = 'swatch-pair';
    for (const c of g.colors.slice(0, 2)) { const i = document.createElement('i'); i.style.background = c; sw.appendChild(i); }
    gl.append(sw, ` ${g.name}`);
  } else gl.textContent = ev?.groups.length ? 'ESCOLHER GRUPO' : 'GRUPO';
  $('btn-group').classList.toggle('hidden', !ev?.groups.length);
  renderSupporterChip(); // rodada 10 — torcida
}

/** evento atual: do servidor; sem servidor, dos dados estáticos (mesmo arquivo) */
async function loadEvent() {
  const r = await accountApi.currentEvent();
  if (r.ok && r.data) ev = r.data;
  else {
    try {
      const idx = await (await fetch('/events/index.json')).json() as { default: string };
      const def = await (await fetch(`/events/${idx.default}.json`)).json() as EventDef;
      const { joinableGroups } = await import('./events/groups');
      ev = { event: { id: def.id, name: def.name, category: def.category }, groups: joinableGroups(def), membership: null };
    } catch { /* sem dados: mantém o título padrão */ }
  }
  if (ev) $('home-event').textContent = ev.event.name.toUpperCase();
  if (ev?.membership && me) me.membership = ev.membership;
  renderHome();
}

/** pessoas na avenida — SÓ do servidor (GET /api/metrics/public); sem métricas, texto neutro */
let metricsTimer = 0;
async function pollMetrics() {
  clearTimeout(metricsTimer);
  if (home.classList.contains('hidden') && game) return;
  const r = await accountApi.metrics();
  const line = r.ok ? metricsLine(r.data) : null;
  $('home-live').innerHTML = line ?? 'Central do Brasil → Candelária, ao vivo';
  metricsTimer = window.setTimeout(() => void pollMetrics(), 15_000);
}

/** sessão: GET /api/me (cookie HttpOnly); aparência/preferências/grupo vêm do servidor */
async function refreshMe() {
  const r = await accountApi.me();
  me = r.ok && r.data?.authenticated ? r.data : null;
  if (me) {
    if (me.appearance === undefined) {
      const a = await accountApi.getAppearance();
      me.appearance = a.ok ? a.data?.appearance ?? null : null;
    }
    await refreshUnlocks(); // rodada 9: direitos antes de validar o visual salvo (item liberado não "some")
    savedLook = me.appearance ? vApp(me.appearance) : null;
    if (savedLook) look = { ...savedLook };
    if (me.preferences?.quality) setQuality(me.preferences.quality as QualityChoice, false);
    if (me.membership === undefined && ev) me.membership = ev.membership;
  } else savedLook = null;
  await refreshSupporter(); // rodada 10 — torcida
  renderHome();
}

async function pickGroup(first = false): Promise<void> {
  if (!ev?.groups.length) return;
  home.classList.add('hidden');
  const choice = await picker.open(ev.event.name.toUpperCase(), ev.groups, me?.membership?.groupKey ?? null);
  if (!choice) { picker.root.classList.add('hidden'); if (!first) showHome(); return; }
  picker.status('Salvando…');
  const r = choice.groupKey ? await accountApi.setMembership(choice.groupKey) : await accountApi.clearMembership();
  if (!r.ok) { picker.status(errorText(r.error)); return pickGroup(first); }
  if (me) me.membership = choice.groupKey && ev ? { eventId: ev.event.id, groupKey: choice.groupKey } : null;
  const g = groupOf(choice.groupKey);
  if (g && choice.wearColors) {
    const a = await accountApi.putAppearance(vApp(withGroupShirt(look, g))!);
    if (a.ok && a.data) { look = a.data.appearance; savedLook = look; if (me) me.appearance = look; game?.setAppearance(look); }
  } else game?.setAppearance(look); // avisa a sala para reler o grupo
  applyGroupDesigns();
  picker.root.classList.add('hidden');
  if (!first) showHome(g ? `Grupo: ${g.name}.` : 'Você está sem grupo neste evento.');
}

/** fluxo da conta logo após entrar/criar: personagem (se ainda não salvo) → grupo → avenida */
const BETA_PENDING = 'Cadastro recebido — o acesso beta é liberado pela equipe. Enquanto isso, você pode assistir.';
async function afterLogin() {
  await refreshMe();
  if (!me) return;
  if (me.registration === 'beta') { showHome(BETA_PENDING); return; }
  if (!savedLook) {
    look = vApp(look) ?? look;
    const saved = await openEditor({ first: true });
    if (!saved) return;
    await pickGroup(true);
    return enterAvenue();
  }
  showHome(`Bem-vindo de volta, ${nick()}.`);
}

dialog.onAuthenticated = () => void afterLogin();
// rodada 9.1 — beta sem SMTP: cadastro recebido (conta pendente); a sessão já existe, então a home mostra "aguardando"
dialog.onPending = () => void refreshMe().then(() => showHome(BETA_PENDING));
$('btn-login').addEventListener('click', () => dialog.open('login'));
$('btn-login2').addEventListener('click', () => dialog.open('login'));
$('btn-join').addEventListener('click', () => { if (authed()) void enterAvenue(); else dialog.open('register'); });
$('btn-edit-char').addEventListener('click', async () => { if (await openEditor()) showHome('Personagem salvo.'); });
$('btn-group').addEventListener('click', () => { if (authed()) void pickGroup(); else dialog.open('login'); });
$('btn-logout').addEventListener('click', async () => {
  await accountApi.logout();
  me = null; savedLook = null;
  mySupporter = { current: localSupporter(), pending: null }; // rodada 10 — torcida volta a ser só da sessão
  look = loadLocalLook();
  showHome('Você saiu da conta.');
});
watchBtn.addEventListener('click', () => {
  performance.mark('pv:watch-click');
  void launch(qualityChoice(), 'spectator');
});

async function enterAvenue() {
  if (!me) return;
  if (!savedLook) { if (!(await openEditor({ first: true }))) return; }
  const role: WorldRole = can(me.access.state, 'world.play') ? 'player' : 'spectator';
  void launch(qualityChoice(), role);
}

// ------------------------------------------------------------------ jogo
function showError(e: unknown) {
  console.error(e);
  home.classList.add('hidden');
  start.classList.add('hidden');
  loading.classList.add('hidden');
  errorEl.classList.remove('hidden');
  $('error-msg').textContent = e instanceof Error ? e.message : String(e);
}

/** inicia o jogo; `role = 'spectator'` = ASSISTIR (src/spectator). `pv:click` → `pv:world-visible` = tempo até o 1º quadro */
/** rodada 9.1: motivo de a conta ter entrado só assistindo (aviso no HUD) */
let ticketNote: '' | 'aguardando_liberacao' | 'sem_acesso' = '';
async function launch(choice: QualityChoice, role?: WorldRole) {
  performance.mark('pv:click');
  ticketNote = '';
  saveQualityChoice(choice);
  saveLocalLook();
  preview?.dispose();
  preview = null;
  clearTimeout(metricsTimer);
  home.classList.add('hidden');
  start.classList.add('hidden');
  loading.classList.remove('hidden');
  try {
    const { Game } = await enginePromise;
    // conta: ticket de uso único pedido na hora de conectar (o servidor decide papel, nome e visual)
    const opts: GameStartOptions = role ? {
      mp: MP, role,
      // ticket recusado de vez (sem licença, beta pendente) → entra sem ticket (visitante); falha PASSAGEIRA (servidor
      // reiniciando, 429) LANÇA para a reentrada tentar de novo em vez de rebaixar a conta (src/net/NetworkClient.ts)
      getTicket: authed() ? async () => {
        const r = await accountApi.joinTicket(role);
        // rodada 9.1: conta sem acesso de JOGADOR entra assistindo — avisar em vez de parecer um erro
        if (r.ok) { if (role === 'player' && (r.data as { role?: string } | undefined)?.role === 'spectator') ticketNote = 'sem_acesso'; return r.data?.ticket; }
        if (r.status === 0 || r.status === 429 || r.status >= 500) throw new Error(r.error ?? 'sem_conexao');
        if (r.error === 'aguardando_liberacao') ticketNote = 'aguardando_liberacao';
        return undefined;
      } : undefined,
    } : {};
    game = new Game(appEl, resolveQualityChoice(choice), { ...look }, opts);
    game.playerName = authed() ? nick() : nameInput.value.trim();
    applyGroupDesigns();
    await game.load((f, l) => {
      fill.style.width = `${Math.round(f * 100)}%`;
      label.textContent = l;
    });
    loading.classList.add('hidden');
    game.start();
    if (ticketNote) {
      const g = game;
      setTimeout(() => g.hudShell?.notice(ticketNote === 'aguardando_liberacao'
        ? 'Cadastro recebido: a equipe libera o acesso beta. Enquanto isso você assiste como espectador.'
        : 'Sua conta ainda não tem acesso de jogador (beta). Você está assistindo como espectador.', 'warn', 12000), 1500);
    }
    performance.mark('pv:game-start');
    const click = performance.getEntriesByName('pv:watch-click')[0];
    if (click) (window as any).__pvSpectatorStartMs = Math.round(performance.now() - click.startTime);
    (window as any).__pv = game.debugApi();
    if (params.get('bench') === '1') void import('./debug/bench').then((b) => b.runBench((window as any).__pv));
  } catch (e) {
    showError(e);
  }
}

/** artes sugeridas do grupo escolhido viram o padrão ao pegar bandeira/cartaz/faixa (nunca obrigatórias) */
function applyGroupDesigns() {
  const g = groupOf(me?.membership?.groupKey);
  game?.setPreferredDesigns(g ? (['flag', 'sign', 'banner'] as const).flatMap((t) => groupDesigns(g, t).map((d) => d.id)) : []);
}

/** HUD/menu do jogo: "PERSONAGEM / CUSTOMIZAR" (só com conta: o visual é salvo no servidor) */
registerCharacterEditor(() => {
  if (!authed()) { dialog.open('login'); return; }
  if (savedLook) look = { ...savedLook };
  void openEditor({ overlay: !!game });
});
(window as any).pvOpenCharacterEditor = openCharacterEditor;
// rodada 11 — inventário: o que o SERVIDOR aceitou pelo inventário volta para o visual salvo / rótulo da torcida
registerInventoryAccount({
  authed,
  onLook: (a) => { look = a; savedLook = a; if (me) me.appearance = a; },
  onSupporter: (s) => { mySupporter = s; renderSupporterChip(); },
});

// automação/validação: ?autostart=1&quality=high (jogo local, como antes) · __pvLaunch({ role }) = mesmo caminho dos botões
(window as any).__pvLaunch = (o: { role?: WorldRole } = {}) => launch((radios.find((r) => r.checked)?.value ?? 'auto') as QualityChoice, o.role);
if (autostart) {
  const q = (params.get('quality') ?? 'auto') as QualityChoice;
  home.classList.add('hidden');
  enginePromise.then(() => launch(q, params.get('spectate') === '1' ? 'spectator' : undefined)); // &spectate=1 = assistir
} else {
  renderSwatches();
  void loadEvent().then(() => refreshMe());
  void pollMetrics();
  if (params.get('watch') === '1') enginePromise.then(() => watchBtn.click());
}
