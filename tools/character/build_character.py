"""
Monta um personagem humano (MakeHuman/MPFB2, assets CC0/CC-BY) no Blender e exporta GLBs para o jogo.

uso:
  blender -b --python tools/character/build_character.py -- <config.json> <pasta-saida>

Gera, para a variante `id` do config:
  <id>.glb        LOD0: malhas SEPARADAS por camada (BODY, EYES, EYEBROWS, EYELASHES, HAIR, SHIRT, PANTS, SHOES,
                  ACC_<acessório>) sobre UM esqueleto ("game_engine", 53 ossos), materiais PBR, texturas WebP
  <id>_lod1.glb   camadas decimadas (~35 %), texturas 512
  <id>_lod2.glb   UMA malha (~2,5 k triângulos), cor das texturas assada em cor de vértice → 1 draw call
  <id>_lod3.glb   UMA malha (~600 triângulos), cor de vértice
  anims.glb       (se "anim_out" no config) clipes retargetados da Universal Animation Library (CC0)
  <id>-<camada>-<estilo>.glb / _lod1.glb   PEÇAS VARIANTES ("variants" no config): uma camada alternativa
                  (regata, bermuda, chinelo, outro cabelo…) ajustada a ESTE corpo, no mesmo esqueleto; o jogo só
                  baixa a peça quando alguém a veste de perto (LOD2/LOD3 aproximam as variantes no shader)
  <id>.report.json  contagens e metadados

Pele sob a roupa: com variantes, o corpo só perde (máscara "Delete" do MakeHuman) os vértices cobertos por TODAS as
peças da mesma camada (interseção) — nunca a pele que uma peça mais curta deixa à mostra. O resto é recortado no
jogo por combinação de peças (hideCovered). Os LODs de malha única continuam sem a pele coberta pela roupa padrão.
`--no-anims` ignora "anim_out" (reconstruir corpos sem regravar anims.glb).

Requisitos (fora do repositório, ver docs/CHARACTERS.md): extensão MPFB2 no Blender (GPL-3, só a ferramenta;
os assets gerados são CC0/CC-BY conforme o pacote) e os pacotes de assets extraídos na pasta de dados do MPFB.
"""
import bpy, sys, json, os

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
NO_ANIMS = "--no-anims" in argv
argv = [a for a in argv if not a.startswith("--")]
CFG = json.load(open(argv[0]))
if NO_ANIMS:
    CFG.pop("anim_out", None)
OUTDIR = argv[1] if len(argv) > 1 else "/tmp"
VID = CFG["id"]
os.makedirs(OUTDIR, exist_ok=True)
TMPDIR = os.path.join(OUTDIR, "_tex", VID)
os.makedirs(TMPDIR, exist_ok=True)

from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.exportservice import ExportService
from bl_ext.user_default.mpfb.services.objectservice import ObjectService
from bl_ext.user_default.mpfb.services.assetservice import AssetService

bpy.ops.wm.read_factory_settings(use_empty=True)

# camada de cada asset de roupa/acessório: {"arquivo.mhclo": "SHIRT" | "PANTS" | "SHOES" | "ACC_bone" ...}
CLOTHES = CFG["clothes"]
human_info = {
    "name": VID,
    "phenotype": CFG["phenotype"],
    "rig": "game_engine",
    "eyes": CFG.get("eyes", "high-poly.mhclo"),
    "eyebrows": CFG.get("eyebrows", "eyebrow001.mhclo"),
    "eyelashes": CFG.get("eyelashes", "eyelashes01.mhclo"),
    "hair": CFG.get("hair", ""),
    "teeth": "", "tongue": "", "proxy": "", "targets": [],
    "clothes": list(CLOTHES.keys()),
    "skin_mhmat": "", "skin_material_type": "NONE",
    "eyes_material_type": "GAMEENGINE", "clothes_material_type": "GAMEENGINE",
    "skin_material_settings": {}, "eyes_material_settings": {},
    "expressions": [], "alternative_materials": {},
}
settings = HumanService.get_default_deserialization_settings()
settings["subdiv_levels"] = 0
settings["material_instances"] = "NEVER"
basemesh = HumanService.deserialize_from_dict(human_info, settings)
skin = AssetService.find_asset_absolute_path(CFG["skin"], asset_subdir="skins")
HumanService.set_character_skin(skin, basemesh, skin_type="GAMEENGINE", material_instances=False)

# ------------------------------------------------------------------ peças variantes (mesmo corpo, mesmo esqueleto)
# [{"layer": "SHIRT", "style": "polo", "file": "x.mhclo", "kind": "clothes"|"hair", "texture": "..."}]
# sem "file": estilo sem malha (p.ex. cabelo raspado) ou "derive": "sleeveless" (regata cortada da camiseta base)
VARIANTS = CFG.get("variants", [])
VAR_OBJ = {}
for v in VARIANTS:
    if not v.get("file"):
        continue
    kind = v.get("kind", "clothes")
    path = AssetService.find_asset_absolute_path(v["file"], asset_subdir=kind)
    assert path, f"asset não encontrado: {v['file']}"
    names0 = {o.name for o in bpy.data.objects}
    HumanService.add_mhclo_asset(path, basemesh, asset_type=kind, subdiv_levels=0, material_type="GAMEENGINE",
                                 alternative_materials={}, color_adjustments=None)
    new = [o for o in bpy.data.objects if o.name not in names0 and o.type == "MESH"]
    assert new, f"nenhuma malha criada por {v['file']}"
    VAR_OBJ[f"{v['layer']}_{v['style']}"] = new[0]

masks = {m.name[len("Delete."):]: m for m in basemesh.modifiers if m.type == "MASK" and m.name.startswith("Delete.")}
# acessórios ficam ocultos por padrão no jogo: não podem apagar pele (cabeça) por baixo
for asset, m in list(masks.items()):
    if CLOTHES.get(asset + ".mhclo", "").startswith("ACC_"):
        basemesh.modifiers.remove(m)
        masks.pop(asset)


def _group_verts(name):
    vg = basemesh.vertex_groups.get(name)
    if vg is None:
        return set()
    gi = vg.index
    return {v.index for v in basemesh.data.vertices if any(g.group == gi and g.weight > 0.5 for g in v.groups)}


# máscara por camada = interseção das peças da camada (base + variantes); os LODs de malha única apagam a da base
slot_assets = {}
for asset, layer in CLOTHES.items():
    if layer in ("SHIRT", "PANTS", "SHOES"):
        slot_assets.setdefault(layer, []).append(asset[:-6])
if CFG.get("hair"):
    slot_assets.setdefault("HAIR", []).append(CFG["hair"][:-6])
for v in VARIANTS:
    slot_assets.setdefault(v["layer"], []).append(v["file"][:-6] if v.get("file") else None)
low_delete = set()
for slot, assets in slot_assets.items():
    if len(assets) < 2:
        continue
    sets = [_group_verts(masks[a].vertex_group) if a in masks else set() for a in assets]
    inter = set.intersection(*sets)
    low_delete |= sets[0] - inter
    print("MASK", slot, list(zip(assets, map(len, sets))), "interseção", len(inter), "fora:", [k for k in masks if k not in assets])
    for a in assets:
        if a in masks:
            basemesh.modifiers.remove(masks.pop(a))
    if inter:
        vg = basemesh.vertex_groups.new(name=f"PV_DEL_{slot}")
        vg.add(sorted(inter), 1.0, "ADD")
        m = basemesh.modifiers.new(name=f"PV_DEL_{slot}", type="MASK")
        m.vertex_group = vg.name
        m.invert_vertex_group = True
if low_delete:
    basemesh.vertex_groups.new(name="PV_LOW_DELETE").add(sorted(low_delete), 1.0, "ADD")

ExportService.bake_modifiers_remove_helpers(basemesh, bake_masks=True, bake_subdiv=False, remove_helpers=True)
if basemesh.data.shape_keys:
    bpy.context.view_layer.objects.active = basemesh
    basemesh.shape_key_add(name="baked", from_mix=True)
    for kb in list(basemesh.data.shape_keys.key_blocks):
        basemesh.shape_key_remove(kb)

# ------------------------------------------------------------------ materiais PBR limpos
# Os difusos do MakeHuman trazem canal alfa com lixo: só cabelo/sobrancelhas/cílios usam alfa.
ALPHA_LAYERS = {"HAIR", "EYEBROWS", "EYELASHES", "ACC_oculos"}
ROUGH = {"BODY": 0.5, "EYES": 0.06, "HAIR": 0.5, "EYEBROWS": 0.7, "EYELASHES": 0.7, "SHIRT": 0.9, "PANTS": 0.84, "SHOES": 0.6}
TEX = {"BODY": 2048, "HAIR": 1024, "SHIRT": 1024, "PANTS": 1024, "SHOES": 512, "EYES": 512, "EYEBROWS": 256, "EYELASHES": 256, "ACC": 512}
TEX.update(CFG.get("tex_size", {}))


def _find_map(diffuse_path, words):
    d = os.path.dirname(diffuse_path)
    for f in sorted(os.listdir(d)):
        fl = f.lower()
        if fl.endswith(".png") and any(w in fl for w in words):
            return os.path.join(d, f)
    return None


def _img(path, name, size, non_color=False):
    img = bpy.data.images.load(path, check_existing=False)
    img.name = name
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    if max(img.size[:]) > size:
        img.scale(size, size)
    # grava a versão reduzida: o exportador glTF relê o arquivo de origem se a imagem não estiver "suja"
    tmp = os.path.join(TMPDIR, f"{name}.png")
    img.filepath_raw = tmp
    img.file_format = "PNG"
    img.save()
    return img


def slot_of(layer):
    """camada-base de uma chave: "SHIRT_regata" → "SHIRT", "ACC_bone" → "ACC" """
    return "ACC" if layer.startswith("ACC_") else layer.split("_")[0]


VAR_CFG = {f"{v['layer']}_{v['style']}": v for v in VARIANTS}


def clean_material(obj, layer):
    old = obj.material_slots[0].material if obj.material_slots else None
    diffuse = None
    if old and old.node_tree:
        for n in old.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.name == "DiffuseTexture" and n.image:
                diffuse = n.image.filepath_raw
    base = slot_of(layer)
    alpha = layer in ALPHA_LAYERS or base in ALPHA_LAYERS
    mat = bpy.data.materials.new(f"PV_{layer}")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = ROUGH.get(base, 0.6)
    bsdf.inputs["Metallic"].default_value = 0.0
    if layer == "BODY":
        bsdf.inputs["Specular IOR Level"].default_value = 0.32
    size = TEX.get(layer, TEX.get(base, 512))
    # textura base clara (tingida no jogo pela cor escolhida), ex.: cabelo grisalho/platinado
    override = VAR_CFG[layer].get("texture") if layer in VAR_CFG else CFG.get("texture_override", {}).get(layer)
    if override:
        sub = VAR_CFG[layer].get("kind", "clothes") if layer in VAR_CFG else CFG.get("texture_override_dir", {}).get(layer, "hair")
        diffuse = AssetService.find_asset_absolute_path(override, asset_subdir=sub) or diffuse
    if diffuse:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = _img(diffuse, f"{VID}_{layer}_albedo", size)
        # cor média (sRGB) gravada no material (extras glTF → material.userData.pv_avg no jogo): base da tinta
        import numpy as np
        px = np.empty(len(tex.image.pixels), dtype=np.float32)
        tex.image.pixels.foreach_get(px)
        w_, h_ = tex.image.size
        px = px.reshape(h_, w_, 4)
        # peças variantes de roupa: base NEUTRA e clara (tons de cinza, detalhe preservado, média ~0,7), como os
        # cabelos — várias vinham escuras ou estampadas (camisa xadrez verde, bermuda preta) e a tinta não chegava à cor
        if layer in VAR_CFG and VAR_CFG[layer].get("kind", "clothes") == "clothes" and VAR_CFG[layer].get("neutral", True):
            lum = px[:, :, :3] @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
            # contraste ORIGINAL em torno de 0,72 (esticar o contraste realçava ruído da trama e inflava o WebP)
            lum = np.clip(0.72 + (lum - float(np.median(lum))) * 0.9, 0.3, 1.0)
            px[:, :, 0] = px[:, :, 1] = px[:, :, 2] = lum
            tex.image.pixels.foreach_set(px.ravel())
            tex.image.save()
        # amostra só onde a malha usa a textura (os atlas têm áreas vazias/pretas que distorcem a média)
        uvl = obj.data.uv_layers.active
        if uvl:
            uv = np.empty(len(uvl.data) * 2, dtype=np.float32)
            uvl.data.foreach_get("uv", uv)
            uv = uv.reshape(-1, 2) % 1.0
            sel = px[(uv[:, 1] * (h_ - 1)).astype(int), (uv[:, 0] * (w_ - 1)).astype(int)]
        else:
            sel = px.reshape(-1, 4)
        if alpha and (sel[:, 3] > 0.5).any():
            sel = sel[sel[:, 3] > 0.5]
        mat["pv_avg"] = [float(v) for v in sel[:, :3].mean(axis=0)]
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        if alpha:
            nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
        else:
            tex.image.alpha_mode = "NONE"
        npath = _find_map(diffuse, ("norm",))
        # peças variantes sem mapa de normais: metade das texturas por peça (download e memória; o relevo do tecido
        # quase não aparece na base neutra tingida)
        if npath and base not in {"EYEBROWS", "EYELASHES"} and layer not in VAR_CFG:
            ntex = nt.nodes.new("ShaderNodeTexImage")
            ntex.image = _img(npath, f"{VID}_{layer}_normal", size, non_color=True)
            nm = nt.nodes.new("ShaderNodeNormalMap")
            nt.links.new(ntex.outputs["Color"], nm.inputs["Color"])
            nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    obj.data.materials.clear()
    obj.data.materials.append(mat)


rig = ObjectService.find_object_of_type_amongst_nearest_relatives(basemesh, "Skeleton")
rig.name = "Armature"
LAYER = {"Basemesh": "BODY", "Eyes": "EYES", "Eyebrows": "EYEBROWS", "Eyelashes": "EYELASHES", "Hair": "HAIR"}
report = {"id": VID, "objects": [], "bones": [b.name for b in rig.data.bones]}
layers = {}
for obj in list(bpy.data.objects):
    if obj.type != "MESH":
        continue
    t = ObjectService.get_object_type(obj)
    layer = LAYER.get(t)
    if t == "Clothes":
        layer = next((v for k, v in CLOTHES.items() if k[:-6] in obj.name), None)
    layer = next((k for k, o in VAR_OBJ.items() if o == obj), layer)
    if layer is None:
        bpy.data.objects.remove(obj)
        continue
    obj.name = layer
    for m in list(obj.modifiers):
        if m.type != "ARMATURE":
            obj.modifiers.remove(m)
    clean_material(obj, layer)
    layers[layer] = obj
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    report["objects"].append({"layer": layer, "verts": len(obj.data.vertices), "tris": tris})



def derive_sleeveless(src, key):
    """regata derivada da camiseta (CC0): cava reta (corte por plano vertical um pouco para dentro do ombro, acima da
    axila) e a manga inteira removida — sem degraus de faces nem aba sobre o ombro"""
    import bmesh
    from mathutils import Vector
    obj = src.copy()
    obj.data = src.data.copy()
    bpy.context.scene.collection.objects.link(obj)
    obj.name = key
    inv = obj.matrix_world.inverted()
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    arms = []
    for side in ("l", "r"):
        b = rig.data.bones[f"upperarm_{side}"]
        arms.append((rig.matrix_world @ b.head_local, rig.matrix_world @ b.tail_local))
    for h, _ in arms:
        sx = 1.0 if h.x > 0 else -1.0
        co = inv @ Vector((h.x - sx * 0.035, 0, 0))
        no = (inv.to_3x3() @ Vector((sx, 0, 0))).normalized()
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no)
        # fundo da cava (axila) também reto — só na lateral (no peito o corte deixaria uma costura visível)
        side = [f for f in bm.faces if (lambda c: c.x * h.x > 0 and abs(c.x) > abs(h.x) - 0.08)(obj.matrix_world @ f.calc_center_median())]
        geom = list({v for f in side for v in f.verts}) + list({e for f in side for e in f.edges}) + side
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=inv @ Vector((0, 0, h.z - 0.11)), plane_no=(inv.to_3x3() @ Vector((0, 0, 1))).normalized())
    cut = []
    for f in bm.faces:
        c = obj.matrix_world @ f.calc_center_median()
        for h, t in arms:
            d = t - h
            k = (c - h).dot(d) / d.length_squared
            dist = (c - (h + d * max(0.0, k))).length
            # cava: além do plano e acima da axila; manga: ao longo do braço, perto do eixo
            if (abs(c.x) > abs(h.x) - 0.035 and c.z > h.z - 0.11 and c.x * h.x > 0) or (k > 0.25 and dist < 0.11):
                cut.append(f)
                break
    bmesh.ops.delete(bm, geom=cut, context="FACES")
    bm.to_mesh(obj.data)
    bm.free()
    return obj


for v in VARIANTS:
    if v.get("derive") == "sleeveless":
        key = f"{v['layer']}_{v['style']}"
        layers[key] = derive_sleeveless(layers[v["layer"]], key)
        report["objects"].append({"layer": key, "verts": len(layers[key].data.vertices), "tris": 0})
VAR_KEYS = [k for k in layers if k in VAR_CFG]
BASE_KEYS = [k for k in layers if k not in VAR_CFG]

# teto de triângulos por camada no LOD0 (alguns assets da comunidade vêm com malhas enormes)
CAP = {"BODY": 30000, "HAIR": 7000, "SHIRT": 5000, "PANTS": 5500, "SHOES": 3200, "EYES": 2100, "ACC": 1600}
CAP.update(CFG.get("tri_cap", {}))


def _tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def _cap(obj, layer):
    cap = CAP.get(slot_of(layer))
    t = _tris(obj)
    if cap and t > cap:
        m = obj.modifiers.new("cap", "DECIMATE")
        m.ratio = cap / t
        m.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_move_to_index(modifier="cap", index=0)
        bpy.ops.object.modifier_apply(modifier="cap")


for layer, obj in layers.items():
    _cap(obj, layer)
for o in report["objects"]:
    o["tris"] = _tris(layers[o["layer"]])
report["tris_lod0_visible"] = sum(o["tris"] for o in report["objects"] if not o["layer"].startswith("ACC_") and o["layer"] not in VAR_CFG)


def export(path, materials="EXPORT", keys=None, objs=None):
    """exporta o esqueleto + as camadas `keys` (padrão: as da roupa base, sem as peças variantes)"""
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    for o in objs or [layers[k] for k in (BASE_KEYS if keys is None else keys) if k in layers]:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", export_skins=True, export_animations=False, use_selection=True,
        export_apply=False, export_yup=True, export_image_format="WEBP", export_image_quality=80,
        export_texcoords=True, export_normals=True, export_tangents=False, export_materials=materials,
        export_vertex_color="ACTIVE", export_attributes=True, export_extras=True,
    )


def piece_file(key, suffix=""):
    layer, style = key.split("_", 1)
    return os.path.join(OUTDIR, f"{VID}-{layer.lower()}-{style}{suffix}.glb")


def export_pieces(suffix=""):
    for k in VAR_KEYS:
        export(piece_file(k, suffix), keys=[k])
        report.setdefault("pieces", {}).setdefault(k, {})[f"bytes{suffix or '_lod0'}"] = os.path.getsize(piece_file(k, suffix))
        report["pieces"][k][f"tris{suffix or '_lod0'}"] = _tris(layers[k])


export(os.path.join(OUTDIR, f"{VID}.glb"))
export_pieces()
report["bytes_lod0"] = os.path.getsize(os.path.join(OUTDIR, f"{VID}.glb"))

# ------------------------------------------------------------------ animações (GLB separado, compartilhado)
if CFG.get("anim_out"):
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import retarget
    report["clips"] = retarget.retarget(rig)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(
        filepath=CFG["anim_out"], export_format="GLB", use_selection=True, export_skins=True, export_animations=True,
        export_animation_mode="ACTIONS", export_force_sampling=True, export_optimize_animation_size=True,
        export_materials="NONE", export_yup=True,
    )
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    rig.animation_data_clear()
    for pb in rig.pose.bones:
        pb.matrix_basis.identity()
    report["bytes_anims"] = os.path.getsize(CFG["anim_out"])


# ------------------------------------------------------------------ LOD1: camadas decimadas, texturas 512
def decimate(obj, ratio):
    m = obj.modifiers.new("dec", "DECIMATE")
    m.ratio = ratio
    m.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_move_to_index(modifier="dec", index=0)
    bpy.ops.object.modifier_apply(modifier="dec")


if "EYELASHES" in layers:
    bpy.data.objects.remove(layers.pop("EYELASHES"))
LOD1_RATIO = {"BODY": 0.33, "HAIR": 0.4, "SHIRT": 0.35, "PANTS": 0.35, "SHOES": 0.3, "EYES": 0.5, "EYEBROWS": 1.0}
for layer, obj in layers.items():
    r = LOD1_RATIO.get(slot_of(layer), 0.4)
    if r < 1:
        decimate(obj, r)
for img in bpy.data.images:
    if img.size[0] > 512:
        img.scale(512, 512)
        img.filepath_raw = os.path.join(TMPDIR, f"lod1_{img.name}.png")
        img.save()
export(os.path.join(OUTDIR, f"{VID}_lod1.glb"))
export_pieces("_lod1")
report["tris_lod1"] = sum(_tris(o) for k, o in layers.items() if not k.startswith("ACC_") and k not in VAR_CFG)

# ------------------------------------------------------------------ LOD2/LOD3: uma malha, cor assada em vértices
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.samples = 4
sc.cycles.device = "CPU"
keep = [o for k, o in layers.items() if not k.startswith("ACC_") and k not in ("EYEBROWS", "EYES") and k not in VAR_CFG]
# malha única: sem a pele coberta pela roupa PADRÃO (nos LOD0/1 ela fica para as peças mais curtas e é recortada no
# jogo). Além da máscara do MakeHuman, o mesmo teste do jogo (hideCovered): raio pela normal da pele que cruza a roupa
# longe das bordas — sem isso a pele decimada atravessava a camiseta em manchas no LOD2/LOD3
def covered_body_faces(bo, cloths, inside=0.035, outside=0.03, edge=0.02):
    from mathutils.bvhtree import BVHTree
    from mathutils.kdtree import KDTree
    cov = set()
    for c in cloths:
        mw = c.matrix_world
        verts = [mw @ v.co for v in c.data.vertices]
        bvh = BVHTree.FromPolygons(verts, [tuple(p.vertices) for p in c.data.polygons])
        count = {}
        for e in c.data.edges:
            count[e.key] = 0
        for p in c.data.polygons:
            for k in p.edge_keys:
                count[k] = count.get(k, 0) + 1
        bnd = {i for k, n in count.items() if n == 1 for i in k}
        kd = KDTree(max(1, len(bnd)))
        for i in bnd:
            kd.insert(verts[i], i)
        kd.balance()
        bw, bn = bo.matrix_world, bo.matrix_world.to_3x3()
        for v in bo.data.vertices:
            if v.index in cov:
                continue
            p, n = bw @ v.co, (bn @ v.normal).normalized()
            loc = bvh.ray_cast(p - n * inside, n, inside + outside)[0]
            if loc is not None and (not bnd or kd.find(loc)[2] > edge):
                cov.add(v.index)
    return cov


import bmesh
bo = layers["BODY"]
dele = set()
if "PV_LOW_DELETE" in bo.vertex_groups:
    gi = bo.vertex_groups["PV_LOW_DELETE"].index
    dele = {v.index for v in bo.data.vertices if any(g.group == gi and g.weight > 0.5 for g in v.groups)}
cov = covered_body_faces(bo, [layers[k] for k in ("SHIRT", "PANTS", "SHOES") if k in layers])
bm = bmesh.new()
bm.from_mesh(bo.data)
bm.verts.ensure_lookup_table()
gone = [f for f in bm.faces if all(v.index in dele or v.index in cov for v in f.verts)]
bmesh.ops.delete(bm, geom=gone, context="FACES")
bm.to_mesh(bo.data)
bm.free()
report["low_deleted_faces"] = len(gone)
LAYER_INDEX = {"BODY": 0, "HAIR": 1, "SHIRT": 2, "PANTS": 3, "SHOES": 4}
for k, o in list(layers.items()):
    if o not in keep:
        bpy.data.objects.remove(o)
for o in keep:
    # emissão = cor da textura (assar "EMIT" não depende da iluminação)
    mat = o.material_slots[0].material
    nt = mat.node_tree
    tex = next((n for n in nt.nodes if n.type == "TEX_IMAGE" and n.image and "albedo" in n.image.name), None)
    em = nt.nodes.new("ShaderNodeEmission")
    if tex:
        nt.links.new(tex.outputs["Color"], em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], nt.nodes["Material Output"].inputs["Surface"])
    # índice da camada por vértice (exportado como atributo glTF "_LAYER"): o jogo tinge cada parte na malha única
    li = LAYER_INDEX.get(o.name, 0)
    la = o.data.attributes.new("_LAYER", "FLOAT", "POINT")
    la.data.foreach_set("value", [float(li)] * len(o.data.vertices))
    ca = o.data.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
    o.data.color_attributes.active_color = ca
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.bake(type="EMIT", target="VERTEX_COLORS")
bpy.ops.object.select_all(action="DESELECT")
for o in keep:
    o.select_set(True)
bpy.context.view_layer.objects.active = keep[0]
bpy.ops.object.join()
merged = bpy.context.view_layer.objects.active
merged.name = "LOD"
vc = bpy.data.materials.new("PV_LOD")
vc.use_nodes = True
attr = vc.node_tree.nodes.new("ShaderNodeVertexColor")
attr.layer_name = "Col"
vc.node_tree.links.new(attr.outputs["Color"], vc.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
vc.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.75
merged.data.materials.clear()
merged.data.materials.append(vc)
for target, name in ((2500, "lod2"), (600, "lod3")):
    tris = sum(len(p.vertices) - 2 for p in merged.data.polygons)
    decimate(merged, min(1.0, target / tris))
    report[f"tris_{name}"] = sum(len(p.vertices) - 2 for p in merged.data.polygons)
    export(os.path.join(OUTDIR, f"{VID}_{name}.glb"), objs=[merged])

for f in ("lod1", "lod2", "lod3"):
    report[f"bytes_{f}"] = os.path.getsize(os.path.join(OUTDIR, f"{VID}_{f}.glb"))
json.dump(report, open(os.path.join(OUTDIR, f"{VID}.report.json"), "w"), indent=1)
print("REPORT", json.dumps({k: v for k, v in report.items() if k != "bones"}))
