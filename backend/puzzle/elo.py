def calculate_new_elo(player_elo: int, puzzle_elo: int, solved: bool) -> int:
    K = 32
    expected = 1 / (1 + 10 ** ((puzzle_elo - player_elo) / 400))
    actual = 1 if solved else 0
    return round(player_elo + K * (actual - expected))
