extends AnimatedSprite2D

signal kinetix_event(clip_id: String, frame_id: String, cue: String, data: Dictionary)

var _sample: Dictionary = {}
var _clip_id := ""
var _cursor := 0
var _animation_key := &""
var _frame_index := -1
var _generation := 0

func _ready() -> void:
	animation_changed.connect(_animation_updated)
	frame_changed.connect(_frame_updated)
	animation_looped.connect(_looped)
	animation_finished.connect(_finished)
	_select_frame()

func kinetix_clip_key(clip_id: String) -> StringName:
	var clips: Dictionary = _clips()
	for key in clips:
		if clips[key].id == clip_id:
			return StringName(key)
	return &""

func play_kinetix_clip(clip_id: String) -> bool:
	var key := kinetix_clip_key(clip_id)
	if key == &"":
		return false
	play(key)
	return true

func kinetix_frame_data() -> Dictionary:
	return _sample.duplicate(true)

func kinetix_socket_transform(socket_name: String) -> Transform2D:
	for socket in _sample.get("sockets", []):
		if socket.name == socket_name:
			return Transform2D(float(socket.angle), Vector2(float(socket.x), float(socket.y)) - _point(_sample.pivot))
	return Transform2D.IDENTITY

func _point(data: Dictionary) -> Vector2:
	return Vector2(float(data.x), float(data.y))

func _clips() -> Dictionary:
	return sprite_frames.get_meta("kinetix_clips", {}) if sprite_frames else {}

func _select_frame() -> void:
	_generation += 1
	_animation_key = animation
	_frame_index = frame
	_sample = {}
	_cursor = 0
	var clip: Dictionary = _clips().get(String(animation), {})
	_clip_id = clip.get("id", "")
	var samples: Array = clip.get("frames", [])
	if frame < samples.size():
		_sample = samples[frame]
		offset = _point(_sample.trimOffset) - _point(_sample.pivot)

func _animation_updated() -> void:
	if _animation_key != animation:
		_select_frame()

func _frame_updated() -> void:
	if _animation_key == animation and _frame_index == frame:
		return
	var generation := _generation
	if is_playing() and _animation_key == animation:
		_emit_through(1.0)
	if _generation == generation:
		_select_frame()

func _looped() -> void:
	# Godot does not change the frame index when a one-frame clip repeats.
	if sprite_frames and sprite_frames.get_frame_count(animation) == 1:
		var generation := _generation
		_emit_through(1.0)
		if _generation == generation:
			_select_frame()

func _finished() -> void:
	_emit_through(1.0)

func _process(_delta: float) -> void:
	if is_playing():
		_emit_through(frame_progress)

func _emit_through(progress: float) -> void:
	var cues: Array = _sample.get("events", [])
	var tick := float(_sample.get("durationTicks", 1)) * progress
	var generation := _generation
	while _generation == generation and _cursor < cues.size() and float(cues[_cursor].tick) <= tick:
		var cue: Dictionary = cues[_cursor]
		_cursor += 1
		kinetix_event.emit(_clip_id, _sample.id, cue.name, cue.get("data", {}).duplicate(true))
