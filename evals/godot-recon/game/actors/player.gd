class_name Player
extends CharacterBody3D

signal hit(damage: int)

@export var speed: float = 6.0
@export var jump_velocity := 4.5
@onready var anim: AnimationPlayer = $AnimationPlayer
@onready var muzzle := $Gun/Muzzle

const BULLET = preload("res://actors/bullet.tscn")

func _ready() -> void:
	add_to_group("players")
	hit.connect(_on_hit)

func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity += get_gravity() * delta
	var dir := Input.get_axis("move_left", "move_right")
	velocity.x = dir * speed
	if Input.is_action_just_pressed("fire"):
		shoot()
	move_and_slide()

func shoot() -> void:
	var b := BULLET.instantiate()
	get_tree().current_scene.add_child(b)
	b.global_transform = muzzle.global_transform
	anim.play("shoot")

func _on_hit(damage: int) -> void:
	Global.add_score(-damage)
	if damage > 50:
		await get_tree().create_timer(0.5).timeout
		queue_free()
