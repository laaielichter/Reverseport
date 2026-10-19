extends Node

var score := 0

func add(points: int) -> void:
	score += points
	if score > 100:
		Game.score = 0
