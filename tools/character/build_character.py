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
  <id>.report.json  contagens e metadados

Requisitos (fora do repositório, ver docs/CHARACTERS.md): extensão MPFB2 no Blender (GPL-3, só a ferramenta;
os assets gerados são CC0/CC-BY conforme o pacote) e os pacotes de assets extraídos na pasta de dados do MPFB.
"""
import bpy, sys, json, os

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
CFG = json.load(open(argv[0]))
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

# acessórios ficam ocultos por padrão no jogo: não podem apagar pele (cabeça) por baixo
for m in list(basemesh.modifiers):
    if m.type == "MASK" and m.name.startswith("Delete."):
        asset = m.name[len("Delete."):] + ".mhclo"
        if CLOTHES.get(asset, "").startswith("ACC_"):
            basemesh.modifiers.remove(m)

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


def clean_material(obj, layer):
    old = obj.material_slots[0].material if obj.material_slots else None
    diffuse = None
    if old and old.node_tree:
        for n in old.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.name == "DiffuseTexture" and n.image:
                diffuse = n.image.filepath_raw
    base = "ACC" if layer.startswith("ACC_") else layer
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
    override = CFG.get("texture_override", {}).get(layer)
    if override:
        diffuse = AssetService.find_asset_absolute_path(override, asset_subdir=CFG.get("texture_override_dir", {}).get(layer, "hair")) or diffuse
    if diffuse:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = _img(diffuse, f"{VID}_{layer}_albedo", size)
        # cor média (sRGB) gravada no material (extras glTF → material.userData.pv_avg no jogo): base da tinta
        import numpy as np
        px = np.empty(len(tex.image.pixels), dtype=np.float32)
        tex.image.pixels.foreach_get(px)
        w_, h_ = tex.image.size
        px = px.reshape(h_, w_, 4)
        # amostra só onde a malha usa a textura (os atlas têm áreas vazias/pretas que distorcem a média)
        uvl = obj.data.uv_layers.active
        if uvl:
            uv = np.empty(len(uvl.data) * 2, dtype=np.float32)
            uvl.data.foreach_get("uv", uv)
            uv = uv.reshape(-1, 2) % 1.0
            sel = px[(uv[:, 1] * (h_ - 1)).astype(int), (uv[:, 0] * (w_ - 1)).astype(int)]
        else:
            sel = px.reshape(-1, 4)
        if layer in ALPHA_LAYERS and (sel[:, 3] > 0.5).any():
            sel = sel[sel[:, 3] > 0.5]
        mat["pv_avg"] = [float(v) for v in sel[:, :3].mean(axis=0)]
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        if layer in ALPHA_LAYERS:
            nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
        else:
            tex.image.alpha_mode = "NONE"
        npath = _find_map(diffuse, ("norm",))
        if npath and layer not in {"EYEBROWS", "EYELASHES"}:
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

# teto de triângulos por camada no LOD0 (alguns assets da comunidade vêm com malhas enormes)
CAP = {"BODY": 30000, "HAIR": 7000, "SHIRT": 5000, "PANTS": 5500, "SHOES": 3200, "EYES": 2100, "ACC": 1600}
CAP.update(CFG.get("tri_cap", {}))


def _tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def _cap(obj, layer):
    cap = CAP.get("ACC" if layer.startswith("ACC_") else layer)
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
report["tris_lod0_visible"] = sum(o["tris"] for o in report["objects"] if not o["layer"].startswith("ACC_"))


def export(path, materials="EXPORT"):
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", export_skins=True, export_animations=False,
        export_apply=False, export_yup=True, export_image_format="WEBP", export_image_quality=80,
        export_texcoords=True, export_normals=True, export_tangents=False, export_materials=materials,
        export_vertex_color="ACTIVE", export_attributes=True, export_extras=True,
    )


export(os.path.join(OUTDIR, f"{VID}.glb"))
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
    r = LOD1_RATIO.get(layer, 0.4)
    if r < 1:
        decimate(obj, r)
for img in bpy.data.images:
    if img.size[0] > 512:
        img.scale(512, 512)
        img.filepath_raw = os.path.join(TMPDIR, f"lod1_{img.name}.png")
        img.save()
export(os.path.join(OUTDIR, f"{VID}_lod1.glb"))
report["tris_lod1"] = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for k, o in layers.items() if not k.startswith("ACC_"))

# ------------------------------------------------------------------ LOD2/LOD3: uma malha, cor assada em vértices
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.samples = 4
sc.cycles.device = "CPU"
keep = [o for k, o in layers.items() if not k.startswith("ACC_") and k not in ("EYEBROWS", "EYES")]
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
    export(os.path.join(OUTDIR, f"{VID}_{name}.glb"))

for f in ("lod1", "lod2", "lod3"):
    report[f"bytes_{f}"] = os.path.getsize(os.path.join(OUTDIR, f"{VID}_{f}.glb"))
json.dump(report, open(os.path.join(OUTDIR, f"{VID}.report.json"), "w"), indent=1)
print("REPORT", json.dumps({k: v for k, v in report.items() if k != "bones"}))
