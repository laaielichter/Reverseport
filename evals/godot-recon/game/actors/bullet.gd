extends RigidBody3D

func _ready() -> void:
	apply_central_impulse(-global_transform.basis.z * 30.0)
	var t := create_tween()
	t.tween_property(self, "scale", Vector3.ZERO, 2.0)
	t.tween_callback(queue_free)
