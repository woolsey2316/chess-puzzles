from rest_framework import serializers
from .models import Puzzle 

class PuzzleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Puzzle 
        fields = ('puzzle_id', 'fen', 'moves', 'rating', 'rating_deviation', 'popularity', 'nb_plays', 'themes', 'game_url', 'opening_tags')

