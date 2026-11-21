extends SceneTree

const MAX_PACKAGE_BYTES := 1500000
const MAX_ATLAS_PIXELS := 16 * 1024 * 1024

func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() != 1:
		_fail("Pass the path to a Kinetix sprite ZIP after --.")
		return
	var package_path := args[0]
	var archive := ZIPReader.new()
	var file := FileAccess.open(package_path, FileAccess.READ)
	if file == null or file.get_length() > MAX_PACKAGE_BYTES or archive.open(package_path) != OK:
		_fail("Could not open this Kinetix sprite ZIP.")
		return
	if not archive.file_exists("kinetix.json"):
		_fail("The package must contain kinetix.json.")
		return
	var sizes := _archive_sizes(file.get_buffer(file.get_length()))
	if sizes.is_empty() or not sizes.has("kinetix.json"):
		_fail("The ZIP entry sizes are invalid or exceed the package limit.")
		return
	var manifest: Variant = JSON.parse_string(archive.read_file("kinetix.json").get_string_from_utf8())
	if manifest is Dictionary and manifest.get("schema") == "kinetix.sprite-package" and manifest.get("version") == 2:
		var directory: String = get_script().resource_path.get_base_dir()
		var adapter_path := directory.path_join("import_sprite_bundle.gd")
		if not FileAccess.file_exists(adapter_path) or not FileAccess.file_exists(directory.path_join("kinetix_sprite.gd")):
			_fail("Keep all three importer scripts in the same project folder for a version 2 bundle.")
			return
		var adapter := load(adapter_path) as Script
		if adapter == null or not adapter.can_instantiate():
			_fail("The version 2 importer could not load.")
			return
		var result: Dictionary = adapter.new().import_bundle(archive, sizes, manifest)
		archive.close()
		if result.has("error"):
			_fail(result.error)
		else:
			print("KINETIX_IMPORT " + JSON.stringify(result))
			quit()
		return
	if not sizes.has("atlas.png") or not manifest is Dictionary or not _valid_manifest(manifest):
		_fail("Invalid or unsupported Kinetix sprite manifest.")
		return
	var png := archive.read_file("atlas.png")
	archive.close()
	var sha := HashingContext.new()
	sha.start(HashingContext.HASH_SHA256)
	sha.update(png)
	if sha.finish().hex_encode() != manifest.atlas.get("sha256", ""):
		_fail("The atlas checksum does not match the manifest.")
		return
	var image := Image.new()
	var size := Vector2i(int(manifest.atlas.width), int(manifest.atlas.height))
	if image.load_png_from_buffer(png) != OK or image.get_size() != size:
		_fail("The atlas PNG dimensions do not match the manifest.")
		return
	var target := "res://kinetix_generated/%s/%s" % [manifest.source.rigId, manifest.source.clipId]
	var directory_status := DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(target))
	if directory_status != OK:
		_fail("Could not create the generated asset directory.")
		return
	var lock := ProjectSettings.globalize_path(target.get_base_dir()).path_join(".kinetix-import.lock")
	if DirAccess.make_dir_absolute(lock) != OK:
		_fail("The asset directory is locked. Finish the existing import before retrying.")
		return
	var result := _save_legacy(manifest, image, target)
	DirAccess.remove_absolute(lock)
	if result.has("error"):
		_fail(result.error)
	else:
		print("KINETIX_IMPORT " + JSON.stringify(result))
		quit()

func _save_legacy(manifest: Dictionary, image: Image, target: String) -> Dictionary:
	var frames := _sprite_frames(manifest, ImageTexture.create_from_image(image))
	var frames_path := target + "/frames.res"
	if ResourceSaver.save(frames, frames_path, ResourceSaver.FLAG_CHANGE_PATH) != OK:
		return {"error": "Could not save the SpriteFrames resource."}

	var sprite := AnimatedSprite2D.new()
	sprite.name = "KinetixSprite"
	sprite.sprite_frames = frames
	sprite.autoplay = frames.get_animation_names()[0]
	sprite.centered = false
	sprite.offset = -_point(manifest.frames[0].pivot)
	sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST if manifest.atlas.filter == "nearest" else CanvasItem.TEXTURE_FILTER_LINEAR
	sprite.set_meta("kinetix_source", manifest.source)
	var scene := PackedScene.new()
	var scene_path := target + "/sprite.tscn"
	var pack_status := scene.pack(sprite)
	sprite.free()
	if pack_status != OK or ResourceSaver.save(scene, scene_path) != OK:
		return {"error": "Could not save the generated sprite scene."}
	return {"scene": scene_path, "frames": frames_path, "frameCount": manifest.frames.size()}

# Bound ZIP extraction using the central directory before allocating any entry.
func _archive_sizes(bytes: PackedByteArray) -> Dictionary:
	var end_record := bytes.size() - 22
	var earliest := maxi(0, end_record - 65535)
	while end_record >= earliest:
		if bytes.decode_u32(end_record) == 0x06054b50 and end_record + 22 + bytes.decode_u16(end_record + 20) == bytes.size():
			break
		end_record -= 1
	if end_record < earliest or bytes.decode_u32(end_record + 4) != 0:
		return {}
	var count := bytes.decode_u16(end_record + 10)
	var cursor := bytes.decode_u32(end_record + 16)
	if count < 1 or count > 128 or count != bytes.decode_u16(end_record + 8) or cursor + bytes.decode_u32(end_record + 12) != end_record:
		return {}
	var names := {}
	var total := 0
	for item in range(count):
		if cursor + 46 > end_record or bytes.decode_u32(cursor) != 0x02014b50:
			return {}
		var length := bytes.decode_u16(cursor + 28)
		var next := cursor + 46 + length + bytes.decode_u16(cursor + 30) + bytes.decode_u16(cursor + 32)
		var entry_size := bytes.decode_u32(cursor + 24)
		total += entry_size
		if next > end_record or total > MAX_PACKAGE_BYTES:
			return {}
		var name := bytes.slice(cursor + 46, cursor + 46 + length).get_string_from_utf8()
		if name.is_empty() or names.has(name):
			return {}
		names[name] = entry_size
		cursor = next
	return names if cursor == end_record else {}

func _valid_manifest(manifest: Dictionary) -> bool:
	if manifest.get("schema") != "kinetix.sprite-package" or manifest.get("version") != 1 or manifest.get("layout") != "fixed-grid":
		return false
	var source: Variant = manifest.get("source")
	var atlas: Variant = manifest.get("atlas")
	var clip: Variant = manifest.get("clip")
	var frames: Variant = manifest.get("frames")
	if not source is Dictionary or not atlas is Dictionary or not clip is Dictionary or not frames is Array:
		return false
	var uuid := RegEx.create_from_string("^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$")
	for key in ["rigId", "clipId"]:
		if not source.get(key) is String or uuid.search(source[key]) == null:
			return false
	if atlas.get("file") != "atlas.png" or atlas.get("filter") not in ["nearest", "linear"]:
		return false
	var width := int(atlas.get("width", 0))
	var height := int(atlas.get("height", 0))
	if width < 1 or height < 1 or width > 8192 or height > 8192 or width * height > MAX_ATLAS_PIXELS:
		return false
	var fps := float(clip.get("fps", 0))
	if fps < 1 or fps > 120 or not clip.get("name") is String or not clip.get("loop") is bool:
		return false
	if frames.is_empty() or frames.size() > 96:
		return false
	for frame in frames:
		if not frame is Dictionary or not frame.get("pivot") is Dictionary or not frame.get("rect") is Dictionary:
			return false
		var rect: Dictionary = frame.rect
		if float(frame.get("durationTicks", 0)) <= 0 or _point(frame.pivot) != _point(frames[0].pivot):
			return false
		var position := _point(rect)
		var extent := Vector2(float(rect.get("width", 0)), float(rect.get("height", 0)))
		if position.x < 0 or position.y < 0 or extent.x <= 0 or extent.y <= 0:
			return false
		if position.x + extent.x > width or position.y + extent.y > height:
			return false
	return true

func _point(data: Dictionary) -> Vector2:
	return Vector2(float(data.get("x", 0)), float(data.get("y", 0)))

func _sprite_frames(manifest: Dictionary, atlas: ImageTexture) -> SpriteFrames:
	var frames := SpriteFrames.new()
	var animation := StringName(str(manifest.clip.name).validate_node_name())
	if animation != &"default":
		frames.rename_animation("default", animation)
	frames.set_animation_speed(animation, float(manifest.clip.fps))
	frames.set_animation_loop(animation, manifest.clip.loop)
	for frame in manifest.frames:
		var texture := AtlasTexture.new()
		texture.atlas = atlas
		texture.region = Rect2(_point(frame.rect), Vector2(float(frame.rect.width), float(frame.rect.height)))
		texture.filter_clip = true
		frames.add_frame(animation, texture, float(frame.durationTicks))
	return frames

func _fail(message: String) -> void:
	printerr(message)
	quit(1)
