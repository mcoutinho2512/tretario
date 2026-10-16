/**
 * Kit de construção arquitetônica procedural para landmarks: primitivas com cor por vértice,
 * agrupadas por material e mescladas (poucos draw calls por landmark).
 *
 * Rodada 5 (passada de fidelidade):
 *  - materiais PBR com textura de detalhe CC0 (Poly Haven) projetada em triplanar no espaço do mundo
 *    (albedo + normal + rugosidade) — reboco, revestimento de concreto art déco e granito;
 *  - dois níveis de detalhe: tier 0 (massa + fachada, sempre visível) e tier 1 (caixilhos, estátuas,
 *    balaustradas finas…) que some além de `LANDMARK_DETAIL_DIST`;
 *  - geradores de fachada (grade de janelas recuadas com pilastras, faixas "streamline") e de volumes
 *    a partir de polígonos reais (OSM).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { XZ } from '../types';

export type ArchMat = 'stone' | 'concrete' | 'granite' | 'dark' | 'metal' | 'glass';
const MAT_ORDER: ArchMat[] = ['stone', 'concrete', 'granite', 'dark', 'metal', 'glass'];

/** distância (m) além da qual o tier de detalhe dos landmarks é ocultado */
export const LANDMARK_DETAIL_DIST = 420;

/** Opções da grade de fachada (frame local: x ao longo, y para cima, z para fora; parede em z=0). */
export interface FacadeGridOpts {
  x0: number; x1: number;
  y0: number; floors: number; floorH: number;
  /** largura de cada vão (eixo a eixo); o número de vãos é ajustado para caber em x1−x0 */
  bay: number;
  winW: number; winH: number; sill: number;
  /** profundidade do quadro em volta das janelas (janela recuada) */
  frameD?: number;
  /** pilastras verticais contínuas entre os vãos (art déco); 0 = sem */
  pierW?: number; pierD?: number;
  /** a cada N vãos uma pilastra principal mais larga/saliente */
  majorEvery?: number; majorW?: number; majorD?: number;
  wall: THREE.ColorRepresentation; wallMat?: ArchMat;
  glass?: THREE.ColorRepresentation;
  /** caixilhos (tier de detalhe) */
  mullions?: boolean;
  /** "streamline": janelas em fita contínua (sem pilastras entre vãos) */
  ribbon?: boolean;
  /** desloca janelas alternadas (m) para agrupá-las em pares */
  pairShift?: number;
}

export class ArchBuilder {
  private parts = new Map<string, THREE.BufferGeometry[]>();
  /** transformação corrente (frame local do landmark) */
  frame = new THREE.Matrix4();
  /** 0 = sempre visível; 1 = detalhe (oculto à distância) */
  tier: 0 | 1 = 0;
  /** gerador determinístico (variação de cor reprodutível entre execuções) */
  private seed = 1234567;
  rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  add(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, mat: ArchMat = 'stone', jitter = 0.03): this {
    let geo = g.index ? g.toNonIndexed() : g;
    if (geo.attributes.uv) geo.deleteAttribute('uv');
    if (geo.attributes.uv1) geo.deleteAttribute('uv1');
    if (!geo.attributes.normal) geo.computeVertexNormals();
    geo = geo.applyMatrix4(this.frame);
    const c = new THREE.Color(color);
    const n = geo.attributes.position.count;
    const col = new Float32Array(n * 3);
    // uma variação por peça (não por triângulo: evita "facetas" manchadas em faces planas)
    const j = 1 + (this.rand() - 0.5) * jitter;
    for (let i = 0; i < n; i++) { col[i * 3] = c.r * j; col[i * 3 + 1] = c.g * j; col[i * 3 + 2] = c.b * j; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const key = `${mat}|${this.tier}`;
    let list = this.parts.get(key);
    if (!list) this.parts.set(key, (list = []));
    list.push(geo);
    return this;
  }

  /** executa `fn` com o frame = frame atual · local (restaurado ao final) */
  withFrame(local: THREE.Matrix4, fn: () => void): this {
    const saved = this.frame.clone();
    this.frame.multiply(local);
    try { fn(); } finally { this.frame.copy(saved); }
    return this;
  }

  /** executa `fn` no tier de detalhe */
  detail(fn: () => void): this {
    const t = this.tier;
    this.tier = 1;
    try { fn(); } finally { this.tier = t; }
    return this;
  }

  box(w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, mat: ArchMat = 'stone', ry = 0): this {
    if (w <= 0 || h <= 0 || d <= 0) return this;
    const g = new THREE.BoxGeometry(w, h, d);
    if (ry) g.rotateY(ry);
    g.translate(x, y + h / 2, z);
    return this.add(g, color, mat);
  }

  /** placa retangular vertical (normal +Z local antes de ry) */
  quad(w: number, h: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, mat: ArchMat = 'glass', ry = 0): this {
    const g = new THREE.PlaneGeometry(w, h);
    if (ry) g.rotateY(ry);
    g.translate(x, y + h / 2, z);
    return this.add(g, color, mat, 0.08);
  }

  cyl(rTop: number, rBot: number, h: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, seg = 16, mat: ArchMat = 'stone'): this {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);
    g.translate(x, y + h / 2, z);
    return this.add(g, color, mat);
  }

  lathe(profile: [number, number][], x: number, y: number, z: number, color: THREE.ColorRepresentation, seg = 32, mat: ArchMat = 'stone'): this {
    const g = new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), seg);
    g.translate(x, y, z);
    return this.add(g, color, mat);
  }

  /** Abertura em arco (janela/porta) como placa fina saliente. Normal local +Z antes da rotação ry. */
  archOpening(w: number, h: number, x: number, y: number, z: number, ry: number, color: THREE.ColorRepresentation, depth = 0.12, mat: ArchMat = 'dark'): this {
    const s = new THREE.Shape();
    const r = w / 2;
    s.moveTo(-r, 0);
    s.lineTo(r, 0);
    s.lineTo(r, h - r);
    s.absarc(0, h - r, r, 0, Math.PI, false);
    s.lineTo(-r, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 10 });
    g.rotateY(ry);
    g.translate(x, y, z);
    return this.add(g, color, mat);
  }

  /** Moldura em arco (granito) em volta de uma abertura. */
  archFrame(w: number, h: number, t: number, x: number, y: number, z: number, ry: number, color: THREE.ColorRepresentation, depth = 0.25, mat: ArchMat = 'stone'): this {
    const s = new THREE.Shape();
    const R = w / 2 + t, r = w / 2;
    s.moveTo(-R, 0);
    s.lineTo(-r, 0);
    s.lineTo(-r, h - r);
    s.absarc(0, h - r, r, Math.PI, 0, true);
    s.lineTo(r, 0);
    s.lineTo(R, 0);
    s.lineTo(R, h - r);
    s.absarc(0, h - r, R, 0, Math.PI, false);
    s.lineTo(-R, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 10 });
    g.rotateY(ry);
    g.translate(x, y, z);
    return this.add(g, color, mat);
  }

  /** Frontão triangular extrudado. */
  pediment(w: number, h: number, depth: number, x: number, y: number, z: number, ry: number, color: THREE.ColorRepresentation, mat: ArchMat = 'stone'): this {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    s.lineTo(w / 2, 0);
    s.lineTo(0, h);
    s.lineTo(-w / 2, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
    g.translate(0, 0, -depth / 2);
    g.rotateY(ry);
    g.translate(x, y, z);
    return this.add(g, color, mat);
  }

  /** Frontão curvo (segmental) extrudado: arco de largura w e flecha h. */
  segmentalPediment(w: number, h: number, t: number, depth: number, x: number, y: number, z: number, ry: number, color: THREE.ColorRepresentation, mat: ArchMat = 'stone'): this {
    const R = (w * w / 4 + h * h) / (2 * h);
    const a0 = Math.asin(Math.min(1, w / 2 / R));
    const s = new THREE.Shape();
    const cy = h - R;
    s.absarc(0, cy, R, Math.PI / 2 + a0, Math.PI / 2 - a0, true);
    s.absarc(0, cy, R - t, Math.PI / 2 - a0, Math.PI / 2 + a0, false);
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 12 });
    g.translate(0, 0, -depth / 2);
    g.rotateY(ry);
    g.translate(x, y, z);
    return this.add(g, color, mat);
  }

  /** Balaustrada reta entre (x0,z0) e (x1,z1). */
  balustrade(x0: number, z0: number, x1: number, z1: number, y: number, color: THREE.ColorRepresentation, spacing = 0.45, mat: ArchMat = 'stone'): this {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ang = Math.atan2(z1 - z0, x1 - x0);
    const n = Math.max(2, Math.floor(len / spacing));
    const gs: THREE.BufferGeometry[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const g = new THREE.CylinderGeometry(0.07, 0.11, 0.8, 6);
      g.translate(x0 + (x1 - x0) * t, y + 0.5, z0 + (z1 - z0) * t);
      gs.push(g);
    }
    const rail = new THREE.BoxGeometry(len, 0.14, 0.32);
    rail.rotateY(-ang);
    rail.translate((x0 + x1) / 2, y + 0.97, (z0 + z1) / 2);
    const base = new THREE.BoxGeometry(len, 0.12, 0.34);
    base.rotateY(-ang);
    base.translate((x0 + x1) / 2, y + 0.06, (z0 + z1) / 2);
    // balaústres = detalhe; corrimão e base = massa
    this.detail(() => { for (const g of gs) this.add(g, color, mat, 0.02); });
    this.add(rail, color, mat, 0.02).add(base, color, mat, 0.02);
    return this;
  }

  /** Estátua estilizada (silhueta) para coroamentos. */
  statue(x: number, y: number, z: number, color: THREE.ColorRepresentation, scale = 1, mat: ArchMat = 'stone'): this {
    const g1 = new THREE.CylinderGeometry(0.28 * scale, 0.4 * scale, 0.45 * scale, 8);
    g1.translate(x, y + 0.22 * scale, z);
    const g2 = new THREE.CapsuleGeometry(0.28 * scale, 1.1 * scale, 3, 8);
    g2.translate(x, y + 1.15 * scale, z);
    const g3 = new THREE.SphereGeometry(0.2 * scale, 8, 6);
    g3.translate(x, y + 2.0 * scale, z);
    this.add(g1, color, mat).add(g2, color, mat).add(g3, color, mat);
    return this;
  }

  /** Pináculo/obelisco barroco (base, agulha e bola). */
  finial(x: number, y: number, z: number, h: number, color: THREE.ColorRepresentation, mat: ArchMat = 'stone'): this {
    const w = h * 0.22;
    this.box(w * 1.4, h * 0.18, w * 1.4, x, y, z, color, mat);
    this.add(new THREE.CylinderGeometry(w * 0.12, w * 0.55, h * 0.62, 4).rotateY(Math.PI / 4).translate(x, y + h * 0.18 + h * 0.31, z), color, mat);
    this.add(new THREE.SphereGeometry(w * 0.32, 8, 6).translate(x, y + h * 0.88, z), color, mat);
    return this;
  }

  /** Volume extrudado a partir de um polígono XZ (anel externo + furos), entre y0 e y1. */
  prism(outer: XZ[], y0: number, y1: number, color: THREE.ColorRepresentation, mat: ArchMat = 'stone', holes: XZ[][] = []): this {
    if (outer.length < 3 || y1 <= y0) return this;
    const s = new THREE.Shape(outer.map(([x, z]) => new THREE.Vector2(x, -z)));
    for (const h of holes) if (h.length >= 3) s.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))));
    const g = new THREE.ExtrudeGeometry(s, { depth: y1 - y0, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    g.translate(0, y0, 0);
    return this.add(g, color, mat, 0.01);
  }

  /**
   * Grade de fachada no frame local (parede em z=0, para fora +z): "pele" saliente com recortes
   * das janelas (faixas horizontais + pilastras contínuas), vidro recuado e caixilhos (detalhe).
   * Retorna o número de vãos.
   */
  facadeGrid(o: FacadeGridOpts): number {
    const width = o.x1 - o.x0;
    if (width < 1 || o.floors < 1) return 0;
    const nb = Math.max(1, Math.round(width / o.bay));
    const bay = width / nb;
    const winW = Math.min(o.winW, bay - 0.3);
    const fd = o.frameD ?? 0.28;
    const wm = o.wallMat ?? 'stone';
    const glass = o.glass ?? 0x2a3138;
    const top = o.y0 + o.floors * o.floorH;
    // faixas horizontais (peitoris + vergas), largura total
    const strip = (ya: number, yb: number) => this.box(width, yb - ya, fd, (o.x0 + o.x1) / 2, ya, fd / 2, o.wall, wm);
    strip(o.y0, o.y0 + o.sill);
    for (let k = 0; k < o.floors; k++) {
      const ya = o.y0 + k * o.floorH + o.sill + o.winH;
      const yb = k === o.floors - 1 ? top : o.y0 + (k + 1) * o.floorH + o.sill;
      strip(ya, yb);
    }
    // posição das janelas (com deslocamento opcional para agrupá-las em pares)
    const shift = o.pairShift ?? 0;
    const wx = (i: number) => o.x0 + (i + 0.5) * bay + (shift ? (i % 2 === 0 ? shift : -shift) : 0);
    // montantes entre janelas (dentro das faixas de janela)
    const pierW = o.ribbon ? 0 : (o.pierW ?? 0);
    for (let i = 0; i <= nb; i++) {
      const major = o.majorEvery && i % o.majorEvery === 0;
      if (o.ribbon && i > 0 && i < nb) continue;
      const a = i > 0 && !o.ribbon ? wx(i - 1) + winW / 2 : i > 0 ? o.x1 - (bay - winW) / 2 : o.x0;
      const b = i < nb && !o.ribbon ? wx(i) - winW / 2 : i < nb ? o.x0 + (bay - winW) / 2 : o.x1;
      const w = b - a;
      if (w <= 0.01) continue;
      const cx = (a + b) / 2;
      if (pierW > 0 || major) {
        // pilastra contínua (mais saliente que as faixas → ênfase vertical)
        const pw = major ? Math.max(w, o.majorW ?? w * 1.4) : w;
        const pd = fd + (major ? (o.majorD ?? 0.35) : (o.pierD ?? 0.12));
        this.box(pw, top - o.y0, pd, cx, o.y0, pd / 2, o.wall, wm);
      } else {
        for (let k = 0; k < o.floors; k++) this.box(w, o.winH, fd, cx, o.y0 + k * o.floorH + o.sill, fd / 2, o.wall, wm);
      }
    }
    if (o.ribbon) {
      // fita contínua: um vidro por pavimento + montantes finos (detalhe)
      for (let k = 0; k < o.floors; k++) {
        const y = o.y0 + k * o.floorH + o.sill;
        this.quad(width - bay + winW, o.winH, (o.x0 + o.x1) / 2, y, 0.02, glass, 'glass');
        if (o.mullions) this.detail(() => {
          for (let x = o.x0 + 1.2; x < o.x1 - 0.6; x += 1.2) this.box(0.08, o.winH, 0.08, x, y, 0.06, 0x3a3d40, 'metal');
          this.box(width - bay + winW, 0.07, 0.08, (o.x0 + o.x1) / 2, y + o.winH * 0.62, 0.06, 0x3a3d40, 'metal');
        });
      }
      return nb;
    }
    // vidros (com leve variação: persianas/cortinas) + caixilhos
    for (let k = 0; k < o.floors; k++) {
      const y = o.y0 + k * o.floorH + o.sill;
      for (let i = 0; i < nb; i++) {
        const x = wx(i);
        const r = this.rand();
        const c = r < 0.12 ? 0x6d6a62 : r < 0.2 ? 0x4b4d4c : glass;
        this.quad(winW, o.winH, x, y, 0.02, c, 'glass');
        if (o.mullions) this.detail(() => {
          this.box(0.07, o.winH, 0.07, x, y, 0.05, 0x3a3d40, 'metal');
          this.box(winW, 0.06, 0.07, x, y + o.winH * 0.66, 0.05, 0x3a3d40, 'metal');
        });
      }
    }
    return nb;
  }

  /**
   * Frames de fachada para cada aresta de um polígono (x ao longo da aresta, z para fora).
   * `fn(frame, len, i)` recebe a matriz local; arestas mais curtas que `minLen` são ignoradas.
   */
  static edgeFrames(poly: XZ[], minLen: number, fn: (m: THREE.Matrix4, len: number, i: number, a: XZ, b: XZ) => void) {
    let area = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    for (let i = 0; i < poly.length; i++) {
      let a = poly[i], b = poly[(i + 1) % poly.length];
      // anel CCW em (x,z) com z para o sul → para fora = (−dz, dx) quando area < 0
      if (area > 0) [a, b] = [b, a];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < minLen) continue;
      const ux = dx / len, uz = dz / len;
      // eixos: x=(ux,0,uz), y=(0,1,0), z = x × y = (−uz,0,ux)
      const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(ux, 0, uz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-uz, 0, ux));
      m.setPosition(a[0], 0, a[1]);
      fn(m, len, i, a, b);
    }
  }

  build(materials: Record<ArchMat, THREE.Material>, name: string): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    const detail = new THREE.Group();
    detail.name = `${name}_detail`;
    for (const tier of [0, 1] as const) {
      for (const k of MAT_ORDER) {
        const list = this.parts.get(`${k}|${tier}`);
        if (!list?.length) continue;
        const merged = mergeGeometries(list, false);
        if (!merged) continue;
        merged.computeBoundingSphere();
        const m = new THREE.Mesh(merged, materials[k]);
        m.castShadow = k !== 'glass' && tier === 0;
        m.receiveShadow = true;
        m.name = `${name}_${k}${tier ? '_d' : ''}`;
        (tier ? detail : group).add(m);
      }
    }
    if (detail.children.length) group.add(detail);
    group.userData.detail = detail;
    return group;
  }

  triangleCount(): number {
    let n = 0;
    for (const list of this.parts.values()) for (const g of list) n += g.attributes.position.count / 3;
    return n;
  }
}

/** Liga/desliga o tier de detalhe de um grupo construído pelo ArchBuilder conforme a distância da câmera. */
export function updateDetailLod(group: THREE.Object3D, center: THREE.Vector3, cameraPos: THREE.Vector3, dist = LANDMARK_DETAIL_DIST) {
  const d = group.userData.detail as THREE.Object3D | undefined;
  if (d) d.visible = cameraPos.distanceTo(center) < dist;
}

/** Texturas de detalhe (R,G = normal tangente; B = luminância do albedo) — ver docs/licenses/landmarks.md */
export interface LandmarkTextures { plaster: THREE.Texture; concrete: THREE.Texture; granite: THREE.Texture }

export async function loadLandmarkTextures(base: string): Promise<LandmarkTextures> {
  const loader = new THREE.TextureLoader();
  const load = async (f: string) => {
    const t = await loader.loadAsync(`${base}${f}`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 8;
    return t;
  };
  const [plaster, concrete, granite] = await Promise.all([load('plaster_detail.jpg'), load('concrete_detail.jpg'), load('granite_detail.jpg')]);
  return { plaster, concrete, granite };
}

/**
 * Material de pedra/reboco: cor por vértice × textura de detalhe triplanar (mundo) + normal
 * perturbada + rugosidade variável + escorridos de sujeira e base mais escura (umidade).
 */
function detailStone(noise: THREE.Texture, tex: THREE.Texture | null, tile: number, opts: { roughness: number; normal: number; lum: number; metal?: number; grime?: number; key: string }) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: opts.roughness, metalness: opts.metal ?? 0 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uNoise = { value: noise };
    shader.uniforms.uDetail = { value: tex };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLWPos;\nvarying vec3 vLWNor;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvLWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvLWNor = normalize(mat3(modelMatrix) * objectNormal);');
    const useTex = !!tex;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uNoise;
        uniform sampler2D uDetail;
        varying vec3 vLWPos;
        varying vec3 vLWNor;
        vec3 gW; vec4 gTx; vec4 gTy; vec4 gTz; float gLum;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 an = abs(vLWNor);
          gW = pow(an, vec3(4.0)); gW /= (gW.x + gW.y + gW.z + 1e-5);
          ${useTex ? `
          float s = ${(1 / tile).toFixed(5)};
          gTx = texture2D(uDetail, vLWPos.zy * s);
          gTy = texture2D(uDetail, vLWPos.xz * s);
          gTz = texture2D(uDetail, vLWPos.xy * s);
          gLum = gTx.b * gW.x + gTy.b * gW.y + gTz.b * gW.z;
          diffuseColor.rgb *= 1.0 + (gLum - 0.5) * ${opts.lum.toFixed(3)};` : 'gLum = 0.5;'}
          vec2 tuv = an.y > 0.6 ? vLWPos.xz : (an.x > an.z ? vLWPos.zy : vLWPos.xy);
          float n1 = texture2D(uNoise, tuv * 0.045).r;
          float n2 = texture2D(uNoise, tuv * 0.21).g;
          float streak = texture2D(uNoise, vec2(tuv.x * 0.09, vLWPos.y * 0.008)).a;
          float dirt = smoothstep(0.55, 0.95, streak) * ${(opts.grime ?? 0.1).toFixed(3)} * (1.0 - an.y);
          diffuseColor.rgb *= (0.93 + n1 * 0.1 + (n2 - 0.5) * 0.05) * (1.0 - dirt);
          diffuseColor.rgb *= mix(0.8, 1.0, smoothstep(0.0, 2.2, vLWPos.y));
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * (1.18 - gLum * 0.36), 0.04, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        ${useTex ? `{
          vec3 px = vec3(0.0, gTx.g * 2.0 - 1.0, gTx.r * 2.0 - 1.0);
          vec3 py = vec3(gTy.r * 2.0 - 1.0, 0.0, gTy.g * 2.0 - 1.0);
          vec3 pz = vec3(gTz.r * 2.0 - 1.0, gTz.g * 2.0 - 1.0, 0.0);
          vec3 nW = normalize(vLWNor + ${opts.normal.toFixed(3)} * (px * gW.x + py * gW.y + pz * gW.z));
          vec3 nV = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
          normal = faceDirection * nV;
        }` : ''}`);
  };
  m.customProgramCacheKey = () => `pv-landmark-${opts.key}`;
  return m;
}

/** Materiais dos landmarks (PBR com detalhe triplanar quando as texturas estão disponíveis). */
export function createLandmarkMaterials(noise: THREE.Texture, tex?: LandmarkTextures): Record<ArchMat, THREE.Material> {
  return {
    stone: detailStone(noise, tex?.plaster ?? null, 2.2, { roughness: 0.86, normal: 1.2, lum: 1.3, grime: 0.12, key: 'stone' }),
    concrete: detailStone(noise, tex?.concrete ?? null, 3.4, { roughness: 0.8, normal: 1.6, lum: 1.8, grime: 0.15, key: 'concrete' }),
    granite: detailStone(noise, tex?.granite ?? null, 1.6, { roughness: 0.42, normal: 0.7, lum: 1.3, grime: 0.04, key: 'granite' }),
    dark: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1 }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.85 }),
    glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.18, metalness: 0.1, envMapIntensity: 0.7 }),
  };
}

export { clipPolygonHalfPlane } from './colliders';
