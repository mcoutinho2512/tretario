/**
 * Kit de construção arquitetônica procedural para landmarks: primitivas com cor por vértice,
 * agrupadas por material e mescladas (poucos draw calls por landmark).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type ArchMat = 'stone' | 'dark' | 'metal' | 'glass';

export class ArchBuilder {
  private parts: Record<ArchMat, THREE.BufferGeometry[]> = { stone: [], dark: [], metal: [], glass: [] };
  /** transformação corrente (frame local do landmark) */
  frame = new THREE.Matrix4();

  add(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, mat: ArchMat = 'stone', jitter = 0.04): this {
    let geo = g.index ? g.toNonIndexed() : g;
    if (geo.attributes.uv) geo.deleteAttribute('uv');
    if (geo.attributes.uv1) geo.deleteAttribute('uv1');
    if (!geo.attributes.normal) geo.computeVertexNormals();
    geo = geo.applyMatrix4(this.frame);
    const c = new THREE.Color(color);
    const n = geo.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 3) {
      const j = 1 + (Math.random() - 0.5) * jitter;
      for (let k = 0; k < 3 && i + k < n; k++) {
        col[(i + k) * 3] = c.r * j; col[(i + k) * 3 + 1] = c.g * j; col[(i + k) * 3 + 2] = c.b * j;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts[mat].push(geo);
    return this;
  }

  box(w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, mat: ArchMat = 'stone', ry = 0): this {
    const g = new THREE.BoxGeometry(w, h, d);
    if (ry) g.rotateY(ry);
    g.translate(x, y + h / 2, z);
    return this.add(g, color, mat);
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
  archFrame(w: number, h: number, t: number, x: number, y: number, z: number, ry: number, color: THREE.ColorRepresentation, depth = 0.25): this {
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
    return this.add(g, color, 'stone');
  }

  /** Frontão triangular extrudado. */
  pediment(w: number, h: number, depth: number, x: number, y: number, z: number, ry: number, color: THREE.ColorRepresentation): this {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    s.lineTo(w / 2, 0);
    s.lineTo(0, h);
    s.lineTo(-w / 2, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
    g.translate(0, 0, -depth / 2);
    g.rotateY(ry);
    g.translate(x, y, z);
    return this.add(g, color, 'stone');
  }

  /** Balaustrada reta entre (x0,z0) e (x1,z1). */
  balustrade(x0: number, z0: number, x1: number, z1: number, y: number, color: THREE.ColorRepresentation, spacing = 0.45): this {
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
    gs.push(rail);
    const base = new THREE.BoxGeometry(len, 0.12, 0.34);
    base.rotateY(-ang);
    base.translate((x0 + x1) / 2, y + 0.06, (z0 + z1) / 2);
    gs.push(base);
    for (const g of gs) this.add(g, color, 'stone', 0.02);
    return this;
  }

  /** Estátua estilizada (silhueta) para coroamentos. */
  statue(x: number, y: number, z: number, color: THREE.ColorRepresentation, scale = 1): this {
    const g1 = new THREE.CylinderGeometry(0.28 * scale, 0.4 * scale, 0.45 * scale, 8);
    g1.translate(x, y + 0.22 * scale, z);
    const g2 = new THREE.CapsuleGeometry(0.28 * scale, 1.1 * scale, 3, 8);
    g2.translate(x, y + 1.15 * scale, z);
    const g3 = new THREE.SphereGeometry(0.2 * scale, 8, 6);
    g3.translate(x, y + 2.0 * scale, z);
    this.add(g1, color).add(g2, color).add(g3, color);
    return this;
  }

  build(materials: Record<ArchMat, THREE.Material>, name: string): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    for (const k of Object.keys(this.parts) as ArchMat[]) {
      if (!this.parts[k].length) continue;
      const merged = mergeGeometries(this.parts[k], false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const m = new THREE.Mesh(merged, materials[k]);
      m.castShadow = k !== 'glass';
      m.receiveShadow = true;
      m.name = `${name}_${k}`;
      group.add(m);
    }
    return group;
  }
}

/** Materiais dos landmarks: pedra com desgaste por ruído em coordenadas de mundo. */
export function createLandmarkMaterials(noise: THREE.Texture): Record<ArchMat, THREE.Material> {
  const stone = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  stone.onBeforeCompile = (shader) => {
    shader.uniforms.uNoise = { value: noise };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLWPos;\nvarying vec3 vLWNor;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvLWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvLWNor = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uNoise;\nvarying vec3 vLWPos;\nvarying vec3 vLWNor;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 an = abs(vLWNor);
          vec2 tuv = an.y > 0.6 ? vLWPos.xz : (an.x > an.z ? vLWPos.zy : vLWPos.xy);
          float n1 = texture2D(uNoise, tuv * 0.045).r;
          float n2 = texture2D(uNoise, tuv * 0.21).g;
          float streak = texture2D(uNoise, vec2(tuv.x * 0.09, vLWPos.y * 0.008)).a;
          float dirt = smoothstep(0.5, 0.9, streak) * 0.18 * (1.0 - an.y);
          diffuseColor.rgb *= (0.9 + n1 * 0.16 + (n2 - 0.5) * 0.08) * (1.0 - dirt);
          diffuseColor.rgb *= mix(0.78, 1.0, smoothstep(0.0, 2.5, vLWPos.y));
        }`);
  };
  stone.customProgramCacheKey = () => 'pv-landmark-stone';
  return {
    stone,
    dark: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.25 }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.85 }),
    glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.5 }),
  };
}

/** Recorte de polígono por semiplano (Sutherland–Hodgman): mantém pontos com f(p) >= 0. */
export function clipPolygonHalfPlane(poly: [number, number][], f: (p: [number, number]) => number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}
