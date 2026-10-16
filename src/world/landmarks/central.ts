/**
 * LANDMARK_CENTRAL — Estação Central do Brasil (Edifício D. Pedro II, art déco, 1943).
 *
 * Fontes de forma/proporção (detalhes, medidas e confiança em docs/LANDMARKS.md):
 *  - footprint real do OSM (way 81100866) — implantação, cantos arredondados (streamline) do contorno;
 *  - torre de 110 m / 32 pavimentos, estrutura total ~135 m com antenas; relógio de 4 faces com
 *    mostrador de 10 m entre o 21º e o 26º pavimento (Diário do Rio, 2023);
 *  - fotos Wikimedia Commons (2011–2021): fuste com cantos reentrantes e pilastras contínuas,
 *    topo do fuste "serrilhado" (pilastras escalonadas), estágio do relógio mais estreito com
 *    cantos recuados escuros, coroamento estriado mais estreito e mastro de antenas; a torre desce
 *    até o chão entre duas alas de 7 pavimentos com pontas arredondadas e janelas em fita.
 * Itens sem medida publicada (larguras, recuos, alturas das alas) são ESTIMATIVAS por proporção nas fotos.
 */
import * as THREE from 'three';
import type { LandmarkRec, XZ } from '../types';
import { ArchBuilder, updateDetailLod, type ArchMat } from './arch';
import { CENTRAL_PARAMS, centralPlan, centralColliders } from './colliders';
export { CENTRAL_PARAMS } from './colliders';

export interface LandmarkInstance {
  group: THREE.Group;
  /** volumes para colisão: polígono + altura */
  colliders: { poly: XZ[]; height: number; minHeight?: number }[];
  update(simTime: Date, cameraPos: THREE.Vector3): void;
}

const CREAM = 0xe3d9c3; // revestimento claro (concreto/pó de pedra)
const CREAM_SHADE = 0xd6cbb3; // pilastras / cornijas
const BASE_GRANITE = 0xa49c92; // embasamento em granito cinza
const GLASS = 0x2d353c;
const STEEL = 0x8c8f92;

function makeClockDial(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f1eee6';
  g.beginPath(); g.arc(256, 256, 252, 0, Math.PI * 2); g.fill();
  g.lineWidth = 10; g.strokeStyle = '#2b2b2b';
  g.beginPath(); g.arc(256, 256, 247, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#1c1c1c';
  // marcadores em barra (sem numerais), como no relógio real
  for (let i = 0; i < 12; i++) {
    g.save();
    g.translate(256, 256);
    g.rotate((i / 12) * Math.PI * 2);
    const big = i % 3 === 0;
    g.fillRect(big ? -12 : -8, -232, big ? 24 : 16, big ? 70 : 52);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function buildCentral(lm: LandmarkRec, archMats: Record<ArchMat, THREE.Material>): LandmarkInstance {
  const P = CENTRAL_PARAMS;
  const C = centralPlan(lm);
  const F = C.F;
  const group = new THREE.Group();
  group.name = 'LANDMARK_CENTRAL';
  const ab = new ArchBuilder();
  const H = P.mainBlockHeight;
  const near = (a: number, b: number, eps = 0.6) => Math.abs(a - b) < eps;

  // ---------- massa: alas, trecho central, gare ----------
  for (const poly of [C.wingS, C.wingN, C.mid]) {
    ab.prism(poly, 0, H, CREAM, 'concrete');
    ab.prism(poly, H, H + 0.25, CREAM_SHADE, 'concrete'); // laje de cobertura/rufo
  }
  ab.prism(C.rear, 0, P.concourseHeight, 0xd6cfbf, 'concrete');

  // ---------- fachadas das alas (geradas aresta a aresta do contorno real) ----------
  const groundH = 6;
  const floorH = 3.55;
  const floors = Math.floor((H - groundH - 1.2) / floorH);
  const facades = (poly: XZ[], isMid: boolean) => {
    ArchBuilder.edgeFrames(poly, 1.0, (m, len, _i, a, b) => {
      const va = C.vOf(a), vb = C.vOf(b), ua = C.uOf(a), ub = C.uOf(b);
      // arestas internas (encontro com outra peça) não recebem fachada
      if (!isMid && ((near(ua, C.uA) && near(ub, C.uA)) || (near(ua, C.uB) && near(ub, C.uB))) && Math.min(va, vb) >= C.notchDepth - 0.5) return;
      if (isMid && ((near(ua, C.uA) && near(ub, C.uA)) || (near(ua, C.uB) && near(ub, C.uB)) || (near(va, C.notchDepth) && near(vb, C.notchDepth)))) return;
      const onRear = near(va, P.mainBlockDepth, 1) && near(vb, P.mainBlockDepth, 1);
      const y0 = onRear ? P.concourseHeight : 0;
      // trechos curvos do contorno e alas junto à torre: janelas em fita (streamline), como nas fotos
      const um = (ua + ub) / 2;
      const streamline = len < 9 || (Math.abs(um - P.towerU) < P.towerSize / 2 + 16 && Math.min(va, vb) < P.towerV);
      ab.withFrame(m, () => {
        if (y0 === 0) {
          // embasamento de granito + térreo alto com vãos amplos
          ab.box(len, 1.1, 0.45, len / 2, 0, 0.22, BASE_GRANITE, 'granite');
          ab.facadeGrid({ x0: 0, x1: len, y0: 0, floors: 1, floorH: groundH, bay: 4.4, winW: 3.2, winH: 3.9, sill: 1.1, frameD: 0.35, pierW: 0.9, pierD: 0.1, wall: CREAM_SHADE, wallMat: 'concrete', glass: 0x22292e, mullions: true });
          ab.box(len, 0.5, 0.9, len / 2, groundH - 0.5, 0.45, CREAM_SHADE, 'concrete'); // friso sobre o térreo
        }
        const fy0 = y0 === 0 ? groundH : y0 + 0.4;
        const nf = y0 === 0 ? floors : Math.floor((H - 1.2 - fy0) / floorH);
        if (streamline) {
          ab.facadeGrid({ x0: 0, x1: len, y0: fy0, floors: nf, floorH, bay: len, winW: len, winH: 1.75, sill: 1.0, frameD: 0.3, ribbon: true, wall: CREAM, wallMat: 'concrete', glass: GLASS, mullions: true });
        } else {
          ab.facadeGrid({
            x0: 0, x1: len, y0: fy0, floors: nf, floorH, bay: 2.9, winW: 1.75, winH: 1.85, sill: 0.95, frameD: 0.26,
            pierW: 0.42, pierD: 0.14, majorEvery: 4, majorW: 0.9, majorD: 0.32, wall: CREAM, wallMat: 'concrete', glass: GLASS, mullions: true,
          });
        }
        // platibanda com friso (coroamento das alas)
        const top = fy0 + nf * floorH;
        ab.box(len, H + 1.2 - top, 0.3, len / 2, top, 0.15, CREAM, 'concrete');
        ab.box(len + 0.2, 0.35, 0.55, len / 2, H + 0.9, 0.27, CREAM_SHADE, 'concrete');
      });
    });
  };
  facades(C.wingS, false);
  facades(C.wingN, false);
  facades(C.mid, true);
  // gare: faixa de clerestório nas arestas longas
  ArchBuilder.edgeFrames(C.rear, 12, (m, len) => ab.withFrame(m, () => {
    ab.facadeGrid({ x0: 0, x1: len, y0: 9, floors: 1, floorH: 6, bay: 5, winW: 3.8, winH: 3.6, sill: 1.2, frameD: 0.3, pierW: 0.8, wall: 0xd6cfbf, wallMat: 'concrete', glass: 0x3a4248 });
  }));

  // ---------- torre (frame local: x = u ao longo da fachada, z = para fora/leste) ----------
  const tw = C.toWorld(P.towerU, P.towerV);
  const towerFrame = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(F.u[0], 0, F.u[1]), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-F.v[0], 0, -F.v[1]),
  ).setPosition(tw[0], 0, tw[1]);
  // garante base destra (x × y = z); senão inverte x
  {
    const x = new THREE.Vector3(F.u[0], 0, F.u[1]), z = new THREE.Vector3(-F.v[0], 0, -F.v[1]);
    if (x.clone().cross(new THREE.Vector3(0, 1, 0)).dot(z) < 0) {
      towerFrame.makeBasis(x.negate(), new THREE.Vector3(0, 1, 0), z).setPosition(tw[0], 0, tw[1]);
    }
  }
  const T = P.towerSize;
  const S = P.clockStageSize;
  const faceRot = (k: number) => new THREE.Matrix4().makeRotationY((k * Math.PI) / 2);
  const onFaces = (half: number, fn: (k: number) => void) => {
    for (let k = 0; k < 4; k++) ab.withFrame(faceRot(k).multiply(new THREE.Matrix4().makeTranslation(0, 0, half)), () => fn(k));
  };
  ab.withFrame(towerFrame, () => {
    const core = T - 4; // fuste com cantos reentrantes de 2 × 2 m
    ab.box(core, P.shaftTop + 2, core, 0, 0, 0, CREAM, 'concrete');
    const shaftFloors = Math.floor((P.shaftTop - 6.5) / 3.45);
    onFaces(core / 2, () => {
      // corpo saliente de cada face (2 m), 4 vãos com pilastras contínuas
      ab.box(core, P.shaftTop, 2, 0, 0, 1, CREAM, 'concrete');
      ab.withFrame(new THREE.Matrix4().makeTranslation(0, 0, 2), () => {
        ab.box(core, 1.1, 0.4, 0, 0, 0.2, BASE_GRANITE, 'granite');
        ab.facadeGrid({ x0: -core / 2, x1: core / 2, y0: 0, floors: 1, floorH: 6.5, bay: core / 3, winW: 3.6, winH: 4.6, sill: 0.9, frameD: 0.35, pierW: 1.0, wall: CREAM_SHADE, wallMat: 'concrete', glass: 0x22292e, mullions: true });
        ab.facadeGrid({
          x0: -core / 2, x1: core / 2, y0: 6.5, floors: shaftFloors, floorH: 3.45, bay: core / 4, winW: 2.5, winH: 2.05, sill: 0.85,
          frameD: 0.24, pierW: 1.1, pierD: 0.22, majorEvery: 4, majorW: 1.6, majorD: 0.4, wall: CREAM, wallMat: 'concrete', glass: GLASS, mullions: true,
        });
        // pilastras escalonadas do topo do fuste (silhueta serrilhada art déco)
        // (só fora da largura do estágio do relógio: os degraus sobem dos cantos em direção a ele)
        for (let i = 0; i <= 8; i++) {
          const x = -core / 2 + (i / 8) * core;
          if (Math.abs(x) < S / 2 - 0.5) continue;
          const t = 1 - (Math.abs(x) - S / 2) / (core / 2 - S / 2 + 0.01);
          const top = P.shaftTop + 0.8 + t * 3.2;
          ab.box(0.7, top - (P.shaftTop - 10), 0.55, x, P.shaftTop - 10, 0.5, CREAM_SHADE, 'concrete');
        }
        ab.box(core, 0.6, 0.5, 0, P.shaftTop - 0.6, 0.25, CREAM_SHADE, 'concrete');
      });
    });
    // cantos reentrantes: frestas verticais escuras com janelas estreitas
    for (let k = 0; k < 4; k++) {
      ab.withFrame(faceRot(k), () => {
        const cx = core / 2 + 1, cz = core / 2 + 1;
        ab.box(0.5, P.shaftTop - 2, 0.5, cx + 0.5, 0, cz + 0.5, CREAM_SHADE, 'concrete'); // aleta do canto
        for (let y = 7.4; y < P.shaftTop - 4; y += 3.45) {
          ab.quad(1.1, 1.7, cx, y, core / 2 + 0.02, GLASS, 'glass');
        }
      });
    }

    // estágio do relógio (mais estreito, cantos recuados com fendas horizontais escuras)
    const y0 = P.shaftTop;
    const y1 = P.clockStageTop;
    const sc = S - 3.2;
    ab.box(sc, y1 - y0, sc, 0, y0, 0, CREAM, 'concrete');
    ab.box(S + 2.2, 1.0, S + 2.2, 0, y0, 0, CREAM_SHADE, 'concrete'); // base/cornija de transição
    onFaces(sc / 2, () => {
      ab.box(sc, y1 - y0, 1.6, 0, y0, 0.8, CREAM, 'concrete');
      // moldura quadrada saliente do mostrador
      ab.withFrame(new THREE.Matrix4().makeTranslation(0, 0, 1.6), () => {
        const r = P.clockRadius;
        ab.box(2 * r + 1.4, 0.7, 0.35, 0, P.clockCenter - r - 1.1, 0.17, CREAM_SHADE, 'concrete');
        ab.box(2 * r + 1.4, 0.7, 0.35, 0, P.clockCenter + r + 0.4, 0.17, CREAM_SHADE, 'concrete');
        for (const s of [-1, 1]) ab.box(0.7, 2 * r + 2.2, 0.35, s * (r + 0.35), P.clockCenter - r - 1.1, 0.17, CREAM_SHADE, 'concrete');
        // pequenas janelas sob e sobre o mostrador
        for (const x of [-2.4, 0, 2.4]) {
          ab.quad(1.2, 1.4, x, y0 + 1.8, 0.02, GLASS, 'glass');
          ab.quad(1.0, 1.3, x, y1 - 2.4, 0.02, GLASS, 'glass');
        }
      });
    });
    for (let k = 0; k < 4; k++) {
      ab.withFrame(faceRot(k), () => {
        const c = sc / 2;
        for (let y = y0 + 1.6; y < y1 - 1; y += 2.0) {
          // fendas horizontais nos cantos recuados (duas faces do canto)
          ab.box(1.6, 1.0, 0.05, c + 0.8, y, c + 0.02, 0x23292d, 'glass');
          ab.box(0.05, 1.0, 1.6, c + 0.02, y, c + 0.8, 0x23292d, 'glass');
        }
        ab.box(0.45, y1 - y0, 0.45, c + 1.4, y0, c + 1.4, CREAM_SHADE, 'concrete'); // aresta do canto
      });
    }
    ab.box(S + 1.0, 0.9, S + 1.0, 0, y1 - 0.9, 0, CREAM_SHADE, 'concrete'); // cornija sobre o relógio

    // coroamento estriado em dois estágios + platibanda escalonada
    const [c1, c2] = P.crown;
    ab.box(c1[2], c1[1] - c1[0], c1[2], 0, c1[0], 0, CREAM, 'concrete');
    onFaces(c1[2] / 2, () => {
      for (let i = 0; i <= 7; i++) {
        const x = -c1[2] / 2 + (i / 7) * c1[2];
        ab.box(0.55, c1[1] - c1[0] + 0.8, 0.6, x, c1[0], 0.3, CREAM_SHADE, 'concrete');
      }
      for (const x of [-2.2, 2.2]) for (let y = c1[0] + 1.2; y < c1[1] - 1.5; y += 3.0) ab.quad(1.0, 1.6, x, y, 0.02, GLASS, 'glass');
    });
    ab.box(c2[2], c2[1] - c2[0], c2[2], 0, c2[0], 0, CREAM, 'concrete');
    onFaces(c2[2] / 2, () => {
      for (let i = 0; i <= 5; i++) ab.box(0.5, c2[1] - c2[0] + 0.6, 0.45, -c2[2] / 2 + (i / 5) * c2[2], c2[0], 0.22, CREAM_SHADE, 'concrete');
    });
    ab.box(c2[2] + 0.6, 0.5, c2[2] + 0.6, 0, P.roofTop - 0.2, 0, CREAM_SHADE, 'concrete');

    // mastro treliçado de antenas + haste (estrutura total ~135 m)
    const mb = P.roofTop + 0.3;
    const mh = 14;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) ab.box(0.18, mh, 0.18, sx * 1.4, mb, sz * 1.4, STEEL, 'metal');
    for (let y = mb + 1.5; y < mb + mh; y += 2.4) {
      ab.box(3.0, 0.12, 0.12, 0, y, 1.4, STEEL, 'metal').box(3.0, 0.12, 0.12, 0, y, -1.4, STEEL, 'metal');
      ab.box(0.12, 0.12, 3.0, 1.4, y, 0, STEEL, 'metal').box(0.12, 0.12, 3.0, -1.4, y, 0, STEEL, 'metal');
    }
    ab.cyl(0.12, 0.2, P.mastTop - mb - mh, 0, mb + mh, 0, STEEL, 8, 'metal');
    ab.detail(() => {
      // antenas/pratos de micro-ondas no mastro
      for (const [x, z, y] of [[1.6, 0, mb + 6], [-1.6, 0.4, mb + 9], [0, 1.6, mb + 11]] as const) ab.cyl(0.6, 0.6, 0.25, x, y, z, 0xb7b9bb, 12, 'metal');
      for (const sx of [-1, 1]) ab.box(0.08, 5, 0.08, sx * 3.5, P.roofTop, 2.8, STEEL, 'metal');
    });

    // marquise sobre o acesso principal (diante da torre, no recuo entre as alas)
    ab.box(T + 2 * P.notchMargin, 0.45, 5.5, 0, 6.6, T / 2 + 2.75, CREAM_SHADE, 'concrete');
    ab.box(T + 2 * P.notchMargin, 0.3, 5.5, 0, 6.3, T / 2 + 2.75, 0x9a9488, 'concrete');
  });

  group.add(ab.build(archMats, 'central_arch'));

  // ---------- relógio (mostradores + ponteiros funcionando) ----------
  const dialTex = makeClockDial();
  const dialMat = new THREE.MeshStandardMaterial({ map: dialTex, roughness: 0.5, emissive: 0xffffff, emissiveMap: dialTex, emissiveIntensity: 0.06 });
  const handMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6, metalness: 0.3 });
  const clockRoot = new THREE.Group();
  clockRoot.applyMatrix4(towerFrame);
  const hands: { hour: THREE.Mesh; minute: THREE.Mesh }[] = [];
  const dialZ = (S - 3.2) / 2 + 1.6 + 0.05;
  const r = P.clockRadius;
  for (let k = 0; k < 4; k++) {
    const face = new THREE.Group();
    const a = (k * Math.PI) / 2;
    face.position.set(Math.sin(a) * dialZ, P.clockCenter, Math.cos(a) * dialZ);
    face.rotation.y = a;
    const dial = new THREE.Mesh(new THREE.CircleGeometry(r, 64), dialMat);
    dial.position.z = 0.02;
    face.add(dial);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.15, 0.22, 8, 64), handMat);
    face.add(ring);
    // ponteiros: minutos ~4,5 m, horas ~3,2 m (proporção do relógio real, limitada ao mostrador)
    const minute = new THREE.Mesh(new THREE.BoxGeometry(0.3, r * 0.92, 0.08).translate(0, r * 0.38, 0), handMat);
    const hour = new THREE.Mesh(new THREE.BoxGeometry(0.45, r * 0.62, 0.08).translate(0, r * 0.24, 0), handMat);
    minute.position.z = 0.16;
    hour.position.z = 0.12;
    face.add(minute, hour);
    hands.push({ hour, minute });
    clockRoot.add(face);
  }
  group.add(clockRoot);

  const center = new THREE.Vector3(tw[0], 40, tw[1]);
  const arch = group.getObjectByName('central_arch')!;
  return {
    group,
    colliders: centralColliders(lm),
    update(simTime: Date, cameraPos: THREE.Vector3) {
      // hora local do Rio (UTC−3)
      const h = (simTime.getUTCHours() + 21) % 24;
      const m = simTime.getUTCMinutes() + simTime.getUTCSeconds() / 60;
      const aMin = -(m / 60) * Math.PI * 2;
      const aHour = -(((h % 12) + m / 60) / 12) * Math.PI * 2;
      for (const hd of hands) {
        hd.minute.rotation.z = aMin;
        hd.hour.rotation.z = aHour;
      }
      if (cameraPos) updateDetailLod(arch, center, cameraPos);
    },
  };
}
