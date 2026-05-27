from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from .elo import calculate_new_elo
from .models import Puzzle, UserProfile


class EloCalculationTests(TestCase):
    def test_correct_solve_increases_elo(self):
        new_elo = calculate_new_elo(player_elo=1200, puzzle_elo=1200, solved=True)
        self.assertGreater(new_elo, 1200)

    def test_wrong_attempt_decreases_elo(self):
        new_elo = calculate_new_elo(player_elo=1200, puzzle_elo=1200, solved=False)
        self.assertLess(new_elo, 1200)

    def test_easy_puzzle_correct_gives_small_gain(self):
        # Puzzle rated 400 below player — expected score ~0.91, gain is small
        gain = calculate_new_elo(player_elo=1200, puzzle_elo=800, solved=True) - 1200
        full_gain = calculate_new_elo(player_elo=1200, puzzle_elo=1200, solved=True) - 1200
        self.assertLess(gain, full_gain)

    def test_hard_puzzle_wrong_gives_small_loss(self):
        # Puzzle rated 400 above player — expected score ~0.09, loss is small
        loss = 1200 - calculate_new_elo(player_elo=1200, puzzle_elo=1600, solved=False)
        full_loss = 1200 - calculate_new_elo(player_elo=1200, puzzle_elo=1200, solved=False)
        self.assertLess(loss, full_loss)


class SubmitEndpointTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username='testuser', password='pass')
        self.profile = UserProfile.objects.create(user=self.user, puzzle_elo=1200)
        self.token = Token.objects.create(user=self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token.key}')
        self.puzzle = Puzzle.objects.create(
            puzzle_id='TEST01',
            fen='rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
            moves='e7e5 d2d4',
            rating=1200,
            rating_deviation=80,
            popularity=90,
            nb_plays=1000,
            themes='opening',
            game_url='https://lichess.org/test',
        )

    def test_solved_true_increases_elo(self):
        res = self.client.post(f'/api/puzzles/{self.puzzle.puzzle_id}/submit/', {'solved': True}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertGreater(res.data['puzzle_elo'], 1200)
        self.profile.refresh_from_db()
        self.assertGreater(self.profile.puzzle_elo, 1200)

    def test_solved_false_decreases_elo(self):
        """Wrong attempt on first try must decrease Elo, not increase it."""
        res = self.client.post(f'/api/puzzles/{self.puzzle.puzzle_id}/submit/', {'solved': False}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertLess(res.data['puzzle_elo'], 1200)
        self.profile.refresh_from_db()
        self.assertLess(self.profile.puzzle_elo, 1200)

    def test_wrong_then_correct_loses_elo(self):
        """Simulates: wrong on first attempt (solved=False sent by frontend), not a gain."""
        res = self.client.post(f'/api/puzzles/{self.puzzle.puzzle_id}/submit/', {'solved': False}, format='json')
        self.assertEqual(res.status_code, 200)
        final_elo = res.data['puzzle_elo']
        self.assertLess(final_elo, 1200, "Elo must decrease when puzzle is failed, even if solved on retry")

    def test_unauthenticated_submit_rejected(self):
        self.client.credentials()
        res = self.client.post(f'/api/puzzles/{self.puzzle.puzzle_id}/submit/', {'solved': True}, format='json')
        self.assertEqual(res.status_code, 401)
