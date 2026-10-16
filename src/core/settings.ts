/** Presets gráficos e detecção inicial de qualidade. */

export type QualityLevel = 'low' | 'medium' | 'high';
export type QualityChoice = 'auto' | QualityLevel;

export interface QualityPreset {
  level: QualityLevel;
  pixelRatio: number; // teto do devicePixelRatio
  shadowMapSize: number; // 0 = sem sombras
  shadowDistance: number; // meia-largura da caixa de sombra (m)
  /** distâncias (m) de troca de LOD dos chunks: [full, medium, far] */
  lodDistances: [number, number, number];
  vegetationDensity: number; // 0–1 (fração das árvores com copa detalhada)
  propsDistance: number; // distância máxima do mobiliário
  ambientOcclusion: boolean;
  antialias: boolean; // MSAA nativo
  postAA: boolean; // SMAA no composer
  fogFar: number;
  cameraFar: number;
  /** pedestres NPC simultâneos ao redor da câmera */
  pedestrians: number;
  /** veículos NPC simultâneos */
  vehicles: number;
}

export const PRESETS: Record<QualityLevel, QualityPreset> = {
  low: {
    level: 'low', pixelRatio: 1, shadowMapSize: 0, shadowDistance: 0,
    lodDistances: [220, 520, 1400], vegetationDensity: 0.5, propsDistance: 140,
    ambientOcclusion: false, antialias: false, postAA: false, fogFar: 1500, cameraFar: 1800,
    pedestrians: 14, vehicles: 24,
  },
  medium: {
    level: 'medium', pixelRatio: 1.5, shadowMapSize: 2048, shadowDistance: 110,
    lodDistances: [330, 750, 2200], vegetationDensity: 0.85, propsDistance: 230,
    ambientOcclusion: false, antialias: true, postAA: false, fogFar: 2200, cameraFar: 2600,
    pedestrians: 32, vehicles: 48,
  },
  high: {
    level: 'high', pixelRatio: 2, shadowMapSize: 4096, shadowDistance: 170,
    lodDistances: [450, 1000, 3000], vegetationDensity: 1, propsDistance: 340,
    ambientOcclusion: true, antialias: false, postAA: true, fogFar: 3000, cameraFar: 3400,
    pedestrians: 56, vehicles: 80,
  },
};

export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0) && matchMedia('(pointer: coarse)').matches;
}

/** Heurística simples: GPU (via WEBGL_debug_renderer_info), memória, toque e tamanho da tela. */
export function detectQuality(): QualityLevel {
  if (isTouchDevice()) return 'low';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return 'low';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) as string;
    const g = gpu.toLowerCase();
    const mem = (navigator as any).deviceMemory ?? 8;
    if (/swiftshader|llvmpipe|software|basic render/.test(g)) return 'low';
    if (/apple m\d|apple gpu|rtx|radeon rx|geforce gtx 1[0-9]|rx 6|rx 7|arc a/.test(g) && mem >= 8) return 'high';
    if (/intel.*(uhd|hd)|mali|adreno|powervr/.test(g)) return mem >= 8 ? 'medium' : 'low';
    return 'medium';
  } catch {
    return 'medium';
  }
}

export function resolveQuality(choice: QualityChoice): QualityPreset {
  return PRESETS[choice === 'auto' ? detectQuality() : choice];
}

const STORAGE_KEY = 'pv3d.quality';
export function loadQualityChoice(): QualityChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'auto' || v === 'low' || v === 'medium' || v === 'high') return v;
  } catch { /* storage indisponível */ }
  return 'auto';
}
export function saveQualityChoice(c: QualityChoice) {
  try { localStorage.setItem(STORAGE_KEY, c); } catch { /* ignore */ }
}
