from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from .serializers import PuzzleSerializer
from .models import Puzzle


class PuzzleView(viewsets.ModelViewSet):
    serializer_class = PuzzleSerializer
    queryset = Puzzle.objects.all()

    @action(detail=False, methods=['get'])
    def random(self, request):
        puzzle = Puzzle.objects.order_by('?').first()
        if puzzle is None:
            return Response({'detail': 'No puzzles in database.'}, status=status.HTTP_404_NOT_FOUND)
        serializer = self.get_serializer(puzzle)
        return Response(serializer.data)
