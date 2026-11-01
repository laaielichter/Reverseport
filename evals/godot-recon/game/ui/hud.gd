extends CanvasLayer

@onready var label: Label = $Score

func _ready() -> void:
	Global.score_changed.connect(_on_score_changed)

func _on_score_changed(new_score: int) -> void:
	label.text = "Score: %d" % new_score
