/**
 * Perfil do aparelho (puro, testável): plataforma, navegador, classe de GPU → preset recomendado, FPS alvo e
 * resolução dinâmica. Regra de produto: em aparelho fraco ou de memória limitada (iPhone), começar SEGURO
 * (MÉDIO/BAIXO a 30 FPS com resolução dinâmica) e subir só se depois medirmos que aguenta.
 *
 * Rodada 11 (docs/PERFORMANCE.md "Detecção"): o NAVEGADOR não entra na decisão. Quando o navegador esconde o nome da
 * GPU (Safari: "Apple GPU"; Firefox com resistFingerprinting: "Mozilla"), decidem as CAPACIDADES reais do WebGL2
 * (`maxTextureSize`, alvo de cor em ponto flutuante) — nunca "é Safari, então baixa". O automático nunca escolhe
 * ULTRA (é opção manual: custo medido em docs/bench/round11_presets.json); a resolução dinâmica é a rede de segurança.
 */
import type { QualityLevel } from './settings';

export type Platform = 'iphone' | 'ipad' | 'android' | 'mac' | 'windows' | 'linux' | 'other';
export type Browser = 'chrome' | 'edge' | 'safari' | 'firefox' | 'samsung' | 'other';
export type GpuClass = 'software' | 'mobile' | 'integrated' | 'apple-silicon' | 'apple-silicon-pro' | 'discrete' | 'discrete-high' | 'masked' | 'unknown';

/** capacidades reais do contexto WebGL2 (rodada 11) — ausentes = não medidas (não penalizam) */
export interface GpuCaps {
  maxTextureSize?: number;
  /** EXT_color_buffer_float: alvo HDR (HalfFloat) do pós-processamento (AO/SMAA) */
  floatColorBuffer?: boolean;
  /** EXT_disjoint_timer_query_webgl2: tempo de GPU para a resolução dinâmica */
  gpuTimer?: boolean;
  maxAnisotropy?: number;
  /** navigator.hardwareConcurrency */
  cores?: number;
}

export interface DeviceInput {
  ua: string;
  maxTouchPoints: number;
  gpu: string;
  deviceMemory?: number;
  screenW?: number;
  screenH?: number;
  caps?: GpuCaps;
}

export interface DeviceProfile {
  platform: Platform;
  browser: Browser;
  gpu: string;
  gpuClass: GpuClass;
  memoryGB: number | null;
  mobile: boolean;
  recommended: QualityLevel;
  targetFps: 30 | 60;
  dynamicResolution: boolean;
  caps: GpuCaps;
  /** texto curto para a interface (pt-BR) */
  label: string;
  reason: string;
}

export function detectPlatform(ua: string, maxTouchPoints: number): Platform {
  if (/iPhone|iPod/.test(ua)) return 'iphone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) return 'ipad'; // iPadOS se apresenta como Mac
  if (/Android/.test(ua)) return 'android';
  if (/Macintosh|Mac OS X/.test(ua)) return 'mac';
  if (/Windows/.test(ua)) return 'windows';
  if (/Linux|X11|CrOS/.test(ua)) return 'linux';
  return 'other';
}

export function detectBrowser(ua: string): Browser {
  if (/SamsungBrowser/.test(ua)) return 'samsung';
  if (/Edg\//.test(ua)) return 'edge';
  if (/Firefox\/|FxiOS/.test(ua)) return 'firefox';
  if (/Chrome\/|CriOS/.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  return 'other';
}

export function classifyGpu(gpu: string, platform: Platform): GpuClass {
  const g = gpu.toLowerCase();
  if (/swiftshader|llvmpipe|software|basic render|microsoft basic/.test(g)) return 'software';
  if (platform === 'iphone' || platform === 'ipad' || platform === 'android') return 'mobile';
  if (/mali|adreno|powervr|apple a\d/.test(g)) return 'mobile';
  if (/apple m[2-9] (pro|max|ultra)|apple m1 (max|ultra)/.test(g)) return 'apple-silicon-pro';
  if (/apple m\d/.test(g)) return 'apple-silicon';
  // nome escondido pelo navegador (Safari: "Apple GPU"; Firefox resistFingerprinting: "Mozilla"; WebKit genérico)
  if (/^(apple gpu|webkit webgl|mozilla|generic renderer)$/.test(g.trim()) || /^angle \(unknown/.test(g)) return 'masked';
  if (/rtx [345]0[789]0|rx [79][789]00|radeon pro w/.test(g)) return 'discrete-high';
  if (/rtx|gtx|geforce|radeon rx|radeon pro|arc a\d/.test(g)) return 'discrete';
  // Intel UHD/Iris, AMD APU ("AMD Radeon(TM) Graphics", "Vega")
  if (/intel|iris|uhd|radeon\(tm\) graphics|radeon graphics|vega/.test(g)) return 'integrated';
  return 'unknown';
}

const LEVEL_LABEL: Record<QualityLevel, string> = { low: 'BAIXO', medium: 'MÉDIO', high: 'ALTO', ultra: 'ULTRA' };
const PLATFORM_LABEL: Record<Platform, string> = {
  iphone: 'iPhone', ipad: 'iPad', android: 'Android', mac: 'Mac', windows: 'Windows', linux: 'Linux', other: 'Aparelho',
};

export function profileDevice(i: DeviceInput): DeviceProfile {
  const platform = detectPlatform(i.ua, i.maxTouchPoints);
  const browser = detectBrowser(i.ua);
  const gpuClass = classifyGpu(i.gpu, platform);
  const mem = i.deviceMemory ?? null;
  const mobile = platform === 'iphone' || platform === 'ipad' || platform === 'android';
  let recommended: QualityLevel = 'medium';
  let targetFps: 30 | 60 = 60;
  let dynamicResolution = false;
  let reason = '';
  switch (gpuClass) {
    case 'software':
      recommended = 'low'; targetFps = 30; dynamicResolution = true; reason = 'renderização por software';
      break;
    case 'mobile':
      // iPhone: memória por aba limitada (o Safari mata a página com ~1–1,5 GB) → MÉDIO a 30 FPS
      if (platform === 'iphone') { recommended = 'medium'; reason = 'iPhone: memória por aba limitada e aquecimento'; }
      else if (platform === 'ipad') { recommended = 'medium'; reason = 'iPad'; }
      else {
        const strong = /adreno \(tm\) (7\d\d|6[4-9]\d)|mali-g7[1-9]|mali-g[7-9]\d\d|immortalis/i.test(i.gpu);
        recommended = strong && (mem ?? 4) >= 6 ? 'medium' : 'low';
        reason = strong ? 'Android com GPU recente' : 'Android';
      }
      targetFps = 30; dynamicResolution = true;
      break;
    case 'integrated':
      // notebook com GPU integrada: provavelmente o público típico — MÉDIO a 60 com resolução dinâmica;
      // Intel UHD antigo (sem Iris/Xe) ou pouca memória → BAIXO
      recommended = /iris|xe|780m|680m|radeon\(tm\) graphics/i.test(i.gpu) && (mem ?? 8) >= 8 ? 'medium' : 'low';
      dynamicResolution = true;
      reason = 'GPU integrada';
      break;
    case 'apple-silicon':
      recommended = 'high'; reason = 'Apple Silicon';
      break;
    case 'apple-silicon-pro':
      recommended = 'high'; reason = 'Apple Silicon Pro/Max';
      break;
    case 'discrete':
      recommended = 'high'; reason = 'GPU dedicada';
      break;
    case 'discrete-high':
      recommended = 'high'; reason = 'GPU dedicada de alto desempenho';
      break;
    case 'masked': {
      // sem o nome da GPU: no Mac (Apple Silicon ou GPU de Mac Intel, todas com texturas de 16384) → ALTO, igual ao
      // Chrome na mesma máquina; nos outros sistemas o nome escondido não diz nada → MÉDIO
      const big = (i.caps?.maxTextureSize ?? 16384) >= 16384;
      recommended = platform === 'mac' && big ? 'high' : 'medium';
      reason = 'GPU não informada pelo navegador · decidido pelas capacidades do WebGL';
      break;
    }
    default:
      recommended = 'medium'; dynamicResolution = true; reason = 'GPU não identificada';
  }
  // resolução dinâmica para todos: medido no Safari (M5 Pro, janela Retina 2x) o ALTO caía para 15–19 FPS só por
  // excesso de pixels; com a escala dinâmica (0,84–0,92) volta a ~59 FPS. Ela só reduz quando falta folga.
  dynamicResolution = true;
  // capacidades reais: teto pelo que o contexto aguenta (medido, não suposto)
  const caps = i.caps ?? {};
  const cap = (lvl: QualityLevel, why: string) => {
    const order: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];
    if (order.indexOf(recommended) > order.indexOf(lvl)) { recommended = lvl; reason += ` · ${why}`; }
  };
  if (caps.maxTextureSize !== undefined && caps.maxTextureSize < 4096) cap('low', `texturas até ${caps.maxTextureSize}`);
  else if (caps.maxTextureSize !== undefined && caps.maxTextureSize < 8192) cap('medium', `texturas até ${caps.maxTextureSize}`);
  if (caps.floatColorBuffer === false) cap('medium', 'sem alvo de cor em ponto flutuante');
  if (mem !== null && mem <= 4 && recommended !== 'low') {
    recommended = mobile ? 'low' : 'medium';
    reason += ` · ${mem} GB de memória`;
  }
  const label = `${PLATFORM_LABEL[platform]} detectado · preset recomendado: ${LEVEL_LABEL[recommended]} · ${targetFps} FPS${dynamicResolution ? ' · resolução dinâmica' : ''}`;
  return { platform, browser, gpu: i.gpu, gpuClass, memoryGB: mem, mobile, recommended, targetFps, dynamicResolution, caps, label, reason };
}

/** lê o aparelho real (navegador). `?device=iphone|android|intel` força um perfil para testes. */
export function currentDevice(): DeviceProfile {
  let gpu = '';
  const caps: GpuCaps = { cores: navigator.hardwareConcurrency || undefined };
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      caps.maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || undefined;
      caps.floatColorBuffer = !!gl.getExtension('EXT_color_buffer_float');
      caps.gpuTimer = !!gl.getExtension('EXT_disjoint_timer_query_webgl2');
      const an = gl.getExtension('EXT_texture_filter_anisotropic');
      caps.maxAnisotropy = an ? Number(gl.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) : 1;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    } else gpu = 'sem webgl2';
  } catch { gpu = 'desconhecida'; }
  const forced = new URLSearchParams(location.search).get('device');
  const fake: Record<string, Partial<DeviceInput>> = {
    iphone: { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', maxTouchPoints: 5, gpu: 'Apple GPU' },
    android: { ua: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36', maxTouchPoints: 5, gpu: 'Adreno (TM) 619', deviceMemory: 4 },
    intel: { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36', maxTouchPoints: 0, gpu: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0)', deviceMemory: 8 },
  };
  const base: DeviceInput = {
    ua: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints ?? 0, gpu,
    deviceMemory: (navigator as unknown as { deviceMemory?: number }).deviceMemory, screenW: screen.width, screenH: screen.height, caps,
  };
  return profileDevice(forced && fake[forced] ? { ...base, ...fake[forced] } : base);
}
