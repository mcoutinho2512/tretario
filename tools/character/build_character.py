"""
Monta o personagem humano (MakeHuman/MPFB2, assets CC0/CC-BY) no Blender e exporta GLB para o jogo.

uso:
  blender -b --python tools/character/build_character.py -- <saida.glb> [config.json]

Requisitos (fora do repositório, ver docs/CHARACTERS.md):
  - extensão MPFB2 instalada no Blender (GPL-3; só a FERRAMENTA, os assets gerados são CC0)
  - pacotes de assets do MakeHuman extraídos na pasta de dados do MPFB

Saída: um GLB com UM esqueleto (rig "game_engine") e malhas SEPARADAS por camada
(BODY, EYES, EYEBROWS, EYELASHES, HAIR, SHIRT, PANTS, SHOES), cada uma com seu material.
É essa separação que permite a arquitetura modular no cliente (src/characters/human/).
"""
import bpy, sys, json, os

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else "/tmp/human.glb"
CFG = json.load(open(argv[1])) if len(argv) > 1 else {}

from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.exportservice import ExportService
from bl_ext.user_default.mpfb.services.objectservice import ObjectService

# ------------------------------------------------------------------ cena limpa
bpy.ops.wm.read_factory_settings(use_empty=True)

human_info = {
    "name": CFG.get("name", "human"),
    "phenotype": CFG.get("phenotype", {
        "gender": 1.0, "age": 0.5, "muscle": 0.56, "weight": 0.52, "proportions": 0.62, "height": 0.55,
        "cupsize": 0.5, "firmness": 0.5,
        # carioca "pardo": mistura de matrizes (os macros do MakeHuman são contínuos)
        "race": {"african": 0.42, "caucasian": 0.48, "asian": 0.10},
    }),
    "rig": "game_engine",
    "eyes": CFG.get("eyes", "low-poly.mhclo"),
    "eyebrows": CFG.get("eyebrows", "eyebrow001.mhclo"),
    "eyelashes": CFG.get("eyelashes", "eyelashes01.mhclo"),
    "hair": CFG.get("hair", "short02.mhclo"),
    "teeth": "", "tongue": "", "proxy": "",
    "targets": [],
    "clothes": CFG.get("clothes", [
        "elvs_crude_t-shirt_male.mhclo",
        "punkduck_male_classic_jeans.mhclo",
        "punkduck_running_shoes_01.mhclo",
    ]),
    "skin_mhmat": CFG.get("skin", "young_caucasian_male.mhmat"),
    "skin_material_type": "GAMEENGINE",
    "eyes_material_type": "GAMEENGINE",
    "clothes_material_type": "GAMEENGINE",
    "skin_material_settings": {}, "eyes_material_settings": {},
    "expressions": [], "alternative_materials": {},
}

settings = HumanService.get_default_deserialization_settings()
settings["subdiv_levels"] = 0
settings["material_instances"] = "NEVER"
basemesh = HumanService.deserialize_from_dict(human_info, settings)

# resolve skin path (deserialize espera caminho absoluto ou relativo à pasta skins)
from bl_ext.user_default.mpfb.services.assetservice import AssetService
skin = AssetService.find_asset_absolute_path(human_info["skin_mhmat"], asset_subdir="skins")
if skin:
    HumanService.set_character_skin(skin, basemesh, skin_type="GAMEENGINE", material_instances=False)

# ------------------------------------------------------------------ assar alvos/máscaras, remover helpers
ExportService.bake_modifiers_remove_helpers(basemesh, bake_masks=True, bake_subdiv=False, remove_helpers=True)
if basemesh.data.shape_keys:
    bpy.context.view_layer.objects.active = basemesh
    basemesh.shape_key_add(name="baked", from_mix=True)
    for kb in list(basemesh.data.shape_keys.key_blocks):
        basemesh.shape_key_remove(kb)


# ------------------------------------------------------------------ materiais PBR limpos
# Os difusos do MakeHuman trazem canal alfa com lixo: só cabelo/sobrancelhas/cílios usam alfa.
ALPHA_LAYERS = {"HAIR", "EYEBROWS", "EYELASHES"}
ROUGH = {"BODY": 0.52, "EYES": 0.08, "HAIR": 0.55, "EYEBROWS": 0.7, "EYELASHES": 0.7, "SHIRT": 0.88, "PANTS": 0.82, "SHOES": 0.62}
TEX_SIZE = CFG.get("tex_size", {"BODY": 2048, "HAIR": 1024, "SHIRT": 1024, "PANTS": 1024, "SHOES": 1024, "EYES": 512, "EYEBROWS": 256, "EYELASHES": 256})

def _find_normal(diffuse_path):
    d = os.path.dirname(diffuse_path)
    for f in sorted(os.listdir(d)):
        fl = f.lower()
        if fl.endswith(".png") and ("norm" in fl) and not fl.endswith(".thumb"):
            return os.path.join(d, f)
    return None

def _resized(img, size):
    if img and max(img.size[:]) > size:
        img.scale(size, size)
    return img

def clean_material(obj, layer):
    old = obj.material_slots[0].material if obj.material_slots else None
    diffuse = None
    if old and old.node_tree:
        for n in old.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.name == "DiffuseTexture" and n.image:
                diffuse = n.image
    mat = bpy.data.materials.new(f"PV_{layer}")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = ROUGH.get(layer, 0.7)
    bsdf.inputs["Metallic"].default_value = 0.0
    if layer == "BODY":
        bsdf.inputs["Specular IOR Level"].default_value = 0.35
    if diffuse:
        src = diffuse.filepath_raw
        img = bpy.data.images.load(src, check_existing=False)
        img.name = f"{layer}_albedo"
        _resized(img, TEX_SIZE.get(layer, 1024))
        tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        if layer in ALPHA_LAYERS:
            nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
            mat.blend_method = "HASHED" if hasattr(mat, "blend_method") else None
        else:
            img.alpha_mode = "NONE"
        npath = _find_normal(src)
        if npath and layer not in {"EYEBROWS", "EYELASHES"}:
            nimg = bpy.data.images.load(npath, check_existing=False)
            nimg.name = f"{layer}_normal"
            nimg.colorspace_settings.name = "Non-Color"
            _resized(nimg, TEX_SIZE.get(layer, 1024))
            ntex = nt.nodes.new("ShaderNodeTexImage"); ntex.image = nimg
            nm = nt.nodes.new("ShaderNodeNormalMap")
            nt.links.new(ntex.outputs["Color"], nm.inputs["Color"])
            nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    obj.data.materials.clear()
    obj.data.materials.append(mat)

rig = ObjectService.find_object_of_type_amongst_nearest_relatives(basemesh, "Skeleton")
LAYER = {"Basemesh": "BODY", "Eyes": "EYES", "Eyebrows": "EYEBROWS", "Eyelashes": "EYELASHES", "Hair": "HAIR"}
CLOTH_LAYER = CFG.get("cloth_layers", {"t-shirt": "SHIRT", "shirt": "SHIRT", "jeans": "PANTS", "pants": "PANTS", "trouser": "PANTS", "shoes": "SHOES", "sneaker": "SHOES", "boots": "SHOES"})

report = {"objects": []}
for obj in list(bpy.data.objects):
    if obj.type != "MESH":
        continue
    t = ObjectService.get_object_type(obj)
    layer = LAYER.get(t)
    if t == "Clothes":
        n = obj.name.lower()
        layer = next((v for k, v in CLOTH_LAYER.items() if k in n), "ACCESSORY")
    if layer is None:
        bpy.data.objects.remove(obj)
        continue
    obj.name = layer
    clean_material(obj, layer)
    # remove modificadores restantes que não sejam a armadura (o glTF exporta a malha avaliada)
    for m in list(obj.modifiers):
        if m.type != "ARMATURE":
            obj.modifiers.remove(m)
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    mats = [s.material.name for s in obj.material_slots if s.material]
    report["objects"].append({"layer": layer, "verts": len(obj.data.vertices), "tris": tris, "materials": mats})

if rig:
    rig.name = "Armature"
    report["bones"] = [b.name for b in rig.data.bones]

bpy.ops.export_scene.gltf(
    filepath=OUT, export_format="GLB", export_skins=True, export_animations=False,
    export_apply=False, export_yup=True, export_image_format="WEBP", export_image_quality=82,
    export_texcoords=True, export_normals=True, export_tangents=False, export_materials="EXPORT",
)

# ------------------------------------------------------------------ animações (GLB separado, compartilhado entre personagens)
ANIM_OUT = CFG.get("anim_out")
if ANIM_OUT and rig:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import retarget
    report["clips"] = retarget.retarget(rig)
    for obj in list(bpy.data.objects):
        if obj.type == "MESH":
            bpy.data.objects.remove(obj, do_unlink=True)
    bpy.ops.export_scene.gltf(
        filepath=ANIM_OUT, export_format="GLB", export_skins=True, export_animations=True,
        export_animation_mode="ACTIONS", export_force_sampling=True, export_optimize_animation_size=True,
        export_materials="NONE", export_yup=True,
    )

json.dump(report, open(OUT + ".report.json", "w"), indent=1)
print("REPORT", json.dumps(report))
