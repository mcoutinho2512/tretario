/**
 * Bandeiras e faixas FIXAS de cenário (palco, trio, carro de som, decoração da avenida) — mesmos materiais e
 * shader de tecido dos itens na mão, em escala grande:
 *
 *   const f = createBigFlag({ design: 1 });          // mastro de 7 m, bandeira 6 × 4,2 m
 *   scene.add(f.object); …  f.update(dt, camera);    // a cada quadro (giro a favor do vento + LOD do tecido)
 *   f.dispose();
 *
 *   const b = createStaticBanner({ design: 30, width: 8 });  // faixa entre dois mastros (palco, ou entre 2 pessoas)
 *
 * Origem no pé do mastro (chão). O tecido gira em torno do mastro para ficar a favor do vento (`setPropWind`).
 */
import * as THREE from 'three';
import { assetManager } from '../../core/AssetManager';
import { clothGeometry } from './propGeometry';
import { PROP_CATEGORY, acquireDesignMaterial, propBodyMaterial, propWind, releaseDesignMaterial, tickPropClock } from './propMaterials';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface BigFlagOptions {
  /** id do design (designs.ts) */
  design: number;
  /** altura do mastro (m) — padrão 7 */
  poleHeight?: number;
  /** largura do tecido (m) — padrão 6; a altura segue a proporção das bandeiras (1,43) */
  flagW?: number;
  flagH?: number;
  /** base de concreto (desligue se o mastro sai de um palco/caminhão) */
  base?: boolean;
  /** distância (m) a partir da qual o tecido usa a malha/shader barato */
  cheapDist?: number;
}

export interface SceneFlag {
  object: THREE.Group;
  update(dt: number, camera?: THREE.Camera): void;
  dispose(): void;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function colored(g: THREE.BufferGeometry, hex: number, rough: number, metal: number, m?: THREE.Matrix4) {
  if (m) g.applyMatrix4(m);
  if (!g.index) g.setIndex([...Array(g.getAttribute('position').count).keys()]);
  const n = g.getAttribute('position').count;
  const c = new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
  const col = new Float32Array(n * 3), pbr = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { col.set([c.r, c.g, c.b], i * 3); pbr.set([rough, metal], i * 2); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aPbr', new THREE.BufferAttribute(pbr, 2));
  return g;
}

/** mastro (cônico, alumínio escovado), ponteira, adriça, presilha e base — uma malha só */
function poleGeometry(h: number, base: boolean): THREE.BufferGeometry {
  const key = `${h}:${base}`;
  let g = geoCache.get(key);
  if (g) return g;
  const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
  const r0 = 0.065 * Math.max(0.6, h / 7), r1 = r0 * 0.62;
  const list = [
    colored(new THREE.CylinderGeometry(r1, r0, h, 20), 0xc3c7cc, 0.3, 0.92, T(0, h / 2, 0)),
    colored(new THREE.SphereGeometry(r0 * 1.5, 16, 10), 0xc8a24a, 0.3, 0.9, T(0, h + r0 * 1.2, 0)),
    // caminhão (roldana) no topo e anel do pé
    colored(new THREE.CylinderGeometry(r1 * 1.5, r1 * 1.5, 0.08, 16), 0x8d9196, 0.4, 0.9, T(0, h - 0.04, 0)),
    colored(new THREE.CylinderGeometry(r0 * 1.4, r0 * 1.6, 0.12, 20), 0x8d9196, 0.45, 0.9, T(0, 0.06, 0)),
    // adriça (corda) descendo pelo lado do tecido até a presilha
    colored(new THREE.CylinderGeometry(0.006, 0.006, h - 1.3, 4), 0xe8e4da, 0.85, 0, T(r0 + 0.02, 1.3 + (h - 1.3) / 2, 0.02)),
    colored(new THREE.BoxGeometry(0.03, 0.14, 0.04), 0x2b2b2b, 0.5, 0.6, T(r0 + 0.015, 1.25, 0)),
  ];
  if (base) {
    list.push(colored(new THREE.BoxGeometry(0.7, 0.35, 0.7), 0xa29d93, 0.92, 0, T(0, 0.175, 0)));
    list.push(colored(new THREE.BoxGeometry(0.76, 0.04, 0.76), 0x8f8a80, 0.95, 0, T(0, 0.02, 0)));
  }
  for (const x of list) for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv', 'color', 'aPbr'].includes(k)) x.deleteAttribute(k);
  for (const x of list) if (!x.getAttribute('uv')) x.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(x.getAttribute('position').count * 2), 2));
  g = mergeGeometries(list, false)!;
  list.forEach((x) => x.dispose());
  g.name = `bigflag_pole_${key}`;
  g.computeBoundingSphere();
  assetManager.register({ category: PROP_CATEGORY, geometry: g });
  geoCache.set(key, g);
  return g;
}

/** bandeira grande de mastro fixo */
export function createBigFlag(o: BigFlagOptions): SceneFlag {
  const H = o.poleHeight ?? 7, W = o.flagW ?? 6, FH = o.flagH ?? +(W / 1.43).toFixed(2);
  const cheapDist = o.cheapDist ?? 90;
  const object = new THREE.Group();
  object.name = 'big_flag';
  const pole = new THREE.Mesh(poleGeometry(H, o.base ?? true), propBodyMaterial());
  pole.castShadow = true;
  pole.receiveShadow = true;
  object.add(pole);
  const pivot = new THREE.Group();
  pivot.position.set(0, H - 0.12, 0);
  object.add(pivot);
  let lod: 0 | 1 = 0;
  const mat = () => acquireDesignMaterial('big', o.design, [W, FH], lod > 0);
  const cloth = new THREE.Mesh(clothGeometry('big', lod, W, FH), mat());
  cloth.position.x = 0.075; // argolas/adriça entre o mastro e o tecido
  cloth.receiveShadow = true;
  cloth.onBeforeRender = tickPropClock;
  pivot.add(cloth);
  let yaw = Math.atan2(-propWind.dirZ, propWind.dirX);
  const _w = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _c = new THREE.Vector3();
  return {
    object,
    update(dt, camera) {
      // giro a favor do vento, suave (vento no mundo → referencial do objeto)
      object.updateWorldMatrix(true, false);
      object.getWorldQuaternion(_q).invert();
      _w.set(propWind.dirX, 0, propWind.dirZ).applyQuaternion(_q);
      const target = Math.atan2(-_w.z, _w.x);
      const d = Math.atan2(Math.sin(target - yaw), Math.cos(target - yaw));
      yaw += d * Math.min(1, dt * 0.8);
      pivot.rotation.y = yaw;
      if (camera) {
        const far = camera.getWorldPosition(_c).distanceTo(object.getWorldPosition(_w)) > cheapDist ? 1 : 0;
        if (far !== lod) {
          const old = cloth.material as THREE.Material;
          lod = far;
          cloth.geometry = clothGeometry('big', lod, W, FH);
          cloth.material = mat();
          releaseDesignMaterial(old);
        }
      }
    },
    dispose() {
      releaseDesignMaterial(cloth.material as THREE.Material);
      object.removeFromParent();
    },
  };
}

export interface StaticBannerOptions {
  design: number;
  /** distância entre os mastros (m) */
  width?: number;
  /** altura do pano (m); padrão: proporção das faixas (3,4) */
  height?: number;
  /** altura dos mastros (m) */
  poleHeight?: number;
}

/** faixa entre dois mastros (palco, carro de som, ou levada por duas pessoas: posicione os mastros nas mãos) */
export function createStaticBanner(o: StaticBannerOptions): SceneFlag {
  const W = o.width ?? 4, FH = o.height ?? +(W / 3.4).toFixed(2), PH = o.poleHeight ?? FH + 1.4;
  const object = new THREE.Group();
  object.name = 'static_banner';
  const poleGeo = poleGeometry(PH, false);
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(poleGeo, propBodyMaterial());
    p.scale.set(0.5, 1, 0.5); // mastro mais fino que o da bandeira grande
    p.position.x = (s * W) / 2;
    p.castShadow = true;
    object.add(p);
  }
  const cloth = new THREE.Mesh(clothGeometry('banner', 0, W, FH), acquireDesignMaterial('banner', o.design, [W, FH]));
  cloth.position.set(-W / 2, PH - 0.1, 0);
  cloth.receiveShadow = true;
  cloth.onBeforeRender = tickPropClock;
  object.add(cloth);
  return {
    object,
    update() { /* faixa presa nas duas pontas: só o shader anima */ },
    dispose() { releaseDesignMaterial(cloth.material as THREE.Material); object.removeFromParent(); },
  };
}
