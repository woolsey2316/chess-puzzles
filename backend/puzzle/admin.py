from django.contrib import admin
from .models import Puzzle


class PuzzleAdmin(admin.ModelAdmin):
    list_display = ('puzzle_id', 'fen', 'moves', 'rating', 'rating_deviation', 'popularity', 'nb_plays', 'themes', 'game_url', 'opening_tags')


admin.site.register(Puzzle, PuzzleAdmin)
