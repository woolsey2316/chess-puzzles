import csv
import io
import zstandard as zstd

from django.core.management.base import BaseCommand, CommandError

from puzzle.models import Puzzle

BATCH_SIZE = 5000


class Command(BaseCommand):
    help = "Import puzzles from a Lichess CSV or CSV.ZST file into the database."

    def add_arguments(self, parser):
        parser.add_argument("file", help="Path to lichess_db_puzzle.csv or .csv.zst")
        parser.add_argument(
            "--limit",
            type=int,
            default=None,
            help="Maximum number of puzzles to import (default: all)",
        )
        parser.add_argument(
            "--batch-size",
            type=int,
            default=BATCH_SIZE,
            help=f"Number of rows per bulk insert (default: {BATCH_SIZE})",
        )

    def handle(self, *args, **options):
        path: str = options["file"]
        limit: int | None = options["limit"]
        batch_size: int = options["batch_size"]

        try:
            stream = self._open_stream(path)
        except FileNotFoundError:
            raise CommandError(f"File not found: {path}")

        self.stdout.write(f"Importing puzzles from {path}…")

        reader = csv.DictReader(stream)
        batch: list[Puzzle] = []
        imported = skipped = total_read = 0

        for row in reader:
            if limit is not None and total_read >= limit:
                break
            total_read += 1

            puzzle = Puzzle(
                puzzle_id=row["PuzzleId"],
                fen=row["FEN"],
                moves=row["Moves"],
                rating=int(row["Rating"]),
                rating_deviation=int(row["RatingDeviation"]),
                popularity=int(row["Popularity"]),
                nb_plays=int(row["NbPlays"]),
                themes=row["Themes"],
                game_url=row["GameUrl"],
                opening_tags=row.get("OpeningTags", ""),
            )
            batch.append(puzzle)

            if len(batch) >= batch_size:
                created = self._flush(batch)
                imported += created
                skipped += len(batch) - created
                batch = []
                self.stdout.write(f"  {imported:,} imported, {skipped:,} skipped…", ending="\r")
                self.stdout.flush()

        if batch:
            created = self._flush(batch)
            imported += created
            skipped += len(batch) - created

        stream.close()

        self.stdout.write("")
        self.stdout.write(
            self.style.SUCCESS(f"Done — {imported:,} puzzles imported, {skipped:,} skipped (already existed).")
        )

    def _flush(self, batch: list[Puzzle]) -> int:
        result = Puzzle.objects.bulk_create(batch, ignore_conflicts=True)
        return len(result)

    def _open_stream(self, path: str) -> io.TextIOWrapper:
        if path.endswith(".zst"):
            raw = open(path, "rb")
            dctx = zstd.ZstdDecompressor()
            return io.TextIOWrapper(dctx.stream_reader(raw), encoding="utf-8")
        return open(path, encoding="utf-8", newline="")
