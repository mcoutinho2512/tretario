/**
 * Assets do personagem humano (MakeHuman/MPFB2 + Universal Animation Library, ver docs/CHARACTERS.md):
 * GLBs por tipo de corpo e LOD em /characters, geometria comprimida (EXT_meshopt_compression).
 * Tudo carregado sob demanda e em cache; o LOD mais barato é baixado primeiro.
 */
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { BodyType } from '../bodyTypes';
import { pieceFile, type GarmentSlot } from '../garments';
import { assetManager } from '../../core/AssetManager';

export type Lod = 0 | 1 | 2 | 3;
export const LAYERS = ['BODY', 'HAIR', 'SHIRT', 'PANTS', 'SHOES', 'EYES', 'EYEBROWS', 'EYELASHES'] as const;
export type Layer = (typeof LAYERS)[number];
/** índice gravado no atributo _LAYER das malhas únicas (LOD2/LOD3) */
export const LAYER_INDEX: Record<string, number> = { BODY: 0, HAIR: 1, SHIRT: 2, PANTS: 3, SHOES: 4 };

const BASE = `${import.meta.env.BASE_URL ?? '/'}characters/`;
// carregamento/cache pelo AssetManager (uma carga por URL; texturas idênticas entre corpos e LODs compartilhadas)
const cache = new Map<string, Promise<GLTF>>();
export function loadLod(body: BodyType, lod: Lod): Promise<GLTF> {
  const file = lod === 0 ? `${body}.glb` : `${body}_lod${lod}.glb`;
  let p = cache.get(file);
  if (!p) {
    p = assetManager.loadGLTF(BASE + file, 'characters/assets');
    cache.set(file, p);
  }
  return p;
}

/** peça de roupa/cabelo variante (garments.ts): GLB avulso com o mesmo esqueleto do corpo, só LOD0/LOD1 */
export function loadPiece(body: BodyType, slot: GarmentSlot, style: string, lod: 0 | 1): Promise<GLTF> {
  const file = pieceFile(body, slot, style, lod);
  let p = cache.get(file);
  if (!p) {
    p = assetManager.loadGLTF(BASE + file, 'characters/assets').then((g) => {
      // peças nunca são reenviadas à GPU nem lidas na CPU (cor média vem do build): solta os pixels após o upload
      g.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        for (const t of [m?.map, m?.normalMap]) if (t) assetManager.releaseCpuAfterUpload(t);
      });
      return g;
    });
    cache.set(file, p);
  }
  return p;
}

let clipsP: Promise<{ clips: Map<string, THREE.AnimationClip>; pelvisRest: THREE.Vector3 }> | null = null;
/** clipes compartilhados (retargetados para o rig "game_engine"; posição da pelve relativa ao corpo-fonte) */
export function loadClips() {
  clipsP ??= assetManager.loadGLTF(`${BASE}anims.glb`, 'characters/assets').then((g) => {
    const clips = new Map(g.animations.map((c) => [c.name, c]));
    assetManager.registerClips('anims.glb', g.animations);
    const pelvis = g.scene.getObjectByName('pelvis');
    return { clips, pelvisRest: pelvis ? pelvis.position.clone() : new THREE.Vector3(0, 1, 0) };
  });
  return clipsP;
}

/** baixa o essencial em segundo plano: animações e os LODs baratos de todos os corpos (multidão) */
export function preloadCrowd(bodies: BodyType[]) {
  void loadClips();
  for (const b of bodies) { void loadLod(b, 3); void loadLod(b, 2); }
}

/** cor média de uma textura (para converter "cor desejada" em multiplicador sobre a textura) */
const avgCache = new WeakMap<THREE.Texture, THREE.Color>();
export function averageColor(tex: THREE.Texture | null, useAlpha = false): THREE.Color {
  if (!tex?.image) return new THREE.Color(1, 1, 1);
  const hit = avgCache.get(tex);
  if (hit) return hit;
  const c = new THREE.Color(1, 1, 1);
  try {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 16;
    const ctx = cv.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(tex.image as CanvasImageSource, 0, 0, 16, 16);
    const d = ctx.getImageData(0, 0, 16, 16).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (useAlpha && d[i + 3] < 128) continue; // cabelo: ignora texels transparentes (nas roupas o alfa é lixo)
      r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
    }
    if (n) c.setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
  } catch { /* imagem indisponível: sem correção */ }
  avgCache.set(tex, c);
  return c;
}
