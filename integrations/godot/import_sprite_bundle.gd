extends RefCounted

const Runtime = preload("kinetix_sprite.gd")
const MAX_PIXELS := 16 * 1024 * 1024
const MAX_BYTES := 1500000

var _uuid := RegEx.create_from_string("^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$")
var _digest := RegEx.create_from_string("^[a-f0-9]{64}$")

func import_bundle(archive: ZIPReader, sizes: Dictionary, manifest: Dictionary) -> Dictionary:
	var error := _validate(manifest, sizes)
	if not error.is_empty():
		return {"error": error}
	var pages := {}
	for file: Dictionary in manifest.files:
		var png := archive.read_file(file.file)
		if png.size() != int(file.bytes) or _sha(png) != file.sha256:
			return {"error": "The texture checksum does not match %s." % file.file}
		var image := Image.new()
		var raw_png := _raw_png(png, file)
		if raw_png.is_empty() or image.load_png_from_buffer(raw_png) != OK:
			return {"error": "The PNG dimensions or encoding do not match %s." % file.file}
		image.convert(Image.FORMAT_RGBA8)
		pages[file.file] = image
	var root := "res://kinetix_generated/%s" % manifest.source.rigId
	var directory := ProjectSettings.globalize_path(root)
	if DirAccess.make_dir_recursive_absolute(directory) != OK:
		return {"error": "Could not create the generated asset directory."}
	var lock := directory.path_join(".kinetix-import.lock")
	if DirAccess.make_dir_absolute(lock) != OK:
		return {"error": "The asset directory is locked. Finish the existing import before retrying."}
	var result := _write_assets(manifest, pages, root)
	DirAccess.remove_absolute(lock)
	return result

func _write_assets(manifest: Dictionary, pages: Dictionary, root: String) -> Dictionary:
	var resources := {}
	var textures := _build_textures(manifest, pages, root, resources)
	if textures.is_empty():
		return {"error": "The unique decoded sprite crops exceed the import pixel limit."}

	var previous_path := root.path_join("frames.res")
	var previous := _existing_frames(previous_path)
	var previous_clips: Dictionary = previous.get_meta("kinetix_clips", {}) if previous else {}
	var historical_keys: Dictionary = previous.get_meta("kinetix_clip_keys", {}).duplicate() if previous else {}
	for key: String in previous_clips:
		historical_keys[previous_clips[key].id] = key
	var keys := _clip_keys(manifest.clips, root, historical_keys)
	var aggregate := _frames_resource()
	var all_metadata := {}
	var imported: Array[Dictionary] = []
	var frame_count := 0
	for clip: Dictionary in manifest.clips:
		var key: String = keys[clip.id].aggregate
		var single_key: String = keys[clip.id].single
		historical_keys[clip.id] = key
		var single := _frames_resource()
		var metadata := _clip_metadata(clip)
		all_metadata[key] = metadata
		_add_clip(aggregate, key, metadata, textures)
		_add_clip(single, single_key, metadata, textures)
		single.set_meta("kinetix_clips", {single_key: metadata})
		if not _add_outputs(resources, root.path_join(clip.id), single, single_key, manifest):
			return {"error": "Could not assemble the scene for clip %s." % clip.name}
		frame_count += clip.frames.size()
		imported.append({"id": clip.id, "key": key, "singleKey": single_key, "name": clip.name,
			"direction": clip.get("direction", ""), "frameCount": clip.frames.size(),
			"scene": root.path_join(clip.id).path_join("sprite.tscn")})
	aggregate.set_meta("kinetix_clips", all_metadata)
	aggregate.set_meta("kinetix_clip_keys", historical_keys)
	if not _add_outputs(resources, root, aggregate, imported[0].key, manifest):
		return {"error": "Could not assemble the multi-clip scene."}
	var omitted: Array[String] = []
	for metadata: Dictionary in previous_clips.values():
		if not keys.has(metadata.id):
			omitted.append(metadata.id)
	var error := _publish(resources)
	if not error.is_empty():
		return {"error": error}
	return {"version": 2, "scene": root.path_join("sprite.tscn"), "frames": previous_path,
		"frameCount": frame_count, "clips": imported, "omittedClipIds": omitted}

func _validate(manifest: Dictionary, sizes: Dictionary) -> String:
	var layout: Variant = manifest.get("layout")
	var source: Variant = manifest.get("source")
	var texture: Variant = manifest.get("texture")
	var files: Variant = manifest.get("files")
	var clips: Variant = manifest.get("clips")
	if layout not in ["loose", "fixed-grid", "packed"] or not source is Dictionary or not texture is Dictionary:
		return "Invalid version 2 sprite layout, source or texture settings."
	if not _matches(source.get("rigId"), _uuid) or not _int(source.get("revision"), 0, 9007199254740991) or not _int(source.get("pixelScale"), 1, 4):
		return "Invalid rig ID, source revision or pixel scale."
	if not _valid_texture(texture) or not _array(files, 1, 96) or not _array(clips, 1, 16):
		return "Invalid texture settings or too many files or clips."
	var pattern := RegEx.create_from_string("^frames/[0-9]{5}[.]png$" if layout == "loose" else "^atlas/[0-9]{3}[.]png$")
	var pages := {}
	var pixels := 0
	for file: Variant in files:
		if not file is Dictionary or not _matches(file.get("file"), pattern) or pages.has(file.file) or not _matches(file.get("sha256"), _digest):
			return "Invalid or duplicate texture filename or checksum."
		if not _size(file, int(texture.maxSize)) or not _int(file.get("bytes"), 1, MAX_BYTES) or sizes.get(file.file, -1) != file.bytes:
			return "Invalid texture dimensions or missing data for %s." % file.file
		pixels += int(file.width) * int(file.height)
		pages[file.file] = file
	if pixels > MAX_PIXELS or manifest.get("textureBytes") != pixels * 4:
		return "The declared textures exceed the import pixel limit or have the wrong byte count."
	var ids := {}
	var num_frames := 0
	for clip: Variant in clips:
		if not _valid_clip(clip) or ids.has(clip.id.to_lower()):
			return "Invalid or duplicate clip."
		ids[clip.id.to_lower()] = true
		num_frames += clip.frames.size()
		if num_frames > 96:
			return "The bundle exceeds the 96-frame limit."
		var start_tick := 0
		var source_frame := int(clip.startFrame)
		for sample: Variant in clip.frames:
			if not _valid_sample(sample, pages, texture.rotate) or sample.id != "%s:%d" % [clip.id, source_frame] or sample.sourceFrame != source_frame or sample.startTick != start_tick:
				return "Invalid texture bounds, timing or metadata in clip %s, source frame %d." % [clip.name, source_frame]
			source_frame += 1
			start_tick += int(sample.durationTicks)
		if clip.endFrame != source_frame - 1 or clip.durationTicks != start_tick:
			return "The declared range or duration does not match clip %s." % clip.name
	return ""

func _valid_texture(texture: Dictionary) -> bool:
	return texture.get("filter") in ["nearest", "linear"] and texture.get("alpha") in ["straight", "premultiplied"] \
		and texture.get("colorSpace") in ["srgb", "linear"] and _int(texture.get("maxSize"), 16, 8192) \
		and _int(texture.get("padding"), 0, 16) and _int(texture.get("extrusion"), 0, 8) \
		and texture.get("trim") is bool and texture.get("rotate") is bool

func _valid_clip(clip: Variant) -> bool:
	return clip is Dictionary and _matches(clip.get("id"), _uuid) and _label(clip.get("name"), 120) \
		and (not clip.has("direction") or _label(clip.direction)) \
		and _int(clip.get("trackRevision"), 0, 9007199254740991) \
		and _int(clip.get("startFrame"), 0, 35999) and _int(clip.get("endFrame"), 0, 35999) \
		and _int(clip.get("ticksPerSecond"), 1, 120) and _int(clip.get("durationTicks"), 1, 960000) \
		and clip.get("loopMode") in ["once", "repeat", "ping-pong"] and _array(clip.get("frames"), 1, 96)

func _valid_sample(sample: Variant, pages: Dictionary, rotate: bool) -> bool:
	if not sample is Dictionary or not sample.get("file") is String or not pages.has(sample.file) or not sample.get("blank") is bool:
		return false
	var rect: Variant = sample.get("rect")
	var trim: Variant = sample.get("trimOffset")
	var source: Variant = sample.get("sourceSize")
	var page: Dictionary = pages[sample.file]
	if not _size(rect, 8192) or not _offset(rect) or not _offset(trim) or not _size(source, 8192):
		return false
	if rect.x + rect.width > page.width or rect.y + rect.height > page.height:
		return false
	if not _int(sample.get("rotation"), 0, 90) or (sample.rotation != 0 and sample.rotation != 90):
		return false
	var rotated: bool = sample.rotation == 90
	if rotated and not rotate:
		return false
	if trim.x + (rect.height if rotated else rect.width) > source.width or trim.y + (rect.width if rotated else rect.height) > source.height:
		return false
	return _int(sample.get("durationTicks"), 1, 10000) and _int(sample.get("sourceFrame"), 0, 35999) \
		and _int(sample.get("startTick"), 0, 960000) and _label(sample.get("id")) and _point(sample.get("pivot")) \
		and _point(sample.get("origin")) and _valid_metadata(sample)

func _valid_metadata(sample: Dictionary) -> bool:
	if not _array(sample.get("sockets"), 0, 32) or not _array(sample.get("collisions"), 0, 32) or not _array(sample.get("events"), 0, 32):
		return false
	for socket: Variant in sample.sockets:
		if not _point(socket) or not _label(socket.get("name")) or not _number(socket.get("angle"), -1000, 1000):
			return false
	for collision: Variant in sample.collisions:
		if not collision is Dictionary or not _label(collision.get("name")):
			return false
		match collision.get("kind"):
			"rect":
				if not _point(collision) or not _number(collision.get("width"), 0, 32768) or not _number(collision.get("height"), 0, 32768) or collision.width <= 0 or collision.height <= 0:
					return false
			"polygon":
				if not _array(collision.get("points"), 3, 64) or not collision.points.all(_point):
					return false
			_:
				return false
	for cue: Variant in sample.events:
		if not cue is Dictionary or not _label(cue.get("name")) or not _int(cue.get("tick"), 0, int(sample.durationTicks) - 1):
			return false
		if cue.has("data"):
			if not cue.data is Dictionary:
				return false
			for name: String in cue.data:
				var value: Variant = cue.data[name]
				if not _label(name, 40) or not (value == null or value is bool or _number(value, -INF, INF) or (value is String and value.length() <= 256)):
					return false
	return true

func _array(value: Variant, minimum: int, maximum: int) -> bool:
	return value is Array and value.size() >= minimum and value.size() <= maximum

func _label(value: Variant, maximum := 80) -> bool:
	return value is String and value.length() >= 1 and value.length() <= maximum

func _matches(value: Variant, pattern: RegEx) -> bool:
	if not value is String:
		return false
	var matched := pattern.search(value)
	return matched != null and matched.get_end() == value.length()

func _number(value: Variant, minimum: float, maximum: float) -> bool:
	return (value is float or value is int) and is_finite(float(value)) and value >= minimum and value <= maximum

func _int(value: Variant, minimum: int, maximum: int) -> bool:
	return _number(value, minimum, maximum) and floorf(value) == value

func _size(value: Variant, maximum: int) -> bool:
	return value is Dictionary and _int(value.get("width"), 1, maximum) and _int(value.get("height"), 1, maximum)

func _offset(value: Variant) -> bool:
	return value is Dictionary and _int(value.get("x"), 0, 8192) and _int(value.get("y"), 0, 8192)

func _point(value: Variant) -> bool:
	return value is Dictionary and _number(value.get("x"), -32768, 32768) and _number(value.get("y"), -32768, 32768)

func _sha(data: PackedByteArray) -> String:
	var hashing := HashingContext.new()
	hashing.start(HashingContext.HASH_SHA256)
	hashing.update(data)
	return hashing.finish().hex_encode()

func _be32(data: PackedByteArray, index: int) -> int:
	return (data[index] << 24) | (data[index + 1] << 16) | (data[index + 2] << 8) | data[index + 3]

func _valid_png(data: PackedByteArray, file: Dictionary) -> bool:
	return data.size() >= 33 and _be32(data, 0) == 0x89504e47 and _be32(data, 4) == 0x0d0a1a0a \
		and _be32(data, 8) == 13 and _be32(data, 12) == 0x49484452 \
		and _be32(data, 16) == int(file.width) and _be32(data, 20) == int(file.height) \
		and data[24] == 8 and data[25] == 6 and data[26] == 0 and data[27] == 0 and data[28] == 0

func _raw_png(data: PackedByteArray, file: Dictionary) -> PackedByteArray:
	if not _valid_png(data, file):
		return PackedByteArray()
	# Decode the channel bytes as stored. The manifest controls color conversion.
	var raw := data.slice(0, 33)
	var index := 33
	while index + 12 <= data.size():
		var length := _be32(data, index)
		var kind := _be32(data, index + 4)
		var end := index + 12 + length
		if end > data.size():
			break
		if kind == 0x49444154: # IDAT
			raw.append_array(data.slice(index, end))
		elif kind == 0x49454e44 and length == 0 and end == data.size(): # IEND
			raw.append_array(data.slice(index, end))
			return raw
		elif (data[index + 4] & 32) == 0:
			break # Reject other critical chunks in this RGBA8 profile.
		index = end
	return PackedByteArray()

func _build_textures(manifest: Dictionary, pages: Dictionary, root: String, resources: Dictionary) -> Dictionary:
	var settings: Dictionary = manifest.texture
	var srgb := PackedByteArray()
	for value in range(256):
		var linear := value / 255.0
		var converted := 12.92 * linear if linear <= 0.0031308 else 1.055 * pow(linear, 1.0 / 2.4) - 0.055
		srgb.append(roundi(255.0 * converted))
	var cropped := {}
	var textures := {}
	var pixels := 0
	for clip: Dictionary in manifest.clips:
		for sample: Dictionary in clip.frames:
			var r: Dictionary = sample.rect
			var rect := Rect2i(int(r.x), int(r.y), int(r.width), int(r.height))
			var cache_key := "%s/%s/%s/%s" % [sample.file, rect, sample.rotation, sample.blank]
			if not cropped.has(cache_key):
				pixels += rect.size.x * rect.size.y
				if pixels > MAX_PIXELS:
					return {}
				var page: Image = pages[sample.file]
				var image := page.get_region(rect) if not sample.blank else Image.create_empty(rect.size.x, rect.size.y, false, Image.FORMAT_RGBA8)
				if sample.rotation == 90:
					image.rotate_90(COUNTERCLOCKWISE)
				_normalize_pixels(image, settings, srgb)
				var path := root.path_join("textures/%dx%d-%s.res" % [image.get_width(), image.get_height(), _sha(image.get_data())])
				if not resources.has(path):
					var texture := ImageTexture.create_from_image(image)
					texture.take_over_path(path)
					resources[path] = texture
				cropped[cache_key] = resources[path]
			textures[sample.id] = cropped[cache_key]
	return textures

func _normalize_pixels(image: Image, settings: Dictionary, srgb: PackedByteArray) -> void:
	var premultiplied: bool = settings.alpha == "premultiplied"
	var linear: bool = settings.colorSpace == "linear"
	if not premultiplied and not linear:
		return
	var data := image.get_data()
	for index in range(0, data.size(), 4):
		var alpha := data[index + 3]
		for channel in range(index, index + 3):
			var value := data[channel]
			if premultiplied:
				value = mini(255, roundi(value * 255.0 / alpha)) if alpha > 0 else 0
			data[channel] = srgb[value] if linear else value
	image.set_data(image.get_width(), image.get_height(), false, Image.FORMAT_RGBA8, data)

func _existing_frames(path: String) -> SpriteFrames:
	if FileAccess.file_exists(path):
		return ResourceLoader.load(path, "SpriteFrames", ResourceLoader.CACHE_MODE_IGNORE) as SpriteFrames
	return null

func _clip_keys(clips: Array, root: String, historical_keys: Dictionary) -> Dictionary:
	var keys := {}
	var used := {}
	for key: String in historical_keys.values():
		used[key] = true
	for clip: Dictionary in clips:
		var existing := _existing_frames(root.path_join(clip.id).path_join("frames.res"))
		var single_key := ""
		if existing and existing.get_animation_names().size() == 1:
			single_key = existing.get_animation_names()[0]
		var key: String = historical_keys.get(clip.id, "")
		if key.is_empty():
			var label: String = clip.name.strip_edges()
			if clip.has("direction"):
				label += "_" + clip.direction.strip_edges()
			key = single_key if not single_key.is_empty() else label.validate_node_name()
			if key.is_empty():
				key = "Clip"
			if used.has(key):
				key += "_" + clip.id
			while used.has(key):
				key += "_"
		used[key] = true
		keys[clip.id] = {"aggregate": key, "single": key if single_key.is_empty() else single_key}
	return keys

func _frames_resource() -> SpriteFrames:
	var frames := SpriteFrames.new()
	frames.remove_animation(&"default")
	return frames

func _clip_metadata(clip: Dictionary) -> Dictionary:
	var samples: Array = clip.frames.duplicate(true)
	for sample: Dictionary in samples:
		# Preserve authored order when several cues have the same tick.
		var ordered := []
		for cue: Dictionary in sample.events:
			var index := ordered.size()
			while index > 0 and ordered[index - 1].tick > cue.tick:
				index -= 1
			ordered.insert(index, cue)
		sample.events = ordered
	if clip.loopMode == "ping-pong":
		for index in range(samples.size() - 2, 0, -1):
			samples.append(samples[index])
	return {"id": clip.id, "name": clip.name, "direction": clip.get("direction", ""),
		"loopMode": clip.loopMode, "ticksPerSecond": clip.ticksPerSecond, "frames": samples}

func _add_clip(frames: SpriteFrames, key: String, clip: Dictionary, textures: Dictionary) -> void:
	frames.add_animation(key)
	frames.set_animation_speed(key, float(clip.ticksPerSecond))
	frames.set_animation_loop(key, clip.loopMode != "once")
	for sample: Dictionary in clip.frames:
		frames.add_frame(key, textures[sample.id], float(sample.durationTicks))

func _add_outputs(resources: Dictionary, path: String, frames: SpriteFrames, key: String, manifest: Dictionary) -> bool:
	var frames_path := path.path_join("frames.res")
	frames.take_over_path(frames_path)
	var sprite := Runtime.new()
	sprite.name = "KinetixSprite"
	sprite.sprite_frames = frames
	sprite.animation = key
	sprite.autoplay = key
	sprite.centered = false
	sprite.scale = Vector2.ONE / float(manifest.source.pixelScale)
	sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST if manifest.texture.filter == "nearest" else CanvasItem.TEXTURE_FILTER_LINEAR
	sprite.set_meta("kinetix_source", manifest.source)
	var packed := PackedScene.new()
	var result := packed.pack(sprite)
	sprite.free()
	if result != OK:
		return false
	resources[frames_path] = frames
	resources[path.path_join("sprite.tscn")] = packed
	return true

func _publish(resources: Dictionary) -> String:
	var entries: Array[Dictionary] = []
	var stamp := "%d-%d" % [OS.get_process_id(), Time.get_ticks_usec()]
	for path: String in resources:
		var absolute := ProjectSettings.globalize_path(path)
		var stage := absolute.get_basename() + ".kinetix-" + stamp + "." + absolute.get_extension()
		entries.append({"target": absolute, "stage": stage, "backup": absolute + ".kinetix-backup-" + stamp,
			"backed_up": false, "published": false})
		if DirAccess.make_dir_recursive_absolute(absolute.get_base_dir()) != OK or ResourceSaver.save(resources[path], stage) != OK:
			_cleanup(entries)
			return "Could not stage %s." % path
	for entry in entries:
		if FileAccess.file_exists(entry.target):
			if DirAccess.rename_absolute(entry.target, entry.backup) != OK:
				return _rollback(entries, entry.target)
			entry.backed_up = true
		if DirAccess.rename_absolute(entry.stage, entry.target) != OK:
			return _rollback(entries, entry.target)
		entry.published = true
	for entry in entries:
		if entry.backed_up:
			DirAccess.remove_absolute(entry.backup)
	return ""

func _cleanup(entries: Array[Dictionary]) -> void:
	for entry in entries:
		if FileAccess.file_exists(entry.stage):
			DirAccess.remove_absolute(entry.stage)

func _rollback(entries: Array[Dictionary], failed: String) -> String:
	var unrecovered: Array[String] = []
	for index in range(entries.size() - 1, -1, -1):
		var entry := entries[index]
		if entry.published:
			DirAccess.remove_absolute(entry.target)
		if entry.backed_up and DirAccess.rename_absolute(entry.backup, entry.target) != OK:
			unrecovered.append(entry.backup)
	_cleanup(entries)
	if not unrecovered.is_empty():
		return "Could not publish %s. Restore the previous files from: %s" % [failed, ", ".join(unrecovered)]
	return "Could not publish %s. Previous assets were restored." % failed
