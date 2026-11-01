extends Node
## Autoload: score and game state.

signal score_changed(new_score: int)

var score := 0

func add_score(points: int) -> void:
	score += points
	score_changed.emit(score)  # notify the HUD
