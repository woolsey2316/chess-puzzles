from django.db import models

class Puzzle(models.Model):
    puzzle_id = models.CharField(max_length=10, primary_key=True)
    fen = models.TextField()
    moves = models.TextField()  # Space-separated move list in UCI notation
    rating = models.IntegerField()
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
