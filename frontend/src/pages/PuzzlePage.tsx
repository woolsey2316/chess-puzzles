import { useEffect, useState, useCallback, useRef } from 'react'
import { Chessboard } from 'react-chessboard'
import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import { useAuth } from '../auth'

interface Puzzle {
  puzzle_id: string
  fen: string
  moves: string
  rating: number
  themes: string
  opening_tags: string
  game_url: string
}

type Status = 'loading' | 'playing' | 'wrong' | 'solved' | 'error'

function uciToMove(uci: string): { from: Square; to: Square; promotion?: string } {
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    promotion: uci.length === 5 ? uci[4] : undefined,
  }
}

function formatTheme(theme: string) {
  return theme.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())
}

interface MoveRow {
  num: number
  white: string | null
  black: string | null
  whiteIdx: number | null
  blackIdx: number | null
}

// Build display rows from a flat SAN history, knowing who played the first move.
function buildMoveRows(history: string[], firstMover: 'w' | 'b', startNum: number): MoveRow[] {
  const rows: MoveRow[] = []
  let i = 0
  let num = startNum

  if (firstMover === 'b') {
    rows.push({ num, white: null, black: history[i] ?? null, whiteIdx: null, blackIdx: i < history.length ? i : null })
    i++
    num++
  }
  while (i < history.length) {
    const wi = i, bi = i + 1
    rows.push({
      num,
      white: history[wi] ?? null,
      black: history[bi] ?? null,
      whiteIdx: wi < history.length ? wi : null,
      blackIdx: bi < history.length ? bi : null,
    })
    i += 2
    num++
  }
  return rows
}

export default function PuzzlePage() {
  const { user, logout, updateElo, authFetch } = useAuth()
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null)
  const [game, setGame] = useState<Chess>(new Chess())
  const [fenHistory, setFenHistory] = useState<string[]>([])
  const [replayIndex, setReplayIndex] = useState(0)
  const [moveHistory, setMoveHistory] = useState<string[]>([])
  const [firstMover, setFirstMover] = useState<'w' | 'b'>('w')
  const [startMoveNum, setStartMoveNum] = useState(1)
  const [solutionMoves, setSolutionMoves] = useState<string[]>([])
  const [moveIndex, setMoveIndex] = useState(0)
  const [status, setStatus] = useState<Status>('loading')
  const [playerColor, setPlayerColor] = useState<'white' | 'black'>('white')
  const moveListRef = useRef<HTMLDivElement>(null)
  const submittedRef = useRef(false)
  const findSolutionUsedRef = useRef(false)
  const wrongAttemptRef = useRef(false)
  const currentPuzzleIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (replayIndex === fenHistory.length - 1) {
      moveListRef.current?.scrollTo({ top: moveListRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [moveHistory, replayIndex, fenHistory.length])

  const loadPuzzle = useCallback(async () => {
    setStatus('loading')
    setMoveHistory([])
    setFenHistory([])
    setReplayIndex(0)
    submittedRef.current = false
    findSolutionUsedRef.current = false
    wrongAttemptRef.current = false
    currentPuzzleIdRef.current = null
    try {
      const res = await authFetch('http://localhost:8000/api/puzzles/random/')
      if (!res.ok) throw new Error()
      const data: Puzzle = await res.json()
      const moves = data.moves.trim().split(' ')

      // FEN fields: [pieces, activeColor, castling, ep, halfMove, fullMove]
      const fenParts = data.fen.split(' ')
      const opponentColor = fenParts[1] as 'w' | 'b'
      const fullMoveNum = parseInt(fenParts[5] ?? '1', 10)

      const chess = new Chess(data.fen)
      const firstMove = chess.move(uciToMove(moves[0]))
      const activeColor = chess.turn() === 'w' ? 'white' : 'black'
      const initialHistory = firstMove ? [firstMove.san] : []

      setPuzzle(data)
      setGame(chess)
      setSolutionMoves(moves)
      setMoveIndex(1)
      setPlayerColor(activeColor)
      setFirstMover(opponentColor)
      setStartMoveNum(fullMoveNum)
      setMoveHistory(initialHistory)
      setFenHistory([data.fen, chess.fen()])
      setReplayIndex(1)
      currentPuzzleIdRef.current = data.puzzle_id
      setStatus('playing')
    } catch {
      setStatus('error')
    }
  }, [authFetch])

  // Load the first puzzle on mount only; subsequent loads are triggered by the button.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadPuzzle() }, [])

  // Submit result once when puzzle is solved
  useEffect(() => {
    if (status !== 'solved') return
    if (submittedRef.current) return
    const puzzleId = currentPuzzleIdRef.current
    if (!puzzleId) return
    submittedRef.current = true
    const solved = !findSolutionUsedRef.current && !wrongAttemptRef.current
    authFetch(`http://localhost:8000/api/puzzles/${puzzleId}/submit/`, {
      method: 'POST',
      body: JSON.stringify({ solved }),
    })
      .then(res => res.json())
      .then(data => { if (data.puzzle_elo) updateElo(data.puzzle_elo) })
      .catch(() => {})
  }, [status, authFetch, updateElo])

  const playOpponentMove = useCallback(
    (currentGame: Chess, nextIndex: number, moves: string[], history: string[]) => {
      if (nextIndex >= moves.length) { setStatus('solved'); return }
      setTimeout(() => {
        const updated = new Chess(currentGame.fen())
        const result = updated.move(uciToMove(moves[nextIndex]))
        const newHistory = result ? [...history, result.san] : history
        setGame(updated)
        setMoveHistory(newHistory)
        setFenHistory(prev => [...prev, updated.fen()])
        setReplayIndex(prev => prev + 1)
        const after = nextIndex + 1
        setMoveIndex(after)
        if (after >= moves.length) setStatus('solved')
      }, 400)
    },
    [],
  )

  const applyMove = useCallback(
    (from: string, to: string, promotion?: string): boolean => {
      const updated = new Chess(game.fen())
      const result = updated.move({ from: from as Square, to: to as Square, promotion })
      if (!result) return false

      const playedUci = result.from + result.to + (result.promotion ?? '')
      if (playedUci !== solutionMoves[moveIndex]) {
        wrongAttemptRef.current = true
        setStatus('wrong')
        return false
      }

      const newHistory = [...moveHistory, result.san]
      setGame(updated)
      setMoveHistory(newHistory)
      setFenHistory(prev => [...prev, updated.fen()])
      setReplayIndex(prev => prev + 1)
      setStatus('playing')
      const next = moveIndex + 1
      setMoveIndex(next)
      playOpponentMove(updated, next, solutionMoves, newHistory)
      return true
    },
    [game, moveHistory, solutionMoves, moveIndex, playOpponentMove],
  )

  const onPieceDrop = useCallback(
    ({ sourceSquare, targetSquare, piece }: {
      sourceSquare: string
      targetSquare: string | null
      piece: { pieceType: string; isSparePiece: boolean; position: string }
    }) => {
      if ((status !== 'playing' && status !== 'wrong') || !targetSquare) return false
      const promotion =
        piece.pieceType?.[1]?.toLowerCase() === 'p' &&
        (targetSquare[1] === '8' || targetSquare[1] === '1') ? 'q' : undefined
      return applyMove(sourceSquare, targetSquare, promotion)
    },
    [status, applyMove],
  )

  const findSolution = useCallback(() => {
    if (status !== 'playing' && status !== 'wrong') return
    findSolutionUsedRef.current = true
    const move = uciToMove(solutionMoves[moveIndex])
    applyMove(move.from, move.to, move.promotion)
  }, [status, solutionMoves, moveIndex, applyMove])

  const stepBack = useCallback(() => setReplayIndex(i => Math.max(0, i - 1)), [])
  const stepForward = useCallback(() => setReplayIndex(i => Math.min(fenHistory.length - 1, i + 1)), [fenHistory.length])

  const activeMoveIdx = replayIndex - 1
  const moveRows = buildMoveRows(moveHistory, firstMover, startMoveNum)
  const isAtLive = replayIndex === fenHistory.length - 1
  const canInteract = (status === 'playing' || status === 'wrong') && isAtLive
  const displayFen = fenHistory[replayIndex] ?? game.fen()

  const statusConfig: Record<Status, { text: string; cls: string }> = {
    loading: { text: 'Loading…',          cls: 'bg-gray-100 dark:bg-gray-800 text-gray-500' },
    playing: { text: `${playerColor === 'white' ? '⬜' : '⬛'} ${playerColor.charAt(0).toUpperCase() + playerColor.slice(1)} to move`,
                                           cls: 'bg-violet-50 dark:bg-violet-950 text-violet-700 dark:text-violet-300' },
    wrong:   { text: '✗ Incorrect — try again',
                                           cls: 'bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400' },
    solved:  { text: '✓ Puzzle solved!',  cls: 'bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400' },
    error:   { text: 'Failed to load',    cls: 'bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400' },
  }
  const { text: statusText, cls: statusCls } = statusConfig[status]

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-950 text-gray-800 dark:text-gray-200 overflow-hidden">
      {/* Top bar */}
      <header className="shrink-0 border-b border-gray-200 dark:border-gray-800 px-6 py-3 flex items-center gap-3">
        <span className="text-2xl">♟</span>
        <h1 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white">Chess Puzzles</h1>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            <span className="font-medium text-gray-700 dark:text-gray-200">{user?.username}</span>
            {' · '}Elo <span className="font-bold text-violet-600 dark:text-violet-400">{user?.puzzle_elo}</span>
          </span>
          <button
            onClick={logout}
            className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors cursor-pointer"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">

        {/* ── Left panel: puzzle info ── */}
        <aside className="w-64 shrink-0 border-r border-gray-200 dark:border-gray-800 flex flex-col gap-5 p-5 overflow-y-auto">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">Status</p>
            <div className={`rounded-lg px-4 py-3 text-sm font-medium ${statusCls}`}>{statusText}</div>
          </div>

          {puzzle ? (
            <>
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">Puzzle Rating</p>
                <p className="text-3xl font-bold text-gray-900 dark:text-white">{puzzle.rating}</p>
              </div>

              {puzzle.themes && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">Themes</p>
                  <div className="flex flex-wrap gap-1.5">
                    {puzzle.themes.split(' ').map(t => (
                      <span key={t} className="text-xs bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-300 rounded-full px-2.5 py-0.5">
                        {formatTheme(t)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {puzzle.opening_tags && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">Opening</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{puzzle.opening_tags.split('_').join(' ')}</p>
                </div>
              )}

              <a href={puzzle.game_url} target="_blank" rel="noreferrer"
                className="text-xs text-violet-600 dark:text-violet-400 hover:underline mt-auto">
                View source game ↗
              </a>
            </>
          ) : (
            <p className="text-sm text-gray-400">—</p>
          )}
        </aside>

        {/* ── Center: board ── */}
        <main className="flex-1 flex items-center justify-center p-6 min-w-0">
          <div className="relative w-full max-w-[min(100%,calc(100vh-140px))] aspect-square">
            {status === 'loading' && (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-black/40 text-white text-lg">
                Loading…
              </div>
            )}
            <Chessboard
              options={{
                position: displayFen,
                boardOrientation: playerColor,
                allowDragging: canInteract,
                onPieceDrop,
                boardStyle: { borderRadius: '6px', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' },
              }}
            />
          </div>
        </main>

        {/* ── Right panel: moves + actions ── */}
        <aside className="w-64 shrink-0 border-l border-gray-200 dark:border-gray-800 flex flex-col p-5 gap-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 shrink-0">Moves</p>

          <div ref={moveListRef} className="flex-1 overflow-y-auto min-h-0 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
            {moveRows.length === 0 ? (
              <p className="text-sm text-gray-400 p-3 text-center">No moves yet</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {moveRows.map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? '' : 'bg-gray-50 dark:bg-gray-800/50'}>
                      <td className="px-3 py-1.5 text-gray-400 font-mono select-none w-8">{row.num}.</td>
                      <td className={`px-2 py-1.5 font-mono w-1/2 ${row.whiteIdx === activeMoveIdx ? 'text-violet-600 dark:text-violet-400 font-semibold' : 'text-gray-800 dark:text-gray-200'}`}>
                        {row.white ?? ''}
                      </td>
                      <td className={`px-2 py-1.5 font-mono w-1/2 ${row.blackIdx === activeMoveIdx ? 'text-violet-600 dark:text-violet-400 font-semibold' : 'text-gray-800 dark:text-gray-200'}`}>
                        {row.black ?? ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {status === 'solved' && (
            <div className="flex gap-2 shrink-0">
              <button
                onClick={stepBack}
                disabled={replayIndex === 0}
                className="flex-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-default text-gray-700 dark:text-gray-300 font-medium py-2 text-lg transition-colors cursor-pointer"
              >
                ←
              </button>
              <button
                onClick={stepForward}
                disabled={isAtLive}
                className="flex-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-default text-gray-700 dark:text-gray-300 font-medium py-2 text-lg transition-colors cursor-pointer"
              >
                →
              </button>
            </div>
          )}

          <div className="flex flex-col gap-2 shrink-0">
            {canInteract && (
              <button onClick={findSolution}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium py-2 px-4 text-sm transition-colors cursor-pointer">
                Find Solution
              </button>
            )}
            <button onClick={loadPuzzle}
              className="w-full rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-medium py-2 px-4 text-sm transition-colors cursor-pointer">
              Next Puzzle
            </button>
          </div>
        </aside>

      </div>
    </div>
  )
}
