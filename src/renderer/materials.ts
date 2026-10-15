/**
 * Biblioteca central de materiais (poucos materiais compartilhados → poucas trocas de estado/draw calls).
 * Superfícies usam UV em metros (coordenadas do mundo) — `repeat` define o tamanho do tile.
 */
import * as THREE from 'three';
import {
  asphaltTexture, portugueseStoneTexture, concreteSlabTexture, grassTexture, ballastTexture, trackbedTexture,
  paintWearTexture, noiseTexture, type PbrSet,
} from './textures';

export interface MaterialLibrary {
  asphalt: THREE.MeshStandardMaterial;
  sidewalk: THREE.MeshStandardMaterial;
  plaza: THREE.MeshStandardMaterial;
  grass: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  curb: THREE.MeshStandardMaterial;
  ballast: THREE.MeshStandardMaterial;
  trackbed: THREE.MeshStandardMaterial;
  water: THREE.MeshStandardMaterial;
  paintWhite: THREE.MeshStandardMaterial;
  paintYellow: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  darkMetal: THREE.MeshStandardMaterial;
  noise: THREE.Texture;
}

function pbr(set: PbrSet, tileMeters: number, opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  for (const t of [set.map, set.normalMap, set.roughnessMap]) t.repeat.set(1 / tileMeters, 1 / tileMeters);
  return new THREE.MeshStandardMaterial({
    map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap, roughness: 1, metalness: 0, ...opts,
  });
}

/**
 * Quebra de repetição: mistura uma variação de baixa frequência (macro) sobre o albedo
 * usando a posição do mundo — evita padrão de "ladrilho" visível em grandes áreas.
 */
function addMacroVariation(mat: THREE.MeshStandardMaterial, noise: THREE.Texture, strength: number, scale: number) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMacroNoise = { value: noise };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\nuniform sampler2D uMacroNoise;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          float m1 = texture2D(uMacroNoise, vWPos.xz * ${(1 / scale).toFixed(5)}).r;
          float m2 = texture2D(uMacroNoise, vWPos.xz * ${(1 / (scale * 0.21)).toFixed(5)}).a;
          diffuseColor.rgb *= 1.0 + ((m1 - 0.5) * 0.9 + (m2 - 0.5) * 0.5) * ${strength.toFixed(3)};
        }`);
  };
  mat.customProgramCacheKey = () => `macro-${strength}-${scale}`;
}

export async function createMaterialLibrary(onStep?: (label: string) => void): Promise<MaterialLibrary> {
  const yieldFrame = () => new Promise((r) => setTimeout(r, 0));
  const noise = noiseTexture(256);
  onStep?.('asfalto');
  await yieldFrame();
  const asphalt = pbr(asphaltTexture(1024), 9, { color: 0xffffff });
  addMacroVariation(asphalt, noise, 0.35, 70);
  onStep?.('pedra portuguesa');
  await yieldFrame();
  const sidewalk = pbr(portugueseStoneTexture(1024, 'plain', 110), 5.5, { color: 0xf2efe8 });
  addMacroVariation(sidewalk, noise, 0.3, 45);
  await yieldFrame();
  const plaza = pbr(portugueseStoneTexture(1024, 'wave', 120), 6.5);
  addMacroVariation(plaza, noise, 0.25, 50);
  onStep?.('vegetação');
  await yieldFrame();
  const grass = pbr(grassTexture(512), 4, { color: 0xd8e8c8 });
  addMacroVariation(grass, noise, 0.6, 30);
  onStep?.('concreto e brita');
  await yieldFrame();
  const concrete = pbr(concreteSlabTexture(512, 4, 0.62), 6);
  addMacroVariation(concrete, noise, 0.3, 40);
  const curb = pbr(concreteSlabTexture(256, 2, 0.72), 2, { color: 0xe8e6e0 });
  const ballast = pbr(ballastTexture(512), 3);
  const tb = trackbedTexture(512);
  const trackbed = new THREE.MeshStandardMaterial({ map: tb.map, normalMap: tb.normalMap, roughnessMap: tb.roughnessMap, roughness: 1 });
  for (const t of [tb.map, tb.normalMap, tb.roughnessMap]) t.repeat.set(1 / 4.8, 1);

  const wear = paintWearTexture(256);
  wear.repeat.set(1 / 3, 1 / 3);
  const paintOpts: THREE.MeshStandardMaterialParameters = {
    roughness: 0.62, metalness: 0, alphaMap: wear, alphaTest: 0.5,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  };
  const paintWhite = new THREE.MeshStandardMaterial({ color: 0xdcdcd4, ...paintOpts });
  const paintYellow = new THREE.MeshStandardMaterial({ color: 0xd9a21c, ...paintOpts });

  const water = new THREE.MeshStandardMaterial({ color: 0x2a3d3a, roughness: 0.08, metalness: 0.2 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.35, metalness: 0.9 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.55, metalness: 0.6 });
  return { asphalt, sidewalk, plaza, grass, concrete, curb, ballast, trackbed, water, paintWhite, paintYellow, steel, darkMetal, noise };
}
