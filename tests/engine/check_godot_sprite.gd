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
	var frames := sprite.sprite_frames
	if character.position != Vector2(100, 200) or sprite.offset != -pivot:
		_fail("The wrapper override or imported pivot did not survive.")
		return
	if frames.get_animation_names() != PackedStringArray([animation]) or sprite.autoplay != animation:
		_fail("The clip name or autoplay setting does not match the export.")
		return
	if frames.get_frame_count(animation) != 3 or frames.get_animation_speed(animation) != 12.0 or not frames.get_animation_loop(animation):
		_fail("The generated clip has incorrect timing.")
		return
	var atlas := frames.get_frame_texture(animation, 1) as AtlasTexture
	if atlas == null or not atlas.filter_clip or frames.get_frame_duration(animation, 1) != 1.0:
		_fail("The middle frame has incorrect atlas or duration metadata.")
		return
	var image := atlas.get_image()
	var expected_x := 28 if mode == "initial" else 36
	if image.get_pixel(expected_x, 15).a < 0.99 or image.get_pixel(6, 15).a != 0.0:
		_fail("The middle frame does not contain the expected sampled artwork.")
		return
	var played: Array[int] = []
	sprite.stop()
	sprite.frame_changed.connect(func() -> void: played.append(sprite.frame))
	sprite.play(animation)
	var timeout := create_timer(2.0)
	while played.size() < 3 and timeout.time_left > 0:
		await process_frame
	if played.size() < 3 or played.slice(0,3) != [1,2,0]:
		_fail("Godot playback did not advance and loop through the expected frames.")
		return
	print("KINETIX_PLAYBACK " + mode)
	quit()

func _fail(message: String) -> void:
	printerr(message)
	quit(1)
