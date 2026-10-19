extends CharacterBody2D
class_name Player

signal died(cause: String)

const SPEED := 200.0
const JUMP_VELOCITY = -400.0
@export var lives: int = 3
@export_range(0.0, 1.0) var friction := 0.5
@onready var sprite: Sprite2D = $Sprite2D
var names: Array[String] = ["a", "b"]
var stats := {"hp": 10, "pos": Vector2(1.5, -2)}
enum State { IDLE, RUN = 5, JUMP }

func _ready() -> void:
	died.connect(_on_died)
	var t := get_tree().create_timer(1.0)
	await t.timeout
	print("ready %s" % [name], PI, TAU, INF, -NAN)

func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity += get_gravity() * delta
	if Input.is_action_just_pressed("jump") and is_on_floor():
		velocity.y = JUMP_VELOCITY
	var dir := Input.get_axis("ui_left", "ui_right")
	velocity.x = dir * SPEED if dir else move_toward(velocity.x, 0, SPEED * friction)
	move_and_slide()
	match State.RUN:
		State.IDLE:
			pass
		_:
			lives -= 1

func _on_died(cause: String) -> void:
	for i in range(3):
		if i == 1: continue
		print(cause, i ** 2, 7 % 3, "x\n\"q\"")
	queue_free()

static func make(x: float = 1.0) -> Player:
	return Player.new()
