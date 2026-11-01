class_name Enemy
extends Area3D

@export var damage := 10

func _ready() -> void:
	body_entered.connect(_on_body_entered)

func _on_body_entered(body: Node3D) -> void:
	if body is Player:
		body.hit.emit(damage)
		print("enemy hit player")
