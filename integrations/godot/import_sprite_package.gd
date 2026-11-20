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
	if not archive.file_exists("kinetix.json") or not archive.file_exists("atlas.png"):
		_fail("The package must contain kinetix.json and atlas.png.")
		return
	var manifest: Variant = JSON.parse_string(archive.read_file("kinetix.json").get_string_from_utf8())
	if not manifest is Dictionary or not _valid_manifest(manifest):
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
	var frames := _sprite_frames(manifest, ImageTexture.create_from_image(image))
	var frames_path := target + "/frames.res"
	if ResourceSaver.save(frames, frames_path, ResourceSaver.FLAG_CHANGE_PATH) != OK:
		_fail("Could not save the SpriteFrames resource.")
		return

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
		_fail("Could not save the generated sprite scene.")
		return
	print("KINETIX_IMPORT " + JSON.stringify({"scene":scene_path,"frames":frames_path,"frameCount":manifest.frames.size()}))
	quit()

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
