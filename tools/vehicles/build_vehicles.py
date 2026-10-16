"""
Gerador procedural dos veículos de trânsito (Rodada 5 — overhaul visual).

Tudo é modelado aqui, do zero (sem assets externos): carroceria por "loft" de seções transversais
(perfil lateral, plano e seção variando ao longo do comprimento, interpolação monotônica),
Subdivision Surface, caixas de roda por booleana, vidros com moldura de borracha (inset),
faróis/lanternas/grade projetados (shrinkwrap) sobre a lataria, rodas com pneu e aro torneados.

Modelos: sedan, hatch, suv, taxi (sedan amarelo + faixa azul lateral + luminoso) e bus (ônibus urbano).
Cada modelo é exportado com dois níveis de detalhe: <nome>_LOD0 e <nome>_LOD1, num único GLB.
Os materiais são identificados pelo NOME (paint, glass, trim, rubber, alloy, chrome, lamp_front,
lamp_rear, lamp_amber, stripe, plate, sign, sign_taxi): o cliente (src/traffic/vehicleModels.ts)
converte cada material em atributos por vértice para desenhar o veículo inteiro em 1 draw call.

Uso:
  blender -b --python tools/vehicles/build_vehicles.py -- <saida.glb> [--render <pasta_png>] [--only sedan,bus]
Convenções: Blender Z-up, frente do veículo em +Y, lado direito (motorista olhando para frente) em +X.
Na exportação o conjunto é girado 180° em Z para que, no glTF (Y-up), a frente fique em +Z e a direita em -X
(mesma convenção do TrafficSystem: rumo 0 = +Z).
"""
import bpy, bmesh, math, sys, os
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv and not argv[0].startswith('--') else 'public/vehicles/vehicles.glb'
RENDER_DIR = argv[argv.index('--render') + 1] if '--render' in argv else None
ONLY = argv[argv.index('--only') + 1].split(',') if '--only' in argv else None

# ------------------------------------------------------------------------------------------ materiais
# cor linear (aprox.) + PBR. O cliente usa a mesma tabela por nome (ver vehicleModels.ts).
MATS = {
    'paint':      dict(color=(0.55, 0.56, 0.58), metal=0.45, rough=0.32, coat=1.0),
    'glass':      dict(color=(0.010, 0.013, 0.016), metal=0.0, rough=0.04, coat=0.0),
    'trim':       dict(color=(0.016, 0.016, 0.017), metal=0.0, rough=0.55, coat=0.0),
    'rubber':     dict(color=(0.018, 0.018, 0.018), metal=0.0, rough=0.92, coat=0.0),
    'alloy':      dict(color=(0.50, 0.52, 0.55), metal=0.9, rough=0.32, coat=0.0),
    'chrome':     dict(color=(0.80, 0.80, 0.80), metal=1.0, rough=0.12, coat=0.0),
    'lamp_front': dict(color=(0.75, 0.76, 0.78), metal=0.85, rough=0.08, coat=0.0, emit=(1.0, 0.95, 0.85)),
    'lamp_rear':  dict(color=(0.45, 0.012, 0.010), metal=0.1, rough=0.12, coat=0.0, emit=(1.0, 0.05, 0.03)),
    'lamp_amber': dict(color=(0.80, 0.33, 0.03), metal=0.1, rough=0.15, coat=0.0, emit=(1.0, 0.5, 0.05)),
    'stripe':     dict(color=(0.02, 0.09, 0.42), metal=0.3, rough=0.32, coat=1.0),
    'plate':      dict(color=(0.75, 0.76, 0.78), metal=0.0, rough=0.45, coat=0.0),
    'sign':       dict(color=(0.30, 0.13, 0.01), metal=0.0, rough=0.35, coat=0.0, emit=(1.0, 0.55, 0.08)),
    'sign_taxi':  dict(color=(0.80, 0.78, 0.70), metal=0.0, rough=0.35, coat=0.0, emit=(1.0, 0.95, 0.8)),
}
MAT_NAMES = list(MATS.keys())
MI = {n: i for i, n in enumerate(MAT_NAMES)}
PREVIEW_PAINT = {'sedan': (0.22, 0.23, 0.24), 'hatch': (0.38, 0.015, 0.015), 'suv': (0.02, 0.04, 0.09),
                 'taxi': (0.85, 0.55, 0.01), 'bus': (0.02, 0.18, 0.55)}


def make_materials(paint_color=None):
    mats = []
    for name in MAT_NAMES:
        p = MATS[name]
        m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        if hasattr(m, 'use_nodes'):
            try:
                m.use_nodes = True
            except Exception:
                pass
        bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        c = paint_color if (name == 'paint' and paint_color) else p['color']
        bsdf.inputs['Base Color'].default_value = (*c, 1.0)
        bsdf.inputs['Metallic'].default_value = p['metal']
        bsdf.inputs['Roughness'].default_value = p['rough']
        if 'Coat Weight' in bsdf.inputs:
            bsdf.inputs['Coat Weight'].default_value = p['coat']
            bsdf.inputs['Coat Roughness'].default_value = 0.05
        m.diffuse_color = (*c, 1.0)
        mats.append(m)
    return mats


# ------------------------------------------------------------------------------------------ utilidades
def clamp(x, a, b):
    return a if x < a else b if x > b else x


def lerp(a, b, t):
    return a + (b - a) * t


def pchip(xs, ys):
    """interpolação cúbica monotônica (Fritsch-Carlson): sem overshoot entre chaves"""
    n = len(xs)
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    d = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
    m = [0.0] * n
    m[0], m[-1] = d[0], d[-1]
    for i in range(1, n - 1):
        if d[i - 1] * d[i] <= 0:
            m[i] = 0.0
        else:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])

    def f(x):
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        i = max(k for k in range(n - 1) if xs[k] <= x)
        t = (x - xs[i]) / h[i]
        t2, t3 = t * t, t * t * t
        return ((2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i]
                + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1])
    return f


def new_obj(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def assign_mats(ob, mats):
    # materials.clear() zera os índices de material: guarda e restaura
    me = ob.data
    idx = [p.material_index for p in me.polygons]
    me.materials.clear()
    for m in mats:
        me.materials.append(m)
    for p, i in zip(me.polygons, idx):
        p.material_index = i


def bake(ob):
    """aplica todos os modificadores (mesh avaliada) e devolve o objeto"""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    ob.modifiers.clear()
    old = ob.data
    ob.data = me
    bpy.data.meshes.remove(old)
    return ob


def remove(ob):
    me = ob.data
    bpy.data.objects.remove(ob, do_unlink=True)
    if me and me.users == 0:
        bpy.data.meshes.remove(me)


# ------------------------------------------------------------------------------------------ carroceria (loft)
# Seção transversal: metade direita, 9 pontos de baixo (centro) para cima (centro do teto).
# Linhas de faces ("rows"): 0 assoalho, 1 soleira, 2-3 porta, 4 ombro, 5-6 vidro lateral, 7 coluna/borda do teto, 8 teto/capô/para-brisa
ROWS = 9


def section(p):
    zb, zs, zr, w, wr = p['zb'], p['zs'], p['zr'], p['w'], p['wr']
    h = max(0.05, zs - zb)
    tuck = p.get('tuck', 0.84)
    pts = [
        (0.0, zb),
        (w * tuck, zb),
        (w * 0.975, zb + min(0.11, h * 0.22)),
        (w, zb + h * 0.48),
        (w * 0.988, zb + h * 0.86),
        (w * 0.95, zs),
    ]
    gh = max(0.0, zr - zs)
    c = clamp((gh - 0.03) / 0.26, 0.0, 1.0)
    deck = [(w * 0.905, zs + 0.006), (w * 0.84, zs + 0.016), (w * 0.74, zs + 0.026)]
    cab = [(lerp(w * 0.95, wr, 0.55), zs + gh * 0.50), (wr, zr - 0.04), (wr * 0.88, zr - 0.010)]
    for j in range(3):
        pts.append((lerp(deck[j][0], cab[j][0], c), lerp(deck[j][1], cab[j][1], c)))
    pts.append((0.0, max(zr, zs + 0.034)))
    return pts


def sample_stations(keys, step, cuts=()):
    ys = [k['y'] for k in keys]
    params = {}
    for name in ('zb', 'zs', 'zr', 'w', 'wr', 'tuck'):
        params[name] = pchip(ys, [k.get(name, keys[0].get(name, 0.84)) for k in keys])
    out = []
    for i in range(len(ys) - 1):
        n = max(1, math.ceil((ys[i + 1] - ys[i]) / step - 1e-6))
        for s in range(n):
            out.append(ys[i] + (ys[i + 1] - ys[i]) * s / n)
    out.append(ys[-1])
    # estações forçadas nas fronteiras de vidro/colunas (bordas limpas); remove vizinhas muito próximas
    for c in cuts:
        out = [y for y in out if abs(y - c) > step * 0.35 or y in (ys[0], ys[-1])]
        out.append(c)
    out = sorted(set(round(y, 4) for y in out))
    sts = []
    for y in out:
        p = {k: f(y) for k, f in params.items()}
        p['y'] = y
        sts.append(p)
    return sts


def build_loft(name, stations, classify, ring_fn=section, creases=None):
    """creases: {índice do ponto da seção: peso} — vincos longitudinais (ombro, borda do teto) após subdivisão"""
    bm = bmesh.new()
    rings = []
    for p in stations:
        half = ring_fn(p)
        # anel completo: centro inferior, lado direito (+X), centro superior, lado esquerdo (-X)
        full = [half[0]] + half[1:-1] + [half[-1]] + [(-x, z) for (x, z) in reversed(half[1:-1])]
        rings.append([bm.verts.new((x, p['y'], z)) for (x, z) in full])
    nh = len(ring_fn(stations[0])) - 1  # número de linhas por lado
    n = len(rings[0])
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for k in range(n):
            row = k if k < nh else (2 * nh - 1 - k)
            f = bm.faces.new((a[k], b[k], b[(k + 1) % n], a[(k + 1) % n]))
            side = 1 if k < nh else -1
            f.material_index = MI[classify(stations[i], stations[i + 1], row, side)]
    f0 = bm.faces.new(list(rings[0]))
    f1 = bm.faces.new(list(reversed(rings[-1])))
    for f in (f0, f1):
        f.material_index = MI['paint']
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if creases:
        cl = bm.edges.layers.float.get('crease_edge') or bm.edges.layers.float.new('crease_edge')
        idx = {}
        for k, wgt in creases.items():
            if k == 'cap':
                continue
            idx[k] = wgt
            idx[n - k] = wgt  # espelho
        for i in range(len(rings) - 1):
            for k, wgt in idx.items():
                if 0 < k < n:
                    e = bm.edges.get((rings[i][k], rings[i + 1][k]))
                    if e:
                        e[cl] = wgt
        if 'cap' in creases:
            for r in (rings[0], rings[-1]):
                for k in range(n):
                    e = bm.edges.get((r[k], r[(k + 1) % n]))
                    if e:
                        e[cl] = creases['cap']
    return new_obj(name, bm)


def subdivide(ob, levels):
    if levels <= 0:
        return ob
    m = ob.modifiers.new('sub', 'SUBSURF')
    m.levels = levels
    m.render_levels = levels
    m.quality = 3
    return bake(ob)


def inset_glass(ob, thickness=0.022, depth=-0.006):
    """moldura de borracha preta ao redor de cada vidro e vidro levemente rebaixado"""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    glass = [f for f in bm.faces if f.material_index == MI['glass']]
    if glass:
        r = bmesh.ops.inset_region(bm, faces=glass, thickness=thickness, depth=depth, use_even_offset=True)
        for f in r['faces']:
            f.material_index = MI['trim']
    bm.to_mesh(ob.data)
    bm.free()


def cut_arches(ob, axles, r, w_body, depth=0.34, mats=None):
    """caixas de roda: booleana com cilindros (faces da caixa herdam o material 'trim')"""
    cutters = []
    for ay in axles:
        for s in (-1, 1):
            bm = bmesh.new()
            bmesh.ops.create_cone(bm, cap_ends=True, segments=40, radius1=r, radius2=r, depth=depth + 0.4)
            bm.transform(Matrix.Rotation(math.pi / 2, 4, 'Y'))
            bm.transform(Matrix.Translation((s * (w_body - depth + (depth + 0.4) / 2), ay, r - 0.02)))
            for f in bm.faces:
                f.material_index = 0
            c = new_obj('cut', bm)
            assign_mats(c, [bpy.data.materials['trim']])
            cutters.append(c)
    for c in cutters:
        mod = ob.modifiers.new('arch', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.object = c
        mod.solver = 'EXACT'
        try:
            mod.material_mode = 'TRANSFER'
        except Exception:
            pass
        bake(ob)
        # a booleana pode reordenar materiais: garante a lista canônica
    for c in cutters:
        remove(c)
    fix_material_slots(ob, mats)
    return ob


def fix_material_slots(ob, mats):
    """depois de booleanas, remapeia índices de material pela lista canônica de nomes"""
    names = [m.name if m else '' for m in ob.data.materials]
    remap = [MI.get(n.split('.')[0], MI['trim']) for n in names]
    me = ob.data
    for poly in me.polygons:
        poly.material_index = remap[poly.material_index] if poly.material_index < len(remap) else MI['trim']
    assign_mats(ob, mats)


# ------------------------------------------------------------------------------------------ peças projetadas
def patch(name, corners, mat, nu=6, nv=3, round_c=0.0):
    """grade bilinear entre 4 cantos (3D) — depois projetada na lataria. round_c arredonda os cantos."""
    bm = bmesh.new()
    a, b, c, d = [Vector(x) for x in corners]
    grid = []
    for j in range(nv + 1):
        v = j / nv
        row = []
        for i in range(nu + 1):
            u = i / nu
            p = (a * (1 - u) + b * u) * (1 - v) + (d * (1 - u) + c * u) * v
            if round_c > 0:
                # puxa os cantos para dentro (aparência arredondada)
                cu, cv = abs(u - 0.5) * 2, abs(v - 0.5) * 2
                k = max(0.0, cu + cv - 1.0) * round_c
                ctr = (a + b + c + d) / 4
                p = p + (ctr - p) * k
            row.append(bm.verts.new(p))
        grid.append(row)
    for j in range(nv):
        for i in range(nu):
            f = bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
            f.material_index = MI[mat]
    return new_obj(name, bm)


def project(ob, target, axis, offset):
    m = ob.modifiers.new('sw', 'SHRINKWRAP')
    m.target = target
    m.wrap_method = 'PROJECT'
    m.use_project_x = axis == 'X'
    m.use_project_y = axis == 'Y'
    m.use_project_z = axis == 'Z'
    m.use_negative_direction = True
    m.use_positive_direction = True
    m.offset = offset
    bake(ob)
    # vértices que não acertaram a lataria ficam no plano original: remove as faces que os usam
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bad = []
    for v in bm.verts:
        ok, co, _n, _i = target.closest_point_on_mesh(v.co)
        if not ok or (co - v.co).length > offset + 0.03:
            bad.append(v)
    if bad:
        bmesh.ops.delete(bm, geom=bad, context='VERTS')
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def orient_out(ob, out_dir):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.normal_update()
    avg = Vector((0, 0, 0))
    for f in bm.faces:
        avg += f.normal
    if avg.dot(Vector(out_dir)) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()


def proj_patch(name, target, corners, mat, axis, out_dir, offset=0.006, nu=6, nv=3, round_c=0.0, mirror_x=False):
    obs = []
    for s in ((1, -1) if mirror_x else (1,)):
        cs = [(x * s, y, z) for (x, y, z) in corners]
        if s < 0:
            cs = [cs[1], cs[0], cs[3], cs[2]]
        ob = patch(name, cs, mat, nu, nv, round_c)
        project(ob, target, axis, offset)
        od = (out_dir[0] * s, out_dir[1], out_dir[2])
        orient_out(ob, od)
        obs.append(ob)
    return obs


# ------------------------------------------------------------------------------------------ rodas
def lathe(bm, profile, segs, mat, center, axis_sign=1):
    """gira um perfil (r, x) em torno do eixo X; axis_sign espelha para o lado esquerdo"""
    cx, cy, cz = center
    rings = []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        ca, sa = math.cos(a), math.sin(a)
        rings.append([bm.verts.new((cx + axis_sign * x, cy + r * ca, cz + r * sa)) for (r, x) in profile])
    for i in range(segs):
        r0, r1 = rings[i], rings[(i + 1) % segs]
        for k in range(len(profile) - 1):
            q = (r0[k], r0[k + 1], r1[k + 1], r1[k]) if axis_sign > 0 else (r0[k], r1[k], r1[k + 1], r0[k + 1])
            f = bm.faces.new(q)
            f.material_index = MI[mat] if isinstance(mat, str) else MI[mat[k]]
    return rings


def wheel(bm, center, side, R, width, rim_r, segs, lod, spokes=5, hub_mat='alloy'):
    """pneu (borracha, ombro arredondado) + aro de liga (disco côncavo com raios sugeridos)"""
    hw = width / 2
    # perfil do pneu de fora para dentro: (raio, deslocamento lateral relativo à face externa)
    tire = [
        (rim_r * 1.02, 0.0),
        (rim_r + (R - rim_r) * 0.45, 0.012),
        (R - 0.025, 0.02),
        (R, 0.05),
        (R, width - 0.05),
        (R - 0.025, width - 0.02),
        (rim_r + (R - rim_r) * 0.45, width - 0.012),
        (rim_r * 1.02, width),
    ] if lod == 0 else [(rim_r, 0.0), (R - 0.02, 0.01), (R, 0.04), (R, width - 0.04), (R - 0.02, width - 0.01), (rim_r, width)]
    cx = center[0]
    # x local: 0 = face externa; cresce para dentro do carro
    prof = [(r, -x) for (r, x) in tire]
    lathe(bm, prof, segs, 'rubber', (cx, center[1], center[2]), side)
    if lod == 0:
        # aro: lábio, face côncava, cubo
        rim = [(rim_r * 1.02, -0.004), (rim_r * 0.97, 0.004), (rim_r * 0.90, -0.012), (rim_r * 0.40, -0.035),
               (rim_r * 0.26, -0.03), (rim_r * 0.20, -0.012), (0.0, -0.012)]
        mats = ['chrome', 'alloy', 'alloy', 'alloy', hub_mat, hub_mat]
        lathe(bm, rim, segs, mats, (cx, center[1], center[2]), side)
        # cavidades entre raios (escuras), levemente à frente da face do aro
        for k in range(spokes):
            a0 = 2 * math.pi * k / spokes + math.pi / spokes * 0.28
            a1 = 2 * math.pi * (k + 1) / spokes - math.pi / spokes * 0.28
            n = 4
            ring_out, ring_in = [], []
            for j in range(n + 1):
                a = lerp(a0, a1, j / n)
                ro, ri = rim_r * 0.86, rim_r * 0.44
                # x da face côncava nesses raios (interpolado do perfil) + 2 mm
                xo, xi = -0.0115, -0.0315
                ring_out.append(bm.verts.new((cx + side * xo, center[1] + ro * math.cos(a), center[2] + ro * math.sin(a))))
                ai = lerp(a0 + 0.12, a1 - 0.12, j / n)
                ring_in.append(bm.verts.new((cx + side * xi, center[1] + ri * math.cos(ai), center[2] + ri * math.sin(ai))))
            for j in range(n):
                q = (ring_in[j], ring_in[j + 1], ring_out[j + 1], ring_out[j]) if side > 0 else (ring_in[j], ring_out[j], ring_out[j + 1], ring_in[j + 1])
                f = bm.faces.new(q)
                f.material_index = MI['trim']
        # porcas
    else:
        rim = [(rim_r, -0.004), (rim_r * 0.9, -0.02), (0.0, -0.025)]
        lathe(bm, rim, segs, 'alloy', (cx, center[1], center[2]), side)


def add_wheels(name, axles, track_half, R, width, rim_r, segs, lod, spokes=5, dual_rear=False, hub_mat='alloy'):
    bm = bmesh.new()
    for i, ay in enumerate(axles):
        for s in (1, -1):
            wdt = width * (1.9 if (dual_rear and i == 0) else 1.0)
            wheel(bm, (s * track_half, ay, R), s, R, wdt, rim_r, segs, lod, spokes, hub_mat)
    return new_obj(name, bm)


# ------------------------------------------------------------------------------------------ primitivas extras
def rounded_box(name, size, center, mat, bevel=0.02, segs=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bm.transform(Matrix.Diagonal((size[0], size[1], size[2], 1)))
    bm.transform(Matrix.Translation(center))
    for f in bm.faces:
        f.material_index = MI[mat]
    ob = new_obj(name, bm)
    if bevel > 0:
        m = ob.modifiers.new('bev', 'BEVEL')
        m.width = bevel
        m.segments = segs
        m.limit_method = 'NONE'
        bake(ob)
    return ob


def mirror_obj(name, size, center, mats_ob, bevel, segs, body_mat='paint'):
    """retrovisor: carcaça arredondada na cor da carroceria, com base preta"""
    out = []
    for s in (1, -1):
        cx = center[0] * s
        a = rounded_box(name, size, (cx, center[1], center[2]), body_mat, bevel, segs)
        b = rounded_box(name + '_b', (0.05, 0.08, 0.06), (cx - s * size[0] * 0.55, center[1] + 0.02, center[2] - 0.03), 'trim', 0.01, 1)
        out += [a, b]
    return out


# ------------------------------------------------------------------------------------------ especificações
CARS = {
    # y: 0 = traseira, L = frente. zb fundo, zs linha de cintura/capô, zr teto, w meia-largura, wr meia-largura do teto
    'sedan': dict(
        L=4.42, W=1.78, R=0.315, tireW=0.2, rimR=0.205, axles=(0.95, 3.60), track=0.765,
        keys=[
            dict(y=0.00, zb=0.34, zs=0.88, zr=0.88, w=0.82, wr=0.62, tuck=0.82),
            dict(y=0.05, zb=0.26, zs=1.00, zr=1.00, w=0.870, wr=0.68),
            dict(y=0.25, zb=0.21, zs=1.045, zr=1.045, w=0.886, wr=0.70),
            dict(y=0.70, zb=0.19, zs=1.05, zr=1.06, w=0.890, wr=0.70),
            dict(y=1.40, zb=0.19, zs=1.03, zr=1.43, w=0.890, wr=0.69),
            dict(y=1.95, zb=0.19, zs=1.01, zr=1.46, w=0.890, wr=0.69),
            dict(y=2.45, zb=0.19, zs=0.99, zr=1.445, w=0.888, wr=0.69),
            dict(y=3.35, zb=0.19, zs=0.95, zr=0.96, w=0.884, wr=0.70),
            dict(y=3.85, zb=0.20, zs=0.90, zr=0.90, w=0.878, wr=0.70),
            dict(y=4.30, zb=0.23, zs=0.83, zr=0.83, w=0.852, wr=0.66),
            dict(y=4.42, zb=0.29, zs=0.76, zr=0.76, w=0.80, wr=0.60, tuck=0.82),
        ],
        windshield=(2.45, 3.35), backlight=(0.70, 1.40), side_glass=(0.95, 3.30), bpillar=(1.98, 2.10),
        cpillar_glass=False,
        lamps_front=dict(y=4.36, z0=0.67, z1=0.80, x0=0.44, x1=0.82),
        lamps_rear=dict(y=0.02, z0=0.86, z1=0.98, x0=0.46, x1=0.82),
        grille=dict(z0=0.48, z1=0.66, x=0.46), lower_grille=dict(z0=0.28, z1=0.42, x=0.64),
        doors=(1.20, 2.04, 3.18), handle_z=0.93,
    ),
    'hatch': dict(
        L=3.98, W=1.74, R=0.30, tireW=0.185, rimR=0.19, axles=(0.60, 3.13), track=0.745,
        keys=[
            dict(y=0.00, zb=0.36, zs=0.90, zr=0.90, w=0.76, wr=0.6, tuck=0.82),
            dict(y=0.04, zb=0.26, zs=0.99, zr=1.06, w=0.835, wr=0.62),
            dict(y=0.12, zb=0.21, zs=1.01, zr=1.22, w=0.86, wr=0.64),
            dict(y=0.48, zb=0.19, zs=1.01, zr=1.41, w=0.868, wr=0.66),
            dict(y=1.10, zb=0.19, zs=0.99, zr=1.475, w=0.870, wr=0.675),
            dict(y=1.75, zb=0.19, zs=0.97, zr=1.48, w=0.870, wr=0.675),
            dict(y=2.30, zb=0.19, zs=0.95, zr=1.44, w=0.868, wr=0.675),
            dict(y=3.15, zb=0.19, zs=0.89, zr=0.90, w=0.862, wr=0.68),
            dict(y=3.55, zb=0.21, zs=0.84, zr=0.84, w=0.852, wr=0.68),
            dict(y=3.88, zb=0.25, zs=0.77, zr=0.77, w=0.82, wr=0.64),
            dict(y=3.98, zb=0.31, zs=0.70, zr=0.70, w=0.74, wr=0.6, tuck=0.82),
        ],
        windshield=(2.30, 3.15), backlight=(0.04, 0.48), side_glass=(0.50, 3.05), bpillar=(1.72, 1.84),
        cpillar_glass=True, cpillar=(0.48, 0.80),
        lamps_front=dict(y=3.92, z0=0.70, z1=0.80, x0=0.50, x1=0.77),
        lamps_rear=dict(y=0.02, z0=0.90, z1=1.06, x0=0.56, x1=0.80),
        grille=dict(z0=0.44, z1=0.64, x=0.46), lower_grille=dict(z0=0.28, z1=0.40, x=0.58),
        doors=(1.12, 1.85, 2.78), handle_z=0.90,
    ),
    'suv': dict(
        L=4.45, W=1.82, R=0.355, tireW=0.215, rimR=0.225, axles=(0.93, 3.58), track=0.79,
        keys=[
            dict(y=0.00, zb=0.52, zs=1.00, zr=1.00, w=0.78, wr=0.66, tuck=0.80),
            dict(y=0.05, zb=0.36, zs=1.10, zr=1.16, w=0.875, wr=0.72),
            dict(y=0.16, zb=0.30, zs=1.12, zr=1.50, w=0.905, wr=0.73),
            dict(y=0.35, zb=0.28, zs=1.12, zr=1.66, w=0.910, wr=0.735),
            dict(y=1.20, zb=0.27, zs=1.12, zr=1.69, w=0.910, wr=0.74),
            dict(y=2.20, zb=0.27, zs=1.10, zr=1.695, w=0.910, wr=0.74),
            dict(y=2.85, zb=0.27, zs=1.09, zr=1.665, w=0.908, wr=0.74),
            dict(y=3.50, zb=0.27, zs=1.05, zr=1.06, w=0.902, wr=0.75),
            dict(y=3.95, zb=0.29, zs=1.00, zr=1.00, w=0.895, wr=0.75),
            dict(y=4.34, zb=0.33, zs=0.94, zr=0.94, w=0.85, wr=0.7),
            dict(y=4.45, zb=0.48, zs=0.82, zr=0.82, w=0.74, wr=0.62, tuck=0.80),
        ],
        windshield=(2.85, 3.50), backlight=(0.05, 0.35), side_glass=(0.40, 3.40), bpillar=(2.02, 2.12),
        cpillar_glass=True, cpillar=(0.35, 0.80), cladding=True,
        lamps_front=dict(y=4.40, z0=0.84, z1=0.94, x0=0.52, x1=0.82),
        lamps_rear=dict(y=0.02, z0=0.98, z1=1.12, x0=0.58, x1=0.84),
        grille=dict(z0=0.56, z1=0.82, x=0.55), lower_grille=dict(z0=0.36, z1=0.52, x=0.66),
        doors=(1.25, 2.07, 3.10), handle_z=1.02, roof_rails=True,
    ),
}
CARS['taxi'] = dict(CARS['sedan'], taxi=True)


def car_classifier(spec):
    ws0, ws1 = spec['windshield']
    bl0, bl1 = spec['backlight']
    sg0, sg1 = spec['side_glass']
    bp0, bp1 = spec['bpillar']

    def cls(a, b, row, side):
        ym = (a['y'] + b['y']) / 2
        gh = min(a['zr'] - a['zs'], b['zr'] - b['zs'])
        if row == 0:
            return 'trim'
        if row == 1 and spec.get('cladding'):
            return 'trim'
        if row in (5, 6):
            # limiar por linha: a borda do vidro fica inclinada, paralela ao para-brisa / coluna C
            front = ym > (bl1 + ws0) / 2
            thr = (0.15, 0.26)[row - 5] if front else (0.22, 0.31)[row - 5]
            if gh > thr and sg0 <= ym <= sg1 and not (bp0 <= ym <= bp1):
                if spec.get('cpillar') and spec['cpillar'][0] <= ym <= spec['cpillar'][1]:
                    return 'paint'
                return 'glass'
            if bp0 <= ym <= bp1 and gh > 0.16:
                return 'trim'
            return 'paint'
        if row == 8:
            if ws0 <= ym <= ws1 or bl0 <= ym <= bl1:
                return 'glass'
        return 'paint'
    return cls


def build_car(kind, lod, mats):
    spec = CARS[kind]
    L = spec['L']
    cuts = [*spec['windshield'], *spec['backlight'], *spec['side_glass'], *spec['bpillar'], *spec.get('cpillar', ())]
    st = sample_stations(spec['keys'], 0.16 if lod == 0 else 0.42, cuts)
    creases = {2: 0.35, 4: 0.55, 5: 0.75, 7: 0.45, 'cap': 0.35} if lod == 0 else None
    body = build_loft(f'{kind}_body', st, car_classifier(spec), creases=creases)
    assign_mats(body, mats)
    body = subdivide(body, 1 if lod == 0 else 0)
    if lod == 0:
        inset_glass(body)
    W2 = spec['W'] / 2
    cut_arches(body, spec['axles'], spec['R'] + (0.045 if lod == 0 else 0.05), W2, mats=mats)
    for p in body.data.polygons:
        p.use_smooth = True
    parts = [body]
    R, rimR = spec['R'], spec['rimR']
    trackX = W2 - 0.03

    # rodas
    wh = add_wheels(f'{kind}_wheels', spec['axles'], trackX, R, spec['tireW'], rimR, 26 if lod == 0 else 10, lod)
    assign_mats(wh, mats)
    parts.append(wh)

    lf, lr = spec['lamps_front'], spec['lamps_rear']
    # faróis (projetados no sentido Y sobre a frente)
    yF = L + 0.4
    parts += proj_patch('hlh', body, [(lf['x0'] - 0.015, yF, lf['z0'] - 0.015), (lf['x1'] + 0.012, yF, lf['z0'] + 0.005), (lf['x1'] - 0.005, yF, lf['z1'] + 0.012), (lf['x0'] - 0.015, yF, lf['z1'] + 0.002)],
                        'trim', 'Y', (0, 1, 0), 0.004, 5 if lod == 0 else 2, 2, 0.25 if lod == 0 else 0, mirror_x=True)
    parts += proj_patch('hl', body, [(lf['x0'], yF, lf['z0']), (lf['x1'], yF, lf['z0'] + 0.02), (lf['x1'] - 0.02, yF, lf['z1']), (lf['x0'], yF, lf['z1'] - 0.01)],
                        'lamp_front', 'Y', (0, 1, 0), 0.007, 5 if lod == 0 else 2, 2, 0.25 if lod == 0 else 0, mirror_x=True)
    # lanternas traseiras (envolvem a lateral)
    yR = -0.4
    parts += proj_patch('tl', body, [(lr['x0'], yR, lr['z0']), (lr['x1'], yR, lr['z0'] + 0.01), (lr['x1'], yR, lr['z1']), (lr['x0'], yR, lr['z1'])],
                        'lamp_rear', 'Y', (0, -1, 0), 0.007, 5 if lod == 0 else 2, 2, 0.2 if lod == 0 else 0, mirror_x=True)
    g, lg = spec['grille'], spec['lower_grille']
    # grade dianteira e entrada de ar inferior (plástico preto), placa sem caracteres
    parts += proj_patch('gr', body, [(-g['x'], yF, g['z0']), (g['x'], yF, g['z0']), (g['x'] * 0.92, yF, g['z1']), (-g['x'] * 0.92, yF, g['z1'])],
                        'trim', 'Y', (0, 1, 0), 0.005, 8 if lod == 0 else 2, 2, 0.15 if lod == 0 else 0)
    parts += proj_patch('lgr', body, [(-lg['x'], yF, lg['z0']), (lg['x'], yF, lg['z0']), (lg['x'], yF, lg['z1']), (-lg['x'], yF, lg['z1'])],
                        'trim', 'Y', (0, 1, 0), 0.005, 8 if lod == 0 else 2, 1, 0.1 if lod == 0 else 0)
    # para-choque traseiro: faixa preta inferior + placa
    parts += proj_patch('rb', body, [(-W2 * 0.8, yR, 0.30), (W2 * 0.8, yR, 0.30), (W2 * 0.8, yR, 0.42), (-W2 * 0.8, yR, 0.42)],
                        'trim', 'Y', (0, -1, 0), 0.005, 8 if lod == 0 else 2, 1)
    if lod == 0:
        pz = lr['z0'] - 0.20
        parts += proj_patch('pl', body, [(-0.2, yR, pz - 0.07), (0.2, yR, pz - 0.07), (0.2, yR, pz + 0.07), (-0.2, yR, pz + 0.07)],
                            'plate', 'Y', (0, -1, 0), 0.009, 3, 1)
        parts += proj_patch('plf', body, [(-0.2, yF, lg['z1'] + 0.005), (0.2, yF, lg['z1'] + 0.005), (0.2, yF, lg['z1'] + 0.13), (-0.2, yF, lg['z1'] + 0.13)],
                            'plate', 'Y', (0, 1, 0), 0.009, 3, 1)
        # piscas laterais / âmbar na lanterna
        parts += proj_patch('amb', body, [(lf['x1'] - 0.12, yF, lf['z0'] - 0.035), (lf['x1'] - 0.01, yF, lf['z0'] - 0.03), (lf['x1'] - 0.01, yF, lf['z0'] - 0.005), (lf['x1'] - 0.12, yF, lf['z0'] - 0.008)],
                            'lamp_amber', 'Y', (0, 1, 0), 0.008, 2, 1, mirror_x=True)
        # vincos das portas (frisos escuros finos) e maçanetas
        zl, zh = st[0]['zb'] + 0.12, None
        for yd in spec['doors']:
            zs_here = pchip([k['y'] for k in spec['keys']], [k['zs'] for k in spec['keys']])(yd)
            zr_here = pchip([k['y'] for k in spec['keys']], [k['zr'] for k in spec['keys']])(yd)
            top = zs_here - 0.01
            parts += proj_patch('seam', body, [(W2 + 0.4, yd - 0.005, 0.30), (W2 + 0.4, yd + 0.005, 0.30), (W2 + 0.4, yd + 0.005 - 0.03, top), (W2 + 0.4, yd - 0.005 - 0.03, top)],
                                'trim', 'X', (1, 0, 0), 0.0025, 1, 6, mirror_x=True)
        for yd in spec['doors'][1:]:
            yh = yd - 0.22
            z = spec['handle_z']
            parts += proj_patch('hd', body, [(W2 + 0.4, yh - 0.12, z - 0.015), (W2 + 0.4, yh + 0.0, z - 0.015), (W2 + 0.4, yh, z + 0.015), (W2 + 0.4, yh - 0.12, z + 0.015)],
                                'trim' if kind != 'sedan' else 'chrome', 'X', (1, 0, 0), 0.008, 2, 1, mirror_x=True)
    # retrovisores
    ky = [k['y'] for k in spec['keys']]
    my = spec['windshield'][1] - 0.2
    zs_m = pchip(ky, [k['zs'] for k in spec['keys']])(my)
    w_m = pchip(ky, [k['w'] for k in spec['keys']])(my)
    for sx in (1, -1):
        parts.append(rounded_box('mir', (0.10, 0.16, 0.11), (sx * (w_m * 0.95 + 0.09), my, zs_m + 0.075), 'paint', 0.035 if lod == 0 else 0.0, 2))
        parts.append(rounded_box('mirb', (0.10, 0.10, 0.06), (sx * (w_m * 0.95 + 0.0), my + 0.02, zs_m + 0.03), 'trim', 0.015 if lod == 0 else 0.0, 1))
        parts.append(rounded_box('mirg', (0.012, 0.13, 0.085), (sx * (w_m * 0.95 + 0.09), my - 0.083, zs_m + 0.075), 'glass', 0.0, 1) if False else
                     rounded_box('mirg', (0.08, 0.012, 0.085), (sx * (w_m * 0.95 + 0.095), my - 0.081, zs_m + 0.075), 'chrome', 0.0, 1))

    if spec.get('roof_rails'):
        zr_t = max(k['zr'] for k in spec['keys'])
        wr_t = 0.74
        for s in (1, -1):
            parts.append(rounded_box('rail', (0.04, 2.2, 0.035), (s * wr_t * 0.80, 1.75, zr_t + 0.012), 'trim', 0.012 if lod == 0 else 0, 1))

    if spec.get('taxi'):
        # faixa azul lateral (padrão carioca) entre as caixas de roda, na altura das portas
        a0, a1 = spec['axles'][0] + R + 0.12, spec['axles'][1] - R - 0.12
        parts += proj_patch('stripe', body, [(W2 + 0.4, a0, 0.66), (W2 + 0.4, a1, 0.66), (W2 + 0.4, a1, 0.76), (W2 + 0.4, a0, 0.76)],
                            'stripe', 'X', (1, 0, 0), 0.004, 16 if lod == 0 else 3, 1, mirror_x=True)
        zr_t = max(k['zr'] for k in spec['keys'])
        parts.append(rounded_box('sign', (0.62, 0.26, 0.16), (0, 2.25, zr_t + 0.09), 'sign_taxi', 0.03 if lod == 0 else 0, 2))
        parts.append(rounded_box('sign_b', (0.66, 0.30, 0.03), (0, 2.25, zr_t + 0.01), 'trim', 0.01 if lod == 0 else 0, 1))

    for p in parts:
        assign_mats(p, mats) if p is not body else None
    return join(parts, f'{kind}_LOD{lod}', mats)


def join(parts, name, mats):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for p in parts:
        if not p.data.materials or len(p.data.materials) != len(mats):
            fix_material_slots(p, mats)
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0002)
    bm.to_mesh(ob.data)
    bm.free()
    for p in ob.data.polygons:
        p.use_smooth = True
    try:
        ob.data.set_sharp_from_angle(angle=math.radians(38))
    except Exception:
        pass
    # frente para +Z do glTF (ver cabeçalho): gira 180° em Z e centraliza no comprimento
    ys = [v.co.y for v in ob.data.vertices]
    cy = (min(ys) + max(ys)) / 2
    ob.data.transform(Matrix.Rotation(math.pi, 4, 'Z') @ Matrix.Translation((0, -cy, 0)))
    ob.data.update()
    return ob


# ------------------------------------------------------------------------------------------ ônibus
BUS = dict(L=12.2, W=2.55, H=3.12, R=0.5, tireW=0.28, rimR=0.30, axles=(3.05, 9.55))


def bus_section(p):
    """seção do ônibus: retângulo de cantos arredondados; níveis fixos para janelas"""
    w, zb, zt = p['w'], p['zb'], p['zr']
    rt = 0.24
    pts = [(0.0, zb), (w - 0.06, zb), (w, zb + 0.06), (w, 0.62), (w, 1.08), (w, 1.42), (w, 2.62), (w, 2.80)]
    for i in range(1, 4):
        a = (math.pi / 2) * i / 4
        pts.append((w - rt + rt * math.cos(a), zt - rt + rt * math.sin(a)))
    pts.append((w * 0.5, zt))
    pts.append((0.0, zt + 0.01))
    return pts


def build_bus(lod, mats):
    L, W2 = BUS['L'], BUS['W'] / 2
    keys = [dict(y=0.0, zb=0.40, zr=3.02, w=W2 - 0.08), dict(y=0.12, zb=0.36, zr=3.08, w=W2 - 0.01), dict(y=0.35, zb=0.35, zr=3.10, w=W2),
            dict(y=L - 0.35, zb=0.35, zr=3.10, w=W2), dict(y=L - 0.10, zb=0.36, zr=3.06, w=W2 - 0.015), dict(y=L, zb=0.40, zr=2.98, w=W2 - 0.08)]
    for k in keys:
        k['zs'] = 1.4
        k['wr'] = k['w']
    # estações: extremidades + baias de janelas (colunas de 0.12 m)
    ys = [0.0, 0.12, 0.35]
    bay0, bay1 = 0.9, L - 1.6
    pillars = []
    y = bay0
    while y < bay1 - 0.5:
        pillars.append((y, y + 0.12))
        y += 1.42
    for (a, b) in pillars:
        ys += [a, b]
    ys += [bay1, bay1 + 0.12]
    ys += [L - 0.35, L - 0.10, L]
    ys = sorted(set(round(v, 3) for v in ys))
    if lod == 0:
        # densifica (curvaturas nas extremidades e sombras suaves)
        extra = []
        for i in range(len(ys) - 1):
            if ys[i + 1] - ys[i] > 0.8:
                extra.append((ys[i] + ys[i + 1]) / 2)
        ys = sorted(ys + extra)
    kp = {n: pchip([k['y'] for k in keys], [k[n] for k in keys]) for n in ('zb', 'zr', 'w', 'zs', 'wr')}
    st = [dict({n: f(y) for n, f in kp.items()}, y=y) for y in ys]
    # portas no lado direito (+X): dianteira (à frente do eixo) e central
    doors = [(L - 1.55, L - 0.45), (5.4, 6.6)]
    in_pillar = lambda ym: any(a <= ym <= b for (a, b) in pillars) or bay1 <= ym <= bay1 + 0.12

    def cls(a, b, row, side):
        ym = (a['y'] + b['y']) / 2
        if row == 0:
            return 'trim'
        if row == 1:
            return 'trim'
        if side > 0 and any(d0 <= ym <= d1 for (d0, d1) in doors) and row in (2, 3, 4, 5):
            return 'glass' if row in (3, 4, 5) else 'trim'
        if row == 5:  # faixa de janelas
            if 0.9 <= ym <= bay1 + 0.12:
                return 'trim' if in_pillar(ym) else 'glass'
            return 'paint'
        if row == 6:
            return 'paint'
        return 'paint'
    body = build_loft('bus_body', st, cls, bus_section)
    assign_mats(body, mats)
    if lod == 0:
        inset_glass(body, 0.03, -0.012)
    cut_arches(body, BUS['axles'], BUS['R'] + 0.07, W2, 0.42, mats=mats)
    parts = [body]
    wh = add_wheels('bus_wheels', BUS['axles'], W2 - 0.04, BUS['R'], BUS['tireW'], BUS['rimR'], 22 if lod == 0 else 10, lod, spokes=8, dual_rear=True, hub_mat='chrome')
    assign_mats(wh, mats)
    parts.append(wh)
    yF, yR = L + 0.5, -0.5
    nu = 6 if lod == 0 else 2
    # para-brisa grande, letreiro de destino (LED âmbar), faróis, para-choque
    parts += proj_patch('ws', body, [(-W2 + 0.10, yF, 1.25), (W2 - 0.10, yF, 1.25), (W2 - 0.12, yF, 2.55), (-W2 + 0.12, yF, 2.55)], 'glass', 'Y', (0, 1, 0), 0.006, nu, 3)
    parts += proj_patch('wsf', body, [(-W2 + 0.06, yF, 1.20), (W2 - 0.06, yF, 1.20), (W2 - 0.06, yF, 2.95), (-W2 + 0.06, yF, 2.95)], 'trim', 'Y', (0, 1, 0), 0.003, nu, 3)
    parts += proj_patch('dest', body, [(-W2 + 0.25, yF, 2.64), (W2 - 0.25, yF, 2.64), (W2 - 0.25, yF, 2.88), (-W2 + 0.25, yF, 2.88)], 'sign', 'Y', (0, 1, 0), 0.009, nu, 1)
    parts += proj_patch('hl', body, [(0.78, yF, 0.62), (1.18, yF, 0.62), (1.18, yF, 0.78), (0.78, yF, 0.78)], 'lamp_front', 'Y', (0, 1, 0), 0.008, 2, 1, mirror_x=True)
    parts += proj_patch('am', body, [(0.60, yF, 0.62), (0.74, yF, 0.62), (0.74, yF, 0.78), (0.60, yF, 0.78)], 'lamp_amber', 'Y', (0, 1, 0), 0.008, 1, 1, mirror_x=True)
    parts += proj_patch('bmp', body, [(-W2, yF, 0.36), (W2, yF, 0.36), (W2, yF, 0.56), (-W2, yF, 0.56)], 'trim', 'Y', (0, 1, 0), 0.006, nu, 1)
    parts += proj_patch('grl', body, [(-0.5, yF, 0.84), (0.5, yF, 0.84), (0.5, yF, 1.08), (-0.5, yF, 1.08)], 'trim', 'Y', (0, 1, 0), 0.006, 3, 1)
    # traseira: vidro traseiro, lanternas, grade do motor, letreiro de linha
    parts += proj_patch('rw', body, [(-W2 + 0.3, yR, 1.85), (W2 - 0.3, yR, 1.85), (W2 - 0.3, yR, 2.6), (-W2 + 0.3, yR, 2.6)], 'glass', 'Y', (0, -1, 0), 0.006, nu, 2)
    parts += proj_patch('tl', body, [(1.02, yR, 0.70), (1.20, yR, 0.70), (1.20, yR, 1.35), (1.02, yR, 1.35)], 'lamp_rear', 'Y', (0, -1, 0), 0.008, 1, 3, mirror_x=True)
    parts += proj_patch('eng', body, [(-0.8, yR, 0.75), (0.8, yR, 0.75), (0.8, yR, 1.30), (-0.8, yR, 1.30)], 'trim', 'Y', (0, -1, 0), 0.006, nu, 2)
    parts += proj_patch('rbmp', body, [(-W2, yR, 0.36), (W2, yR, 0.36), (W2, yR, 0.56), (-W2, yR, 0.56)], 'trim', 'Y', (0, -1, 0), 0.006, nu, 1)
    if lod == 0:
        parts += proj_patch('rdest', body, [(-0.45, yR, 2.66), (0.45, yR, 2.66), (0.45, yR, 2.86), (-0.45, yR, 2.86)], 'sign', 'Y', (0, -1, 0), 0.009, 2, 1)
        parts += proj_patch('pl', body, [(-0.2, yR, 0.58), (0.2, yR, 0.58), (0.2, yR, 0.72), (-0.2, yR, 0.72)], 'plate', 'Y', (0, -1, 0), 0.009, 2, 1)
        # letreiro lateral (junto à porta dianteira) e piscas laterais
        parts += proj_patch('sdest', body, [(W2 + 0.5, L - 2.9, 2.30), (W2 + 0.5, L - 1.8, 2.30), (W2 + 0.5, L - 1.8, 2.52), (W2 + 0.5, L - 2.9, 2.52)], 'sign', 'X', (1, 0, 0), 0.009, 2, 1)
        # faixa decorativa clara (saia) — mantém leitura de ônibus urbano carioca
        parts += proj_patch('band', body, [(W2 + 0.5, 0.3, 1.12), (W2 + 0.5, L - 0.3, 1.12), (W2 + 0.5, L - 0.3, 1.20), (W2 + 0.5, 0.3, 1.20)], 'chrome', 'X', (1, 0, 0), 0.004, 24, 1, mirror_x=True)
    # retrovisores tipo "orelha de coelho"
    for s in (1, -1):
        parts.append(rounded_box('mirarm', (0.05, 0.35, 0.05), (s * (W2 - 0.05), L + 0.15, 2.55), 'trim', 0.015 if lod == 0 else 0, 1))
        parts.append(rounded_box('mirh', (0.10, 0.08, 0.36), (s * (W2 - 0.02), L + 0.33, 2.25), 'trim', 0.025 if lod == 0 else 0, 2))
    # ar-condicionado no teto
    parts.append(rounded_box('ac', (1.5, 2.6, 0.22), (0, 5.2, 3.18), 'paint', 0.06 if lod == 0 else 0, 2))
    for p in parts:
        if p is not body:
            assign_mats(p, mats)
    ob = join(parts, f'bus_LOD{lod}', mats)
    return ob


# ------------------------------------------------------------------------------------------ render de conferência
def setup_render_scene():
    sc = bpy.context.scene
    for eng in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT', 'CYCLES'):
        try:
            sc.render.engine = eng
            break
        except Exception:
            continue
    if sc.render.engine == 'CYCLES':
        sc.cycles.samples = 48
    sc.render.resolution_x, sc.render.resolution_y = 1100, 640
    world = bpy.data.worlds.new('w') if not sc.world else sc.world
    sc.world = world
    if hasattr(world, 'use_nodes'):
        try:
            world.use_nodes = True
        except Exception:
            pass
    nt = world.node_tree
    bg = next(n for n in nt.nodes if n.type == 'BACKGROUND')
    sky = nt.nodes.new('ShaderNodeTexGradient') if False else None
    bg.inputs['Color'].default_value = (0.55, 0.65, 0.80, 1)
    bg.inputs['Strength'].default_value = 0.55
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 2.6
    so = bpy.data.objects.new('sun', sun)
    so.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
    sc.collection.objects.link(so)
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=40)
    gr = new_obj('ground', bm)
    gm = bpy.data.materials.new('groundm')
    gm.diffuse_color = (0.18, 0.18, 0.18, 1)
    try:
        b = next(n for n in gm.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        b.inputs['Base Color'].default_value = (0.12, 0.12, 0.12, 1)
        b.inputs['Roughness'].default_value = 0.8
    except Exception:
        pass
    gr.data.materials.append(gm)
    cam = bpy.data.cameras.new('cam')
    cam.lens = 50
    co = bpy.data.objects.new('cam', cam)
    sc.collection.objects.link(co)
    sc.camera = co
    return co


def render_views(ob, cam, outdir, name, length):
    os.makedirs(outdir, exist_ok=True)
    sc = bpy.context.scene
    for o in sc.objects:
        if o.type == 'MESH' and o.name not in ('ground',):
            o.hide_render = o is not ob
    d = length * 1.25 + 2.5
    views = {'front34': (35, 0.32), 'rear34': (215, 0.30), 'side': (90, 0.15)}
    for vn, (az, el) in views.items():
        a = math.radians(az)
        # glTF frente = +Z => no Blender (antes do export) a frente está em -Y após a rotação de 180°
        pos = Vector((math.sin(a) * d, -math.cos(a) * d, 0.8 + el * d))
        cam.location = pos
        tgt = Vector((0, 0, 0.75 if length < 6 else 1.5))
        cam.rotation_euler = (tgt - pos).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(outdir, f'{name}_{vn}.png')
        bpy.ops.render.render(write_still=True)


# ------------------------------------------------------------------------------------------ principal
def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    built = []
    kinds = ['sedan', 'hatch', 'suv', 'taxi', 'bus']
    if ONLY:
        kinds = [k for k in kinds if k in ONLY]
    for kind in kinds:
        mats = make_materials(PREVIEW_PAINT[kind] if RENDER_DIR else None)
        for lod in (0, 1):
            ob = build_bus(lod, mats) if kind == 'bus' else build_car(kind, lod, mats)
            tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
            dims = ob.dimensions
            print(f'[veh] {ob.name}: {tris} tris, {len(ob.data.vertices)} verts, dims x={dims.x:.2f} y={dims.y:.2f} z={dims.z:.2f}')
            built.append(ob)
            if RENDER_DIR:
                if lod == 0:
                    cam = bpy.data.objects.get('cam') or setup_render_scene()
                    render_views(ob, cam, RENDER_DIR, ob.name, dims.y)
                elif kind != 'bus':
                    cam = bpy.data.objects.get('cam') or setup_render_scene()
                    render_views(ob, cam, RENDER_DIR, ob.name, dims.y)
        if RENDER_DIR:
            # cada modelo tem sua cor de prévia: renomeia materiais para não reaproveitar
            for m in list(bpy.data.materials):
                if m.name in MATS:
                    m.name = m.name + '_used'
    if RENDER_DIR:
        return
    for o in bpy.context.scene.objects:
        o.select_set(o in built)
    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(OUT), export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_normals=True, export_texcoords=False, export_materials='EXPORT',
                              export_cameras=False, export_lights=False, export_extras=False, export_animations=False)
    print('[veh] exportado', OUT, os.path.getsize(OUT), 'bytes')


main()
