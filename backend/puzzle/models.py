from django.contrib.auth.models import User
from django.db import models


class UserProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    puzzle_elo = models.IntegerField(default=1200)

    def __str__(self):
        return f"{self.user.username} (Elo: {self.puzzle_elo})"


class Puzzle(models.Model):
    puzzle_id = models.CharField(max_length=10, primary_key=True)
    fen = models.TextField()
    moves = models.TextField()  # Space-separated move list in UCI notation
    rating = models.IntegerField(db_index=True)
    rating_deviation = models.IntegerField()
    popularity = models.SmallIntegerField()
    nb_plays = models.IntegerField()
    themes = models.TextField()  # Space-separated theme tags
    game_url = models.URLField(max_length=200)
    opening_tags = models.TextField(blank=True, default="")  # Space-separated opening tags, may be empty

    class Meta:
        db_table = "puzzle"

    def __str__(self):
        return self.puzzle_id
