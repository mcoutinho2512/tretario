/** Wrapper fino sobre clipper-lib (Angus Johnson, Boost Software License) em coordenadas métricas. */
import ClipperLib from 'clipper-lib';
import type { XZ, Poly } from '../../src/world/types';

const SCALE = 100; // centímetros inteiros
type IntPath = { X: number; Y: number }[];

export const toPath = (pts: XZ[]): IntPath => pts.map((p) => ({ X: Math.round(p[0] * SCALE), Y: Math.round(p[1] * SCALE) }));
export const fromPath = (path: IntPath): XZ[] => path.map((p) => [p.X / SCALE, p.Y / SCALE] as XZ);

export type Paths = IntPath[];

export function polysToPaths(polys: Poly[]): Paths {
  const out: Paths = [];
  for (const p of polys) {
    const o = toPath(p.outer);
    if (!ClipperLib.Clipper.Orientation(o)) o.reverse();
    out.push(o);
    for (const h of p.holes ?? []) {
      const hp = toPath(h);
      if (ClipperLib.Clipper.Orientation(hp)) hp.reverse();
      out.push(hp);
    }
  }
  return out;
}

/** Buffer de polilinha aberta (ruas) com junções arredondadas e pontas retas. */
export function bufferLine(pts: XZ[], halfWidth: number, roundEnds = false): Paths {
  const co = new ClipperLib.ClipperOffset(2, 0.25 * SCALE);
  co.AddPath(toPath(pts), ClipperLib.JoinType.jtRound, roundEnds ? ClipperLib.EndType.etOpenRound : ClipperLib.EndType.etOpenButt);
  const sol: Paths = [];
  co.Execute(sol, halfWidth * SCALE);
  return sol;
}

export function offsetPaths(paths: Paths, delta: number): Paths {
  const co = new ClipperLib.ClipperOffset(2, 0.25 * SCALE);
  co.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const sol: Paths = [];
  co.Execute(sol, delta * SCALE);
  return sol;
}

function exec(type: number, subj: Paths, clip: Paths): Paths {
  const c = new ClipperLib.Clipper();
  c.AddPaths(subj, ClipperLib.PolyType.ptSubject, true);
  if (clip.length) c.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
  const sol: Paths = [];
  c.Execute(type, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return sol;
}

export const union = (a: Paths, b: Paths = []) => exec(ClipperLib.ClipType.ctUnion, a, b);
export const difference = (a: Paths, b: Paths) => exec(ClipperLib.ClipType.ctDifference, a, b);
export const intersection = (a: Paths, b: Paths) => exec(ClipperLib.ClipType.ctIntersection, a, b);

/** Converte Paths (com orientação) em polígonos externos + buracos via PolyTree. */
export function pathsToPolys(paths: Paths, minArea = 0.5): Poly[] {
  const c = new ClipperLib.Clipper();
  c.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(ClipperLib.ClipType.ctUnion, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  const out: Poly[] = [];
  const walk = (node: any) => {
    for (const child of node.Childs()) {
      // child é externo; seus filhos diretos são buracos; netos são novos externos
      const outer = child.Contour();
      const area = Math.abs(ClipperLib.Clipper.Area(outer)) / (SCALE * SCALE);
      if (area >= minArea) {
        const holes = child.Childs().map((h: any) => fromPath(h.Contour()));
        out.push({ outer: fromPath(outer).map(r2), holes: holes.length ? holes.map((h: XZ[]) => h.map(r2)) : undefined });
      }
      for (const h of child.Childs()) walk(h);
    }
  };
  walk(tree);
  return out;
}

const r2 = (p: XZ): XZ => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];

/** Recorta polilinhas abertas por polígonos (intersecção ou diferença). */
export function clipLines(lines: XZ[][], clip: Paths, mode: 'inside' | 'outside'): XZ[][] {
  if (!lines.length) return [];
  const c = new ClipperLib.Clipper();
  for (const l of lines) if (l.length >= 2) c.AddPath(toPath(l), ClipperLib.PolyType.ptSubject, false);
  c.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(mode === 'inside' ? ClipperLib.ClipType.ctIntersection : ClipperLib.ClipType.ctDifference, tree,
    ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  const open: IntPath[] = ClipperLib.Clipper.OpenPathsFromPolyTree(tree);
  return open.map((p) => fromPath(p).map(r2)).filter((p) => p.length >= 2);
}

export function rectPath(minX: number, minZ: number, maxX: number, maxZ: number): IntPath {
  return toPath([[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]]);
}

export function pointInPaths(p: XZ, paths: Paths): boolean {
  const pt = { X: Math.round(p[0] * SCALE), Y: Math.round(p[1] * SCALE) };
  let inside = 0;
  for (const path of paths) {
    const r = ClipperLib.Clipper.PointInPolygon(pt, path);
    if (r !== 0) inside += ClipperLib.Clipper.Orientation(path) ? 1 : -1;
  }
  return inside > 0;
}

export function cleanPaths(paths: Paths, dist = 0.05): Paths {
  return ClipperLib.Clipper.CleanPolygons(paths, dist * SCALE);
}
