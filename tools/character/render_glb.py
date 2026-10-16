"""Render de verificação de um GLB de personagem: blender -b --python render_glb.py -- in.glb out.png [close|full]"""
import bpy, sys, math
argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
mode = argv[2] if len(argv) > 2 else "full"
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE"
sc.render.resolution_x, sc.render.resolution_y = (900, 900) if mode == "close" else (700, 1000)
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.35, 0.4, 0.45, 1); w.node_tree.nodes["Background"].inputs[1].default_value = 0.8
def light(kind, loc, energy, rot):
    d = bpy.data.lights.new(kind, kind); d.energy = energy
    o = bpy.data.objects.new(kind, d); o.location = loc; o.rotation_euler = rot; sc.collection.objects.link(o)
light("SUN", (3, -4, 5), 3.5, (math.radians(50), 0, math.radians(30)))
light("AREA", (-3, 2, 3), 300, (math.radians(-60), 0, math.radians(-140)))
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
if mode == "close":
    cam.data.lens = 85; cam.location = (0.3, -1.25, 1.66); cam.rotation_euler = (math.radians(89), 0, math.radians(12))
else:
    cam.data.lens = 50; cam.location = (0.9, -4.2, 1.0); cam.rotation_euler = (math.radians(89), 0, math.radians(12))
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
