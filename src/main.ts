/**
 * Entrada leve: mostra a tela inicial imediatamente; o motor (three.js + jogo) é carregado sob demanda
 * em um chunk separado (pré-buscado em segundo plano enquanto o jogador escolhe a qualidade).
 */
import './ui/style.css';
import { detectQuality, loadQualityChoice, saveQualityChoice, resolveQualityChoice, type QualityChoice } from './core/qualityChoice';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const start = $('start'), loading = $('loading'), errorEl = $('error');
const btn = $<HTMLButtonElement>('explore');
const fill = $('bar-fill'), label = $('loading-label');

const enginePromise = import('./core/Game');
enginePromise.then(() => { btn.disabled = false; }).catch((e) => showError(e));

type Body = 'homem' | 'mulher' | 'idoso' | 'idosa';
const avatarRadios = Array.from(document.querySelectorAll<HTMLInputElement>('input[name=av]'));
let savedAvatar: Body = 'homem';
try { savedAvatar = (localStorage.getItem('pv3d.avatar') as Body) || 'homem'; } catch { /* sem storage */ }
const urlAvatar = new URLSearchParams(location.search).get('avatar') as Body | null;
if (urlAvatar) savedAvatar = urlAvatar;
avatarRadios.forEach((r) => { r.checked = r.value === savedAvatar; });
const chosenAvatar = (): Body => (avatarRadios.find((r) => r.checked)?.value as Body) ?? 'homem';

const saved = loadQualityChoice();
const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[name=q]'));
radios.forEach((r) => { r.checked = r.value === saved; });
$('detected').textContent = `Automático detectou: ${({ low: 'Baixo', medium: 'Médio', high: 'Alto', ultra: 'Ultra' } as const)[detectQuality()]}`;

function showError(e: unknown) {
  console.error(e);
  start.classList.add('hidden');
  loading.classList.add('hidden');
  errorEl.classList.remove('hidden');
  $('error-msg').textContent = e instanceof Error ? e.message : String(e);
}

async function launch(choice: QualityChoice) {
  saveQualityChoice(choice);
  start.classList.add('hidden');
  loading.classList.remove('hidden');
  try {
    const { Game, DEFAULT_PLAYER_APPEARANCE } = await enginePromise;
    const preset = resolveQualityChoice(choice);
    const body = chosenAvatar();
    try { localStorage.setItem('pv3d.avatar', body); } catch { /* ignore */ }
    const game = new Game($('app'), preset, DEFAULT_PLAYER_APPEARANCE[body] ?? DEFAULT_PLAYER_APPEARANCE.homem);
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
const params = new URLSearchParams(location.search);
if (params.get('autostart') === '1') {
  const q = (params.get('quality') ?? 'auto') as QualityChoice;
  enginePromise.then(() => launch(q));
}
