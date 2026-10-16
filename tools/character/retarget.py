"""
Retarget (no Blender) das animações da Universal Animation Library (Quaternius, CC0) para o rig
"game_engine" do MakeHuman/MPFB. Usado por build_character.py; exportado como clipes glTF.

Método: para cada osso mapeado, a rotação de MUNDO do osso de origem relativa ao seu repouso
(q_delta = S_pose · S_rest⁻¹) é aplicada ao repouso do alvo. Nos membros, a pose de repouso difere
(origem em pose T, alvo em pose A), então compensamos com Rdir = rotação que leva a direção do osso
de origem à direção do osso alvo:  T_pose = q_delta · Rdir⁻¹ · T_rest.
A pelve recebe também a translação (escalada pela altura da pelve). O resultado é gravado em matrix_basis.
"""
import bpy, glob
from mathutils import Matrix, Quaternion, Vector

MAP = {
    "pelvis": "DEF-hips", "spine_01": "DEF-spine.001", "spine_02": "DEF-spine.002", "spine_03": "DEF-spine.003",
    "neck_01": "DEF-neck", "head": "DEF-head",
}
for s, S in (("l", "L"), ("r", "R")):
    MAP.update({
        f"clavicle_{s}": f"DEF-shoulder.{S}", f"upperarm_{s}": f"DEF-upper_arm.{S}", f"lowerarm_{s}": f"DEF-forearm.{S}",
        f"hand_{s}": f"DEF-hand.{S}", f"thigh_{s}": f"DEF-thigh.{S}", f"calf_{s}": f"DEF-shin.{S}",
        f"foot_{s}": f"DEF-foot.{S}", f"ball_{s}": f"DEF-toe.{S}",
    })
    for f in ("index", "middle", "ring", "pinky"):
        for i in (1, 2, 3):
            MAP[f"{f}_0{i}_{s}"] = f"DEF-f_{f}.0{i}.{S}"
    for i in (1, 2, 3):
        MAP[f"thumb_0{i}_{s}"] = f"DEF-thumb.0{i}.{S}"
LIMB = lambda n: not (n in ("pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "head"))

# clipes usados pelo jogo: nome no jogo ← nome na biblioteca
CLIPS = {
    "idle": "Idle_Loop", "walk": "Walk_Loop", "jog": "Jog_Fwd_Loop", "sprint": "Sprint_Loop",
    "drive": "Driving_Loop", "push": "Push_Loop", "dance": "Dance_Loop",
    "jump_start": "Jump_Start", "jump_loop": "Jump_Loop", "jump_land": "Jump_Land",
    "hit": "Hit_Chest", "talk": "Idle_Talking_Loop", "interact": "Interact", "sit": "Sitting_Idle_Loop",
}
LOOPS = {"idle", "walk", "jog", "sprint", "drive", "push", "dance", "jump_loop", "talk", "sit"}


def _depth(b):
    d = 0
    while b.parent:
        b, d = b.parent, d + 1
    return d


def retarget(tgt, ual_path=None):
    ual_path = ual_path or glob.glob("/Users/magnun/pv3d-assets-src/ual/**/*.glb", recursive=True)[0]
    before = set(bpy.data.objects)
    before_actions = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=ual_path)
    new_objs = [o for o in bpy.data.objects if o not in before]
    src = next(o for o in new_objs if o.type == "ARMATURE")
    src_actions = {a.name.split("|")[0].split(".")[0]: a for a in bpy.data.actions if a not in before_actions}
    sc = bpy.context.scene

    W_t, W_s = tgt.matrix_world.copy(), src.matrix_world.copy()
    T_rest = {b.name: W_t @ b.matrix_local for b in tgt.data.bones}
    S_rest = {b.name: W_s @ b.matrix_local for b in src.data.bones}
    order = sorted(tgt.data.bones, key=_depth)

    def bone_dir(arm_w, b):
        return ((arm_w @ b.tail_local) - (arm_w @ b.head_local)).normalized()

    Rdir = {}
    for t, s in MAP.items():
        if t in tgt.data.bones and s in src.data.bones and LIMB(t):
            Rdir[t] = bone_dir(W_s, src.data.bones[s]).rotation_difference(bone_dir(W_t, tgt.data.bones[t]))
    h_t = T_rest["pelvis"].translation.z
    h_s = S_rest["DEF-hips"].translation.z
    ratio = h_t / h_s

    for pb in tgt.pose.bones:
        pb.rotation_mode = "QUATERNION"
    tgt.animation_data_create()
    report = {}
    for clip, src_name in CLIPS.items():
        act_src = src_actions.get(src_name)
        if not act_src:
            print("RETARGET: clipe ausente", src_name)
            continue
        src.animation_data.action = act_src
        if hasattr(src.animation_data, "action_slot") and act_src.slots:
            src.animation_data.action_slot = act_src.slots[0]
        f0, f1 = int(act_src.frame_range[0]), int(round(act_src.frame_range[1]))
        act = bpy.data.actions.new(clip)
        act.use_fake_user = True
        tgt.animation_data.action = act
        prev_q = {}
        foot_track = []
        for f in range(f0, f1 + 1):
            sc.frame_set(f)
            S_pose = {n: W_s @ src.pose.bones[n].matrix for n in S_rest}
            T_pose = {}
            for b in order:
                n = b.name
                P = b.parent.name if b.parent else None
                rest = T_rest[n]
                if P:
                    inherited = T_pose[P] @ T_rest[P].inverted() @ rest
                else:
                    inherited = rest.copy()
                s = MAP.get(n)
                if s and s in S_pose:
                    q_delta = S_pose[s].to_quaternion() @ S_rest[s].to_quaternion().inverted()
                    if n in Rdir:
                        rot = q_delta @ Rdir[n].inverted() @ rest.to_quaternion()
                    else:
                        rot = q_delta @ rest.to_quaternion()
                    pos = inherited.translation
                    if n == "pelvis":
                        d = S_pose[s].translation - S_rest[s].translation
                        pos = rest.translation + d * ratio
                    T_pose[n] = Matrix.LocRotScale(pos, rot, rest.to_scale())
                else:
                    T_pose[n] = inherited
                pb = tgt.pose.bones[n]
                local_rest = (T_rest[P].inverted() @ rest) if P else rest
                parent_pose = T_pose[P] if P else Matrix.Identity(4)
                basis = local_rest.inverted() @ parent_pose.inverted() @ T_pose[n]
                q = basis.to_quaternion()
                if n in prev_q and prev_q[n].dot(q) < 0:
                    q.negate()
                prev_q[n] = q
                pb.rotation_quaternion = q
                pb.keyframe_insert("rotation_quaternion", frame=f - f0)
                if n == "pelvis":
                    pb.location = basis.translation
                    pb.keyframe_insert("location", frame=f - f0)
            foot_track.append((f, T_pose["foot_l"].translation.copy(), T_pose["foot_r"].translation.copy()))
        # velocidade natural do ciclo (para sincronizar a passada no jogo): pé em apoio anda para trás
        fps = sc.render.fps / sc.render.fps_base
        speeds = []
        for side in (1, 2):
            zs = [p[side].z for p in foot_track]
            zmin = min(zs)
            for (fa, *a), (fb, *b) in zip(foot_track, foot_track[1:]):
                pa, pb2 = a[side - 1], b[side - 1]
                if pa.z < zmin + 0.02 and pb2.z < zmin + 0.02:
                    speeds.append(abs(pb2.y - pa.y) * fps / (fb - fa))
        speeds.sort()
        natural = speeds[len(speeds) // 2] if speeds else 0.0
        report[clip] = {"frames": f1 - f0 + 1, "seconds": round((f1 - f0) / fps, 3), "speed": round(natural, 3), "loop": clip in LOOPS}
        print("RETARGET", clip, report[clip])
    tgt.animation_data.action = None
    for o in new_objs:
        bpy.data.objects.remove(o, do_unlink=True)
    for a in list(bpy.data.actions):
        if a in src_actions.values():
            bpy.data.actions.remove(a)
    return report
