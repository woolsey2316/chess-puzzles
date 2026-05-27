from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from .serializers import PuzzleSerializer
from .models import Puzzle, UserProfile
from .elo import calculate_new_elo

ELO_RANGE = 100


class PuzzleView(viewsets.ModelViewSet):
    serializer_class = PuzzleSerializer
    queryset = Puzzle.objects.all()

    @action(detail=False, methods=['get'])
    def random(self, request):
        profile, _ = UserProfile.objects.get_or_create(user=request.user)
        user_elo = profile.puzzle_elo
        puzzle = (
            Puzzle.objects
            .filter(rating__gte=user_elo - ELO_RANGE, rating__lte=user_elo + ELO_RANGE)
            .order_by('?')
            .first()
        )
        if puzzle is None:
            return Response({'detail': 'No puzzles found near your rating.'}, status=status.HTTP_404_NOT_FOUND)
        serializer = self.get_serializer(puzzle)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def submit(self, request, pk=None):
        try:
            puzzle = Puzzle.objects.get(pk=pk)
        except Puzzle.DoesNotExist:
            return Response({'detail': 'Puzzle not found.'}, status=status.HTTP_404_NOT_FOUND)
        solved = bool(request.data.get('solved', False))
        profile, _ = UserProfile.objects.get_or_create(user=request.user)
        new_elo = calculate_new_elo(profile.puzzle_elo, puzzle.rating, solved)
        profile.puzzle_elo = new_elo
        profile.save()
        return Response({'puzzle_elo': new_elo})

