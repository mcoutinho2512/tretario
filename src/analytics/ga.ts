/**
 * Google Analytics 4 (propriedade "Porrada na Presidente Vargas", G-PLKMS11875) — SÓ com consentimento.
 *
 * - Nada do Google é carregado antes do "Aceitar" do aviso; "Recusar" fica guardado e o aviso não volta (o link
 *   "Cookies" do rodapé reabre). Escolha em localStorage `pv_analytics_consent` (granted | denied), nada mais.
 * - Só em produção (tretario.com.br): dev, QA e servidores de teste nunca mandam dados.
 * - Sem anúncios: Consent Mode com ad_storage/ad_user_data/ad_personalization negados; Google Signals e
 *   personalização de anúncios desligados. O GA4 não guarda IP.
 * - Eventos do jogo (track): entrar_mundo {papel}, sign_up {method}, veiculo_pessoal {tipo}. Nunca nome, e-mail,
 *   apelido ou posição.
 * CSP: deploy/nginx/snippets/tretario-headers.conf libera googletagmanager.com e google-analytics.com.
 */
import './consent.css';

export const GA_ID = 'G-PLKMS11875';
const KEY = 'pv_analytics_consent';
const PROD_HOSTS = new Set(['tretario.com.br', 'www.tretario.com.br']);

type Consent = 'granted' | 'denied';
type Gtag = (...args: unknown[]) => void;
declare global { interface Window { dataLayer?: unknown[]; gtag?: Gtag } }

let loaded = false;
let banner: HTMLElement | null = null;

const enabled = () => PROD_HOSTS.has(location.hostname);

export function analyticsConsent(): Consent | null {
  try { const v = localStorage.getItem(KEY); return v === 'granted' || v === 'denied' ? v : null; } catch { return null; }
}

function load() {
  if (loaded || !enabled()) return;
  loaded = true;
  window.dataLayer = window.dataLayer ?? [];
  // o gtag.js exige o objeto `arguments` (não um array) na fila
  window.gtag = function gtag() { window.dataLayer!.push(arguments); } as Gtag; // eslint-disable-line prefer-rest-params
  window.gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  window.gtag('js', new Date());
  window.gtag('config', GA_ID, { allow_google_signals: false, allow_ad_personalization_signals: false });
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(s);
}

export function setAnalyticsConsent(v: Consent) {
  try { localStorage.setItem(KEY, v); } catch { /* sem armazenamento: vale só nesta visita */ }
  if (v === 'granted') load();
  else if (loaded) window.gtag?.('consent', 'update', { analytics_storage: 'denied' });
  hideBanner();
}

/** evento do jogo (só com consentimento dado e GA carregado) */
export function track(name: string, params: Record<string, string | number> = {}) {
  if (loaded) window.gtag?.('event', name, params);
}

function hideBanner() { banner?.remove(); banner = null; }

/** aviso de cookies (também reaberto pelo link "Cookies" do rodapé) */
export function showConsentBanner() {
  if (banner) return;
  const el = document.createElement('div');
  el.className = 'consent-bar';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Cookies');
  el.innerHTML = '<p>Usamos o <strong>Google Analytics</strong> para contar visitas e entender como o jogo é usado. '
    + 'Sem anúncios e sem seu nome ou e-mail. Você pode mudar quando quiser em "Cookies", no rodapé.</p>'
    + '<div class="consent-actions"><button type="button" data-v="denied">Recusar</button><button type="button" class="primary" data-v="granted">Aceitar</button></div>';
  el.addEventListener('click', (e) => {
    const v = (e.target as HTMLElement).closest('button')?.dataset.v;
    if (v === 'granted' || v === 'denied') setAnalyticsConsent(v);
  });
  document.body.appendChild(el);
  banner = el;
}

export function initAnalytics() {
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a[data-cookies]')) {
    a.addEventListener('click', (e) => { e.preventDefault(); showConsentBanner(); });
  }
  if (!enabled()) return;
  const c = analyticsConsent();
  if (c === 'granted') load();
  else if (c === null) showConsentBanner();
}
