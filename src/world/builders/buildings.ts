/**
 * Edifícios procedurais a partir dos footprints reais do OSM.
 *
 * Geometria: paredes extrudadas (base → topo) + cobertura triangulada + volumes técnicos
 * (caixas d'água / casas de máquinas, típicos dos telhados do Centro) em prédios altos.
 * Aparência: UM material compartilhado; toda a variedade vem de atributos por vértice
 * (estilo, altura do pavimento, cor, semente) interpretados no shader de fachada.
 */
import * as THREE from 'three';
import type { BuildingRec, XZ } from '../types';
import { FacadeStyle } from '../types';
import { timeUniforms } from '../../renderer/timeOfDay';

// atributos: aFacade = (style, floorHeight, tint, seed) ; aFacade2 = (height, minHeight, flags, groundFloorH)
const FLAG_ARCADE = 1, FLAG_ROOF = 2, FLAG_SHOPS = 4, FLAG_CANOPY = 8;

interface Acc {
  pos: number[]; nor: number[]; uv: number[]; f1: number[]; f2: number[]; idx: number[];
}
const newAcc = (): Acc => ({ pos: [], nor: [], uv: [], f1: [], f2: [], idx: [] });

function signedArea(pts: XZ[]) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return a / 2;
}

function floorHeightFor(b: BuildingRec): number {
  if (b.style === FacadeStyle.Sobrado) return Math.max(3.4, Math.min(4.6, b.height / Math.max(1, b.levels)));
  if (b.heightSource === 'osm:height' || b.heightSource === 'osm:levels') {
    const lv = Math.max(1, Math.round(b.height / 3.15));
    return b.height / lv;
  }
  return 3.2;
}

/** Paredes de um anel (externo ou buraco). `outward` garante normais para fora do volume. */
function addWalls(acc: Acc, ring: XZ[], isHole: boolean, b: BuildingRec, f1: number[], f2: number[]) {
  const n = ring.length;
  // garantir orientação: externos CCW no plano (x,z) visto de cima → normais para fora
  let pts = ring;
  const area = signedArea(ring);
  // no sistema x=leste, z=sul, área "positiva" pela fórmula acima ≈ horário visto de cima
  if ((area < 0) !== isHole) pts = [...ring].reverse();
  let perim = b.seed * 37; // deslocamento para que prédios vizinhos não alinhem janelas
  const y0 = b.minHeight, y1 = b.height;
  for (let i = 0; i < n; i++) {
    const a = pts[i], c = pts[(i + 1) % n];
    const dx = c[0] - a[0], dz = c[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const nx = dz / len, nz = -dx / len;
    const base = acc.pos.length / 3;
    acc.pos.push(a[0], y0, a[1], c[0], y0, c[1], c[0], y1, c[1], a[0], y1, a[1]);
    for (let k = 0; k < 4; k++) acc.nor.push(nx, 0, nz);
    acc.uv.push(perim, y0, perim + len, y0, perim + len, y1, perim, y1);
    for (let k = 0; k < 4; k++) { acc.f1.push(...f1); acc.f2.push(...f2); }
    acc.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    perim += len;
  }
}

function addRoof(acc: Acc, b: BuildingRec, y: number, f1: number[], f2: number[], down = false) {
  const outer = b.poly.outer.map((p) => new THREE.Vector2(p[0], p[1]));
  const holes = (b.poly.holes ?? []).map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])));
  let tris: number[][];
  try {
    tris = THREE.ShapeUtils.triangulateShape(outer, holes);
  } catch {
    return;
  }
  const all = outer.concat(...holes);
  const base = acc.pos.length / 3;
  const rf2 = [f2[0], f2[1], f2[2] | FLAG_ROOF, f2[3]];
  for (const p of all) {
    acc.pos.push(p.x, y, p.y);
    acc.nor.push(0, down ? -1 : 1, 0);
    acc.uv.push(p.x, p.y);
    acc.f1.push(...f1);
    acc.f2.push(...rf2);
  }
  for (const t of tris) {
    const p0 = all[t[0]], p1 = all[t[1]], p2 = all[t[2]];
    const cy = (p1.y - p0.y) * (p2.x - p0.x) - (p1.x - p0.x) * (p2.y - p0.y);
    if ((cy > 0) !== down) acc.idx.push(base + t[0], base + t[1], base + t[2]);
    else acc.idx.push(base + t[0], base + t[2], base + t[1]);
  }
}

/** Caixa (volumes técnicos de cobertura). */
function addBox(acc: Acc, cx: number, cz: number, w: number, d: number, y0: number, h: number, rot: number, f1: number[], _f2: number[]) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const corner = (u: number, v: number): XZ => [cx + u * c - v * s, cz + u * s + v * c];
  const ring: XZ[] = [corner(-w / 2, -d / 2), corner(w / 2, -d / 2), corner(w / 2, d / 2), corner(-w / 2, d / 2)];
  const fake: BuildingRec = {
    id: 0, poly: { outer: ring }, height: y0 + h, minHeight: y0, levels: 1, heightSource: 'estimate', cls: 'D',
    style: FacadeStyle.Institutional, tint: f1[2], seed: f1[3],
  };
  const bf2 = [y0 + h, y0, 0, 0];
  addWalls(acc, ring, false, fake, [FacadeStyle.Institutional, 99, f1[2], f1[3]], bf2);
  addRoof(acc, fake, y0 + h, [FacadeStyle.Institutional, 99, f1[2], f1[3]], bf2);
}

function pointInRing(p: XZ, ring: XZ[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export interface BuildingBuildOptions {
  /** ignora edifícios mais baixos que isso (LOD distante) */
  minHeight?: number;
  /** adiciona volumes de cobertura */
  roofDetails?: boolean;
}

export function buildBuildingsGeometry(buildings: BuildingRec[], opts: BuildingBuildOptions = {}): THREE.BufferGeometry | null {
  const acc = newAcc();
  for (const b of buildings) {
    if (opts.minHeight && b.height < opts.minHeight) continue;
    const fh = floorHeightFor(b);
    let flags = 0;
    if (b.arcade) flags |= FLAG_ARCADE;
    if (b.canopy) flags |= FLAG_CANOPY;
    if (!b.canopy && b.minHeight < 0.5 && b.style !== FacadeStyle.Institutional && b.height < 120) flags |= FLAG_SHOPS;
    const groundH = b.arcade ? 6.5 : b.style === FacadeStyle.Sobrado ? Math.min(4.2, fh) : Math.min(4.5, Math.max(3.6, fh * 1.2));
    const f1 = [b.style, fh, b.tint, b.seed];
    const f2 = [b.height, b.minHeight, flags, groundH];
    addWalls(acc, b.poly.outer, false, b, f1, f2);
    for (const h of b.poly.holes ?? []) addWalls(acc, h, true, b, f1, f2);
    addRoof(acc, b, b.height, f1, f2);
    if (b.canopy) addRoof(acc, b, b.minHeight, f1, f2, true);

    // volumes técnicos na cobertura (prédios ≥ 6 pavimentos, determinístico pela semente)
    if (opts.roofDetails !== false && !b.canopy && b.height > 20 && b.cls !== 'D') {
      const ring = b.poly.outer;
      let cx = 0, cz = 0;
      for (const p of ring) { cx += p[0]; cz += p[1]; }
      cx /= ring.length; cz /= ring.length;
      if (pointInRing([cx, cz], ring)) {
        // orientação pela aresta mais longa
        let best = 0, rot = 0;
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], c = ring[(i + 1) % ring.length];
          const l = Math.hypot(c[0] - a[0], c[1] - a[1]);
          if (l > best) { best = l; rot = Math.atan2(c[1] - a[1], c[0] - a[0]); }
        }
        const area = Math.abs(signedArea(ring));
        const s = Math.min(9, Math.sqrt(area) * 0.32);
        if (s > 2.5) {
          const boxH = 2.6 + b.seed * 2.2;
          addBox(acc, cx, cz, s, s * (0.6 + b.tint * 0.5), b.height, boxH, rot, f1, f2);
          if (b.seed > 0.45 && s > 4) {
            const ox = Math.cos(rot) * s * 0.75, oz = Math.sin(rot) * s * 0.75;
            if (pointInRing([cx + ox, cz + oz], ring)) addBox(acc, cx + ox, cz + oz, s * 0.45, s * 0.45, b.height, 1.8, rot, f1, f2);
          }
        }
      }
    }
  }
  if (!acc.idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(acc.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(acc.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(acc.uv, 2));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(acc.f1, 4));
  g.setAttribute('aFacade2', new THREE.Float32BufferAttribute(acc.f2, 4));
  g.setIndex(acc.idx.length > 65535 ? new THREE.Uint32BufferAttribute(acc.idx, 1) : new THREE.Uint16BufferAttribute(acc.idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// -------------------------------------------------------------------------------------------
// Material com shader de fachada procedural
// -------------------------------------------------------------------------------------------
export function createBuildingMaterial(noise: THREE.Texture): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNoise = { value: noise };
    shader.uniforms.uNight = timeUniforms.night;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aFacade;
        attribute vec4 aFacade2;
        varying vec4 vFacade;
        varying vec4 vFacade2;
        varying vec2 vFUV;
        varying vec3 vFNormal;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vFacade = aFacade; vFacade2 = aFacade2; vFUV = uv; vFNormal = normal;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uNoise;
        uniform float uNight;
        varying vec4 vFacade;
        varying vec4 vFacade2;
        varying vec2 vFUV;
        varying vec3 vFNormal;
        float fh1(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        vec3 wallPalette(float style, float t){
          // paletas inspiradas no Centro: concreto claro, bege, pastilha, granito, casario colorido
          if (style > 2.5 && style < 3.5) {
            vec3 c0 = vec3(0.86,0.78,0.55), c1 = vec3(0.70,0.80,0.80), c2 = vec3(0.88,0.66,0.58), c3 = vec3(0.78,0.84,0.66), c4 = vec3(0.92,0.90,0.84), c5 = vec3(0.62,0.70,0.82);
            float k = floor(t * 6.0);
            return k < 1.0 ? c0 : k < 2.0 ? c1 : k < 3.0 ? c2 : k < 4.0 ? c3 : k < 5.0 ? c4 : c5;
          }
          // concreto claro, bege, cinza, pastilha creme, granito escuro, rosado, verde-acinzentado, branco
          vec3 c0 = vec3(0.80,0.78,0.73), c1 = vec3(0.72,0.66,0.57), c2 = vec3(0.86,0.85,0.82), c3 = vec3(0.56,0.57,0.58);
          vec3 c4 = vec3(0.78,0.71,0.60), c5 = vec3(0.42,0.40,0.38), c6 = vec3(0.80,0.70,0.66), c7 = vec3(0.66,0.70,0.66);
          float k = floor(t * 8.0);
          return k < 1.0 ? c0 : k < 2.0 ? c1 : k < 3.0 ? c2 : k < 4.0 ? c3 : k < 5.0 ? c4 : k < 6.0 ? c5 : k < 7.0 ? c6 : c7;
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float fStyle = vFacade.x;
        float fFloorH = vFacade.y;
        float fTint = vFacade.z;
        float fSeed = vFacade.w;
        float fTop = vFacade2.x;
        float fFlags = vFacade2.z;
        float fGroundH = vFacade2.w;
        bool isRoof = mod(floor(fFlags / 2.0), 2.0) > 0.5;
        bool isArcade = mod(fFlags, 2.0) > 0.5;
        bool hasShops = mod(floor(fFlags / 4.0), 2.0) > 0.5;
        bool isCanopy = mod(floor(fFlags / 8.0), 2.0) > 0.5;
        float fRough = 0.86;
        float fMetal = 0.0;
        vec3 fEmissive = vec3(0.0);
        vec3 wall = wallPalette(fStyle, fTint);
        if (isRoof || fFloorH > 90.0) {
          // laje de cobertura: manta/concreto com manchas
          float n = texture2D(uNoise, vFUV * 0.05).r;
          float n2 = texture2D(uNoise, vFUV * 0.31).g;
          vec3 roofC = mix(vec3(0.42,0.41,0.39), vec3(0.55,0.53,0.50), n);
          if (fFloorH > 90.0 && !isRoof) roofC = wall * (0.9 + n * 0.12);
          roofC *= 0.85 + n2 * 0.25;
          if (isCanopy) roofC = vec3(0.55,0.56,0.58) * (0.8 + n2 * 0.3);
          diffuseColor.rgb = roofC;
          fRough = 0.92;
        } else {
          vec2 m = vFUV; // metros: x = ao longo da fachada, y = altura
          float yRel = m.y;
          // largura do vão por estilo
          float bayW = fStyle < 0.5 ? 1.5 : fStyle < 1.5 ? 2.6 : fStyle < 2.5 ? 2.1 : fStyle < 3.5 ? 3.4 : 4.2;
          bayW *= 0.9 + fract(fSeed * 13.7) * 0.25;
          float fy = (yRel - fGroundH) / fFloorH;
          float level = floor(fy);
          float ly = fract(fy);
          float bx = fract(m.x / bayW);
          float bay = floor(m.x / bayW);
          // janela dentro do vão
          vec2 wmin, wmax;
          if (fStyle < 0.5) { wmin = vec2(0.04, 0.22); wmax = vec2(0.96, 0.92); }          // faixa contínua
          else if (fStyle < 1.5) { wmin = vec2(0.22, 0.28); wmax = vec2(0.78, 0.82); }     // recortada
          else if (fStyle < 2.5) { wmin = vec2(0.26, 0.18); wmax = vec2(0.74, 0.90); }     // art déco: pilastras
          else if (fStyle < 3.5) { wmin = vec2(0.30, 0.12); wmax = vec2(0.70, 0.80); }     // sobrado: portas-janela altas
          else { wmin = vec2(0.30, 0.25); wmax = vec2(0.70, 0.85); }                       // institucional
          float inX = step(wmin.x, bx) * step(bx, wmax.x);
          float inY = step(wmin.y, ly) * step(ly, wmax.y);
          float isWin = inX * inY * step(0.0, fy);
          // cornija/topo: faixa sem janelas perto do topo
          float topBand = step(fTop - 1.1, yRel);
          isWin *= 1.0 - topBand;
          // variação de janelas (persianas, cortinas, luzes)
          float r = fh1(vec2(bay, level) + fSeed * 91.0);
          float r2 = fh1(vec2(level, bay * 1.7) + fSeed * 17.0);
          // cor do vidro: reflexo escuro azulado / esverdeado
          vec3 glass = mix(vec3(0.10,0.13,0.16), vec3(0.16,0.20,0.22), r);
          if (fStyle < 0.5) glass = mix(vec3(0.12,0.17,0.20), vec3(0.20,0.26,0.28), fTint);
          // persiana/cortina parcialmente fechada
          float blind = step(0.55, r2) * step(1.0 - (r2 - 0.55) * 1.8, ly / max(0.01, wmax.y));
          vec3 blindC = vec3(0.72, 0.70, 0.64) * (0.8 + r * 0.2);
          // moldura
          float frameW = 0.035;
          float frame = isWin * (1.0 - step(wmin.x + frameW, bx) * step(bx, wmax.x - frameW) * step(wmin.y + frameW * 1.5, ly) * step(ly, wmax.y - frameW * 1.5));
          // pilastras art déco: relevo vertical claro
          float pier = 0.0;
          if (fStyle > 1.5 && fStyle < 2.5) pier = 1.0 - smoothstep(0.0, 0.08, min(bx, 1.0 - bx));
          // peitoril (sombra sob a janela)
          float sill = inX * step(wmin.y - 0.06, ly) * step(ly, wmin.y) * step(0.0, fy);
          // sujeira escorrida (vertical) e encardido na base
          float streak = texture2D(uNoise, vec2(m.x * 0.11, m.y * 0.012)).r;
          float grime = smoothstep(0.45, 0.85, streak) * 0.22 + (1.0 - smoothstep(0.0, 3.0, yRel)) * 0.18;
          float wn = texture2D(uNoise, m * vec2(0.07, 0.05)).a;
          vec3 wallC = wall * (0.86 + wn * 0.22) * (1.0 - grime);
          wallC = mix(wallC, wallC * 1.08, pier);
          vec3 col = wallC;
          // ---- anti-moiré: média do padrão quando o pixel cobre muitos vãos/andares
          vec2 fw = fwidth(m);
          float detail = 1.0 - smoothstep(0.25, 0.6, max(fw.x / bayW, fw.y / fFloorH));
          vec3 winC = mix(glass, blindC, blind);
          winC = mix(winC, wallC * 0.75, frame);
          float winArea = (wmax.x - wmin.x) * (wmax.y - wmin.y);
          vec3 avg = mix(wallC, glass * 1.2, winArea * 0.85);
          vec3 detailed = mix(col, winC, isWin);
          detailed = mix(detailed, wallC * 0.55, sill);
          col = mix(avg, detailed, detail);
          float glassAmt = isWin * (1.0 - blind) * (1.0 - frame) * detail + winArea * 0.6 * (1.0 - detail);
          // noite: parte das janelas acesas (escritórios/residências), tons quentes e frios
          float lit = step(0.62 - fTint * 0.15, fh1(vec2(bay * 3.1, level * 7.3) + fSeed * 5.0));
          vec3 litC = mix(vec3(1.0, 0.78, 0.45), vec3(0.85, 0.92, 1.0), step(0.6, r));
          fEmissive = litC * uNight * 1.35 * (isWin * (1.0 - frame) * lit * detail + winArea * 0.32 * (1.0 - detail));
          if (topBand > 0.5) col = wallC * 0.9;
          // ---- térreo: comércio / portas de aço / galeria
          if (yRel < fGroundH) {
            float shopW = 4.5 + fract(fSeed * 7.3) * 2.0;
            float sx = fract(m.x / shopW);
            float shop = floor(m.x / shopW);
            float rs = fh1(vec2(shop, fSeed * 33.0));
            if (isArcade) {
              // galeria (pilotis): fundo sombreado + pilares
              float pillar = 1.0 - step(0.12, sx) * step(sx, 0.88);
              vec3 recess = vec3(0.08, 0.08, 0.085) + vec3(0.06) * step(0.15, sx) * step(sx, 0.85) * step(yRel, 3.2) * rs;
              col = mix(recess, wallC * 0.95, pillar);
              glassAmt = (1.0 - pillar) * 0.3;
            } else if (hasShops) {
              float opening = step(0.06, sx) * step(sx, 0.94) * step(yRel, fGroundH - 0.7);
              // porta de aço enrolável (ondulada) vs vitrine
              float shutter = step(0.62, rs);
              float corrug = 0.85 + 0.15 * sin(yRel * 60.0);
              vec3 shutterC = vec3(0.55, 0.57, 0.58) * corrug;
              vec3 vitrine = mix(vec3(0.06,0.07,0.08), vec3(0.25,0.22,0.18), step(yRel, 1.0) * 0.3 + rs * 0.3);
              vec3 openC = mix(vitrine, shutterC, shutter);
              // letreiro/toldo colorido sobre a loja
              float sign = step(fGroundH - 0.7, yRel) * step(yRel, fGroundH - 0.1) * step(0.04, sx) * step(sx, 0.96);
              vec3 signC = vec3(fh1(vec2(shop, 1.0)), fh1(vec2(shop, 2.0)), fh1(vec2(shop, 3.0))) * 0.7 + 0.15;
              col = mix(wallC * 0.8, openC, opening);
              col = mix(col, signC, sign * step(0.35, rs));
              glassAmt = opening * (1.0 - shutter) * 0.9;
              fEmissive = vec3(1.0, 0.85, 0.6) * uNight * opening * (1.0 - shutter) * step(0.5, rs) * 1.6;
              if (shutter > 0.5) { fMetal = opening * 0.5; }
            } else {
              col = wallC * 0.92;
              glassAmt = 0.0;
            }
          }
          diffuseColor.rgb = col;
          fRough = mix(0.88, 0.12, glassAmt);
          fMetal = max(fMetal, glassAmt * 0.55);
          // leve oclusão na base do edifício
          diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(0.0, 1.6, yRel));
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += fEmissive;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = fRough;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = fMetal;`);
  };
  mat.customProgramCacheKey = () => 'pv-building-facade-v2';
  return mat;
}
