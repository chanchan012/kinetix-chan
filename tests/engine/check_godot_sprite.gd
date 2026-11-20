extends SceneTree

func _initialize() -> void:
	_check.call_deferred()

func _check() -> void:
	var mode := OS.get_cmdline_user_args()[0]
	var wrapper := load("res://character.tscn") as PackedScene
	if wrapper == null:
		_fail("The unchanged wrapper could not load.")
		return
	var character := wrapper.instantiate() as Node2D
	root.add_child(character)
	var sprite := character.get_node("ImportedSprite") as AnimatedSprite2D
	var animation := &"Lantern" if mode == "initial" else &"Lantern revised"
	var pivot := Vector2(12, 20) if mode == "initial" else Vector2(30, 32)
	var cel_scale := int(mode.trim_prefix("cels-")) if mode.begins_with("cels-") else 0
	if cel_scale > 0:
		animation = &"Flame"
		pivot = Vector2(12, 20) * cel_scale
	var frames := sprite.sprite_frames
	if character.position != Vector2(100, 200) or sprite.offset != -pivot:
		_fail("The wrapper override or imported pivot did not survive.")
		return
	if frames.get_animation_names() != PackedStringArray([animation]) or sprite.autoplay != animation:
		_fail("The clip name or autoplay setting does not match the export.")
		return
	var count := 16 if cel_scale > 0 else 3
	if frames.get_frame_count(animation) != count or frames.get_animation_speed(animation) != 12.0 or not frames.get_animation_loop(animation):
		_fail("The generated clip has incorrect timing.")
		return
	var atlas := frames.get_frame_texture(animation, 1) as AtlasTexture
	if atlas == null or not atlas.filter_clip or frames.get_frame_duration(animation, 1) != 1.0:
		_fail("The middle frame has incorrect atlas or duration metadata.")
		return
	if cel_scale > 0:
		if sprite.texture_filter != CanvasItem.TEXTURE_FILTER_NEAREST:
			_fail("The scaled cels lost nearest filtering.")
			return
		var poses := [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, -1, 4, 4, 5, 5]
		for frame in range(count):
			var image := frames.get_frame_texture(animation, frame).get_image()
			var left := (7 + maxi(0, poses[frame])) * cel_scale
			var top := 15 * cel_scale
			var color := Color("#ff9500") if poses[frame] >= 0 else Color(0, 0, 0, 0)
			if image.get_size() != Vector2i(64, 64) * cel_scale or not image.get_pixel(left, top).is_equal_approx(color) or not image.get_pixel(left + cel_scale - 1, top + cel_scale - 1).is_equal_approx(color) or image.get_pixel(left - 1, top).a != 0.0 or frames.get_frame_duration(animation, frame) != 1.0:
				_fail("A held, blank, or independent cel has incorrect scaled pixels.")
				return
	else:
		var image := atlas.get_image()
		var expected_x := 28 if mode == "initial" else 36
		if image.get_pixel(expected_x, 15).a < 0.99 or image.get_pixel(6, 15).a != 0.0:
			_fail("The middle frame does not contain the expected sampled artwork.")
			return
	var played: Array[int] = []
	sprite.stop()
	sprite.frame_changed.connect(func() -> void: played.append(sprite.frame))
	sprite.play(animation)
	var timeout := create_timer(3.0)
	while played.size() < count and timeout.time_left > 0:
		await process_frame
	var expected: Array[int] = []
	for frame in range(1, count):
		expected.append(frame)
	expected.append(0)
	if played.size() < count or played.slice(0,count) != expected:
		_fail("Godot playback did not advance and loop through the expected frames.")
		return
	print("KINETIX_PLAYBACK " + mode)
	quit()

func _fail(message: String) -> void:
	printerr(message)
	quit(1)
