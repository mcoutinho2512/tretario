/** Presets gráficos e detecção inicial de qualidade. */

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';
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
  /** raio (m) da simulação de pedestres ao redor do jogador */
  pedestrianRadius: number;
  /** alcance de desenho dos painéis de LED */
  billboardDistance: number;
  /** sombras de NPCs até esta distância */
  npcShadowDistance: number;
}

export const PRESETS: Record<QualityLevel, QualityPreset> = {
  low: {
    level: 'low', pixelRatio: 1, shadowMapSize: 0, shadowDistance: 0,
    lodDistances: [220, 520, 1400], vegetationDensity: 0.5, propsDistance: 140,
    ambientOcclusion: false, antialias: false, postAA: false, fogFar: 1500, cameraFar: 1800,
    pedestrians: 14, vehicles: 24, pedestrianRadius: 70, billboardDistance: 500, npcShadowDistance: 0,
  },
  medium: {
    level: 'medium', pixelRatio: 1.5, shadowMapSize: 2048, shadowDistance: 110,
    lodDistances: [330, 750, 2200], vegetationDensity: 0.85, propsDistance: 230,
    ambientOcclusion: false, antialias: true, postAA: false, fogFar: 2200, cameraFar: 2600,
    pedestrians: 32, vehicles: 48, pedestrianRadius: 90, billboardDistance: 750, npcShadowDistance: 25,
  },
  high: {
    level: 'high', pixelRatio: 2, shadowMapSize: 4096, shadowDistance: 170,
    lodDistances: [450, 1000, 3000], vegetationDensity: 1, propsDistance: 340,
    ambientOcclusion: true, antialias: false, postAA: true, fogFar: 3000, cameraFar: 3400,
    pedestrians: 56, vehicles: 80, pedestrianRadius: 95, billboardDistance: 900, npcShadowDistance: 35,
  },
  // ULTRA: não "aumenta tudo" — investe onde a diferença aparece na Pres. Vargas:
  // sombra mais longa (fachadas projetando sombra na avenida inteira), LOD FULL mais distante
  // (galerias/sinalização nítidas até o próximo cruzamento), mais pedestres no raio visível.
  // Mantém 4096² (só alarga a caixa: menos texels/m — compensado pelo PCF) e o mesmo AA/AO do ALTO.
  ultra: {
    level: 'ultra', pixelRatio: 2, shadowMapSize: 4096, shadowDistance: 260,
    lodDistances: [650, 1300, 3400], vegetationDensity: 1, propsDistance: 450,
    ambientOcclusion: true, antialias: false, postAA: true, fogFar: 3400, cameraFar: 3800,
    pedestrians: 90, vehicles: 110, pedestrianRadius: 120, billboardDistance: 1200, npcShadowDistance: 50,
  },
};

/** Ajustes extras para toque/celular, aplicados sobre qualquer preset escolhido. */
export function mobileAdjust(p: QualityPreset): QualityPreset {
  return {
    ...p,
    pixelRatio: Math.min(p.pixelRatio, 1.5),
    shadowMapSize: Math.min(p.shadowMapSize, 1024),
    shadowDistance: Math.min(p.shadowDistance, 70),
    lodDistances: [Math.min(p.lodDistances[0], 220), Math.min(p.lodDistances[1], 520), Math.min(p.lodDistances[2], 1400)],
    pedestrians: Math.min(p.pedestrians, 12),
    vehicles: Math.min(p.vehicles, 20),
    pedestrianRadius: Math.min(p.pedestrianRadius, 60),
    ambientOcclusion: false,
    postAA: false,
    npcShadowDistance: 0,
    billboardDistance: Math.min(p.billboardDistance, 400),
  };
}

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
    if (/rtx [34]0[789]0|rx 7[89]00|apple m[3-9] (pro|max|ultra)/.test(g) && mem >= 8) return 'ultra';
    if (/apple m\d|apple gpu|rtx|radeon rx|geforce gtx 1[0-9]|rx 6|rx 7|arc a/.test(g) && mem >= 8) return 'high';
    if (/intel.*(uhd|hd)|mali|adreno|powervr/.test(g)) return mem >= 8 ? 'medium' : 'low';
    return 'medium';
  } catch {
    return 'medium';
  }
}

export function resolveQuality(choice: QualityChoice): QualityPreset {
  const p = PRESETS[choice === 'auto' ? detectQuality() : choice] ?? PRESETS.medium;
  return isTouchDevice() ? mobileAdjust(p) : p;
}

const STORAGE_KEY = 'pv3d.quality';
export function loadQualityChoice(): QualityChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'auto' || v === 'low' || v === 'medium' || v === 'high' || v === 'ultra') return v;
  } catch { /* storage indisponível */ }
  return 'auto';
}
export function saveQualityChoice(c: QualityChoice) {
  try { localStorage.setItem(STORAGE_KEY, c); } catch { /* ignore */ }
}
