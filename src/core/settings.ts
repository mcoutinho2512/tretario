/** Presets gráficos e detecção inicial de qualidade. */
import { currentDevice, type DeviceProfile } from './device';

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
  /** raio (m) da simulação de pedestres ao redor do jogador */
  pedestrianRadius: number;
  /** alcance de desenho dos painéis de LED */
  billboardDistance: number;
  /** sombras de NPCs até esta distância */
  npcShadowDistance: number;
  /** FPS alvo (30 em celular: estável e sem aquecer) e resolução dinâmica (definidos pelo aparelho) */
  targetFps?: 30 | 60;
  dynamicResolution?: boolean;
}

export const PRESETS: Record<QualityLevel, QualityPreset> = {
  low: {
    level: 'low', pixelRatio: 1, shadowMapSize: 0, shadowDistance: 0,
    lodDistances: [220, 520, 1400], vegetationDensity: 0.5, propsDistance: 140,
    ambientOcclusion: false, antialias: false, postAA: false, fogFar: 1500, cameraFar: 1800,
    pedestrians: 14, pedestrianRadius: 70, billboardDistance: 500, npcShadowDistance: 0,
  },
  medium: {
    level: 'medium', pixelRatio: 1.5, shadowMapSize: 2048, shadowDistance: 110,
    lodDistances: [330, 750, 2200], vegetationDensity: 0.85, propsDistance: 230,
    ambientOcclusion: false, antialias: true, postAA: false, fogFar: 2200, cameraFar: 2600,
    pedestrians: 32, pedestrianRadius: 90, billboardDistance: 750, npcShadowDistance: 25,
  },
  high: {
    level: 'high', pixelRatio: 2, shadowMapSize: 4096, shadowDistance: 170,
    lodDistances: [450, 1000, 3000], vegetationDensity: 1, propsDistance: 340,
    ambientOcclusion: true, antialias: false, postAA: true, fogFar: 3000, cameraFar: 3400,
    pedestrians: 56, pedestrianRadius: 95, billboardDistance: 900, npcShadowDistance: 35,
  },
  // ULTRA: não "aumenta tudo" — investe onde a diferença aparece na Pres. Vargas:
  // sombra mais longa (fachadas projetando sombra na avenida inteira), LOD FULL mais distante
  // (galerias/sinalização nítidas até o próximo cruzamento), mais pedestres no raio visível.
  // Mantém 4096² (só alarga a caixa: menos texels/m — compensado pelo PCF) e o mesmo AA/AO do ALTO.
  ultra: {
    level: 'ultra', pixelRatio: 2, shadowMapSize: 4096, shadowDistance: 260,
    lodDistances: [650, 1300, 3400], vegetationDensity: 1, propsDistance: 450,
    ambientOcclusion: true, antialias: false, postAA: true, fogFar: 3400, cameraFar: 3800,
    pedestrians: 90, pedestrianRadius: 120, billboardDistance: 1200, npcShadowDistance: 50,
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

let cachedDevice: DeviceProfile | null = null;
/** perfil do aparelho (uma vez por sessão) — ver src/core/device.ts */
export function deviceProfile(): DeviceProfile {
  cachedDevice ??= currentDevice();
  return cachedDevice;
}

/** preset recomendado para o aparelho (plataforma, GPU, memória) */
export function detectQuality(): QualityLevel {
  try { return deviceProfile().recommended; } catch { return 'medium'; }
}

export function resolveQuality(choice: QualityChoice): QualityPreset {
  const dev = deviceProfile();
  const base = PRESETS[choice === 'auto' ? dev.recommended : choice] ?? PRESETS.medium;
  const p = isTouchDevice() || dev.mobile ? mobileAdjust(base) : base;
  // ?fps=30|60 e ?dynres=0|1 sobrepõem (testes); celular continua a 30 mesmo com preset escolhido à mão
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const fps = q.get('fps') === '30' ? 30 : q.get('fps') === '60' ? 60 : dev.targetFps;
  const dyn = q.get('dynres') === '1' ? true : q.get('dynres') === '0' ? false : dev.dynamicResolution;
  return { ...p, targetFps: fps, dynamicResolution: dyn };
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
