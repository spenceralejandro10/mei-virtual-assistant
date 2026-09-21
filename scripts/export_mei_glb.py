import bpy
import os
import sys

def args_after_dashes():
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1:]

args = args_after_dashes()
out_glb = args[0] if len(args) > 0 else "/tmp/mei-yinn.glb"
out_report = args[1] if len(args) > 1 else "/tmp/mei-yinn-bones.txt"
max_texture = int(args[2]) if len(args) > 2 else 768

print("Mei export: preparing scene")
for obj in list(bpy.data.objects):
    if obj.type in {"CAMERA", "LIGHT"}:
        bpy.data.objects.remove(obj, do_unlink=True)

# Reduce source textures for a web-sized GLB while preserving the original Drive ZIP.
for image in bpy.data.images:
    if image.type != "IMAGE" or not image.has_data:
        continue
    width, height = image.size[:]
    if not width or not height:
        continue
    largest = max(width, height)
    if largest <= max_texture:
        continue
    scale = max_texture / float(largest)
    new_w = max(1, int(width * scale))
    new_h = max(1, int(height * scale))
    try:
        print(f"Resizing {image.name}: {width}x{height} -> {new_w}x{new_h}")
        image.scale(new_w, new_h)
        if image.source == "FILE" and image.filepath:
            image.save()
    except Exception as exc:
        print(f"Texture resize skipped for {image.name}: {exc}")

# Write rig inventory so the web runtime can be tuned against the actual skeleton.
lines = []
for obj in bpy.data.objects:
    if obj.type == "ARMATURE":
        lines.append(f"ARMATURE: {obj.name}")
        for bone in obj.data.bones:
            lines.append(f"BONE: {bone.name}")
if not lines:
    lines.append("NO_ARMATURE_FOUND")
os.makedirs(os.path.dirname(out_report), exist_ok=True)
with open(out_report, "w", encoding="utf-8") as handle:
    handle.write("\n".join(lines) + "\n")

os.makedirs(os.path.dirname(out_glb), exist_ok=True)
print("Exporting GLB:", out_glb)
bpy.ops.export_scene.gltf(
    filepath=out_glb,
    export_format="GLB",
    export_yup=True,
    export_apply=False,
    export_materials="EXPORT",
    export_texcoords=True,
    export_normals=True,
    export_skins=True,
    export_animations=True,
    export_morph=True,
    export_all_influences=False,
)
print("Mei GLB export complete")
