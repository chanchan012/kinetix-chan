extends SceneTree

func _initialize() -> void:
	call_deferred("_run")

func _pixels(texture: Texture2D) -> String:
	var hashing := HashingContext.new()
	hashing.start(HashingContext.HASH_SHA256)
	hashing.update(texture.get_image().get_data())
	return hashing.finish().hex_encode()

func _point(value: Dictionary) -> Vector2:
	return Vector2(float(value.x), float(value.y))

func _run() -> void:
	Engine.max_fps = 120
	var expected: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(OS.get_cmdline_user_args()[0]))
	var manifest: Dictionary = expected.manifest
	var bundle: Dictionary = expected.imported
	var wrapper := (load("res://character.tscn") as PackedScene).instantiate() as Node2D
	root.add_child(wrapper)
	var inherited: AnimatedSprite2D = wrapper.get_node("ImportedSprite")
	inherited.pause()
	assert(wrapper.position == Vector2(100,200) and inherited.speed_scale == 2.0, "Game-owned transforms or overrides changed.")
	assert(inherited.animation == &"Flicker" and inherited.sprite_frames.resource_path.ends_with("/" + manifest.clips[0].id + "/frames.res"))
	var sprite := (load(bundle.scene) as PackedScene).instantiate() as AnimatedSprite2D
	root.add_child(sprite)
	sprite.pause()
	assert(sprite.sprite_frames.resource_path == bundle.frames)
	assert(sprite.sprite_frames.get_animation_names().size() == manifest.clips.size())
	assert(sprite.texture_filter == CanvasItem.TEXTURE_FILTER_LINEAR and not sprite.centered)
	assert(sprite.scale.is_equal_approx(Vector2.ONE / manifest.source.pixelScale))
	for clip: Dictionary in manifest.clips:
		var key: StringName = sprite.kinetix_clip_key(clip.id)
		assert(key != &"")
		sprite.animation = key
		var frames := sprite.sprite_frames
		assert(frames.get_animation_speed(key) == clip.ticksPerSecond)
		assert(frames.get_animation_loop(key) == (clip.loopMode != "once"))
		var samples: Array = clip.frames.duplicate()
		if clip.loopMode == "ping-pong":
			for index in range(clip.frames.size() - 2, 0, -1):
				samples.append(clip.frames[index])
		assert(frames.get_frame_count(key) == samples.size())
		for index in range(samples.size()):
			var sample: Dictionary = samples[index]
			sprite.set_frame_and_progress(index, 0)
			var data: Dictionary = sprite.kinetix_frame_data()
			assert(data.id == sample.id and data.collisions == sample.collisions and data.origin == sample.origin)
			assert(frames.get_frame_duration(key,index) == sample.durationTicks)
			assert(sprite.offset.is_equal_approx(_point(sample.trimOffset) - _point(sample.pivot)))
			assert(_pixels(frames.get_frame_texture(key,index)) == expected.pixelHashes[sample.id],
				"Decoded %s pixels differ from the reference player for %s, rotation %s." % [manifest.layout, sample.id, sample.rotation])
			for socket: Dictionary in sample.sockets:
				var transform: Transform2D = sprite.kinetix_socket_transform(socket.name)
				assert(transform.origin.is_equal_approx(_point(socket) - _point(sample.pivot)))
				assert(is_equal_approx(transform.get_rotation(), socket.angle))
	var cues: Array[String] = []
	var playback := {"clip": manifest.clips[0].id}
	sprite.kinetix_event.connect(func(clip_id: String, frame_id: String, cue: String, data: Dictionary):
		assert(clip_id == playback.clip and frame_id.begins_with(clip_id + ":"))
		if cue == "ignite":
			assert(data.get("flammable") == true)
		cues.append(cue))
	assert(sprite.play_kinetix_clip(playback.clip))
	var started := Time.get_ticks_msec()
	while cues.size() < 8 and Time.get_ticks_msec() - started < 2_000:
		await process_frame
	sprite.pause()
	assert(cues.slice(0, 8) == ["start","ignite","spark","last","start","ignite","spark","last"], str(cues))
	# Changing frames while paused is scrubbing and must not dispatch cues.
	cues.clear()
	sprite.set_frame_and_progress(0, 0.95)
	await process_frame
	assert(cues.is_empty())
	playback.clip = manifest.clips[1].id
	assert(sprite.play_kinetix_clip(playback.clip))
	started = Time.get_ticks_msec()
	while cues.size() < 2 and Time.get_ticks_msec() - started < 2_000:
		await process_frame
	sprite.pause()
	assert(cues == ["left","left"], str(cues))
	cues.clear()
	playback.clip = manifest.clips[2].id
	assert(sprite.play_kinetix_clip(playback.clip))
	started = Time.get_ticks_msec()
	while sprite.is_playing() and Time.get_ticks_msec() - started < 2_000:
		await process_frame
	assert(not sprite.is_playing() and cues == ["land"], str(cues))
	cues.clear()
	playback.clip = manifest.clips[3].id
	assert(sprite.play_kinetix_clip(playback.clip))
	started = Time.get_ticks_msec()
	while cues.size() < 3 and Time.get_ticks_msec() - started < 2_000:
		await process_frame
	assert(cues == ["blink","blink","blink"], str(cues))
	print("KINETIX_BUNDLE_PLAYBACK " + manifest.layout)
	quit()
