import { useCallback, useEffect, useRef, useState } from 'react'
import { Chessboard } from 'react-chessboard'
import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import { Link, useSearchParams } from 'react-router-dom'
import type { Arrow } from 'react-chessboard'
import { useAuth } from '../auth'

interface Eval {
  type: 'cp' | 'mate'
  /** From the side-to-move's perspective */
  value: number
}

interface Analysis {
  depth: number
  eval: Eval
  pv: string[]
  bestMove: { from: Square; to: Square } | null
}

function parseInfoLine(line: string, fen: string): Analysis | null {
  if (!line.startsWith('info') || line.includes('lowerbound') || line.includes('upperbound')) return null

  const depthM = line.match(/\bdepth (\d+)/)
  const cpM = line.match(/\bscore cp (-?\d+)/)
  const mateM = line.match(/\bscore mate (-?\d+)/)
  const pvM = line.match(/ pv ((?:[a-h][1-8][a-h][1-8][qrbnQRBN]?\s*)+)/)

  if (!depthM || (!cpM && !mateM)) return null

  const depth = parseInt(depthM[1])
  const ev: Eval = mateM
    ? { type: 'mate', value: parseInt(mateM[1]) }
    : { type: 'cp', value: parseInt(cpM![1]) }

  const pvUci = pvM ? pvM[1].trim().split(/\s+/) : []
  const pv: string[] = []
  let bestMove: { from: Square; to: Square } | null = null

  try {
    const chess = new Chess(fen)
    for (const uci of pvUci) {
      const move = chess.move({
        from: uci.slice(0, 2) as Square,
        to: uci.slice(2, 4) as Square,
        promotion: uci.length === 5 ? uci[4] : undefined,
      })
      if (!move) break
      pv.push(move.san)
    }
    if (pvUci[0]) {
      bestMove = { from: pvUci[0].slice(0, 2) as Square, to: pvUci[0].slice(2, 4) as Square }
    }
  } catch { /* ignore */ }

  return { depth, eval: ev, pv, bestMove }
}

/** Convert engine score (side-to-move perspective) to white's perspective */
function toWhitePov(ev: Eval, turn: 'w' | 'b'): Eval {
  return { type: ev.type, value: turn === 'w' ? ev.value : -ev.value }
}

/** White advantage as 0–100 (50 = equal) */
function evalBarPercent(wEval: Eval): number {
  if (wEval.type === 'mate') return wEval.value > 0 ? 100 : 0
  return 50 + Math.max(-50, Math.min(50, wEval.value / 20))
}

function formatScore(wEval: Eval): string {
  if (wEval.type === 'mate') {
    return wEval.value > 0 ? `#${wEval.value}` : `#${-wEval.value}`
  }
  const v = wEval.value / 100
  return v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1)
}

export default function AnalysisPage() {
  const { user, logout } = useAuth()
  const [searchParams] = useSearchParams()
  const initialFen = searchParams.get('fen')
  const [game, setGame] = useState(() => {
    if (initialFen) { try { return new Chess(initialFen) } catch { /* fall through */ } }
    return new Chess()
  })
  const [fenInput, setFenInput] = useState('')
  const [fenError, setFenError] = useState('')
  const [orientation, setOrientation] = useState<'white' | 'black'>(() => {
    // FEN second field is the active color: 'w' or 'b'
    const activeColor = (initialFen ?? '').trim().split(/\s+/)[1]
    return activeColor === 'b' ? 'black' : 'white'
  })
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [engineReady, setEngineReady] = useState(false)
  const [showArrow, setShowArrow] = useState(true)

  const workerRef = useRef<Worker | null>(null)
  const isReadyRef = useRef(false)
  const isSearchingRef = useRef(false)
  const pendingFenRef = useRef<string | null>(null)
  const currentFenRef = useRef(game.fen())
  // 'quick' = low-depth pass running; 'deep' = go infinite running
  const searchPhaseRef = useRef<'quick' | 'deep'>('quick')
  // true while we're waiting for bestmove before starting the next search
  const ignoringInfoRef = useRef(false)

  const QUICK_DEPTH = 10

  const startSearch = useCallback((worker: Worker, fen: string) => {
    currentFenRef.current = fen
    searchPhaseRef.current = 'quick'
    ignoringInfoRef.current = false
    worker.postMessage(`position fen ${fen}`)
    worker.postMessage(`go depth ${QUICK_DEPTH}`)
    isSearchingRef.current = true
  }, [])

  const sendAnalysis = useCallback((fen: string) => {
    const worker = workerRef.current
    if (!worker || !isReadyRef.current) return
    setAnalysis(null)
    ignoringInfoRef.current = true
    if (isSearchingRef.current) {
      // Store the new position and stop — startSearch will be called when bestmove arrives
      pendingFenRef.current = fen
      worker.postMessage('stop')
    } else {
      startSearch(worker, fen)
    }
  }, [startSearch])

  // Init Stockfish worker
  useEffect(() => {
    const worker = new Worker('/stockfish-18-lite-single.js')
    workerRef.current = worker

    worker.onmessage = (e: MessageEvent<string>) => {
      const line = e.data
      if (line === 'uciok') {
        worker.postMessage('isready')
      } else if (line === 'readyok') {
        isReadyRef.current = true
        setEngineReady(true)
        startSearch(worker, currentFenRef.current)
      } else if (line.startsWith('bestmove')) {
        isSearchingRef.current = false
        const pending = pendingFenRef.current
        if (pending !== null) {
          // A new position arrived while we were searching — start quick search on it
          pendingFenRef.current = null
          startSearch(worker, pending)
        } else if (searchPhaseRef.current === 'quick') {
          // Quick pass done, escalate to full-depth analysis on the same position
          searchPhaseRef.current = 'deep'
          worker.postMessage(`position fen ${currentFenRef.current}`)
          worker.postMessage('go infinite')
          isSearchingRef.current = true
        }
      } else if (line.startsWith('info') && !ignoringInfoRef.current) {
        const parsed = parseInfoLine(line, currentFenRef.current)
        if (parsed) {
          setAnalysis(prev => (!prev || parsed.depth >= prev.depth) ? parsed : prev)
        }
      }
    }

    worker.postMessage('uci')
    return () => { worker.postMessage('quit'); worker.terminate() }
  }, [startSearch])

  // Re-analyze on position change
  useEffect(() => {
    sendAnalysis(game.fen())
    setFenInput(game.fen())
  }, [game, sendAnalysis])

  const onPieceDrop = useCallback(({ sourceSquare, targetSquare, piece }: {
    sourceSquare: string
    targetSquare: string | null
    piece: { pieceType: string }
  }) => {
    if (!targetSquare) return false
    const updated = new Chess(game.fen())
    const promotion =
      piece.pieceType?.[1]?.toLowerCase() === 'p' &&
        (targetSquare[1] === '8' || targetSquare[1] === '1') ? 'q' : undefined
    const move = updated.move({ from: sourceSquare as Square, to: targetSquare as Square, promotion })
    if (!move) return false
    setGame(updated)
    setFenError('')
    return true
  }, [game])

  const applyFen = useCallback(() => {
    const trimmed = fenInput.trim()
    if (!trimmed) return
    try {
      setGame(new Chess(trimmed))
      setFenError('')
    } catch {
      setFenError('Invalid FEN')
    }
  }, [fenInput])

  const turn = game.turn()
  const wEval = analysis ? toWhitePov(analysis.eval, turn) : null
  const whitePercent = wEval ? evalBarPercent(wEval) : 50
  const scoreText = wEval ? formatScore(wEval) : '0.0'
  const blackWinning = wEval && wEval.value < 0

  const arrows: Arrow[] = showArrow && analysis?.bestMove
    ? [{ startSquare: analysis.bestMove.from, endSquare: analysis.bestMove.to, color: 'rgba(0, 128, 0, 0.75)' }]
    : []

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-950 text-gray-800 dark:text-gray-200 overflow-hidden">
      <header className="shrink-0 border-b border-gray-200 dark:border-gray-800 px-6 py-3 flex items-center gap-3">
        <span className="text-2xl">♟</span>
        <h1 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white">Analysis</h1>
        <div className="ml-auto flex items-center gap-4">
          <Link to="/puzzle" className="text-sm text-violet-600 dark:text-violet-400 hover:underline">
            Puzzles
          </Link>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            <span className="font-medium text-gray-700 dark:text-gray-200">{user?.username}</span>
          </span>
          <button
            onClick={logout}
            className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors cursor-pointer"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0 p-6 gap-5">

        {/* ── Eval bar ── */}
        <div className="flex flex-col items-center gap-1 shrink-0 select-none w-4">
          <span className="text-xs font-mono text-gray-400 h-4">
            {blackWinning ? scoreText : ''}
          </span>
          <div className="flex-1 w-5 rounded-full overflow-hidden flex flex-col border border-gray-300 dark:border-gray-700">
            <div
              className="bg-gray-900 dark:bg-gray-950 transition-all duration-500"
              style={{ height: `${100 - whitePercent}%` }}
            />
            <div className="bg-white flex-1 transition-all duration-500" />
          </div>
          <span className="text-xs font-mono text-gray-400 h-4">
            {!blackWinning ? scoreText : ''}
          </span>
        </div>

        {/* ── Board ── */}
        <div className="aspect-square h-full min-h-0 shrink-0">
          <Chessboard
            options={{
              position: game.fen(),
              boardOrientation: orientation,
              onPieceDrop,
              arrows,
              boardStyle: { borderRadius: '6px', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' },
            }}
          />
        </div>

        {/* ── Analysis panel ── */}
        <div className="flex flex-col gap-4 flex-1 min-w-0 overflow-y-auto">

          {/* Score + depth */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 flex items-center gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-0.5">Evaluation</p>
              <p className="text-3xl font-bold font-mono text-gray-900 dark:text-white">
                {engineReady ? scoreText : <span className="text-gray-400 text-lg">Loading engine…</span>}
              </p>
            </div>
            {analysis && (
              <div className="ml-auto text-right">
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-0.5">Depth</p>
                <p className="text-xl font-mono text-gray-600 dark:text-gray-400">{analysis.depth}</p>
              </div>
            )}
          </div>

          {/* Best line */}
          {analysis && analysis.pv.length > 0 && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">Best Line</p>
              <p className="text-sm font-mono text-gray-700 dark:text-gray-300 leading-relaxed break-words">
                {analysis.pv.join(' ')}
              </p>
            </div>
          )}

          {/* FEN input */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Position (FEN)</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={fenInput}
                onChange={e => { setFenInput(e.target.value); setFenError('') }}
                onKeyDown={e => e.key === 'Enter' && applyFen()}
                placeholder="Paste FEN and press Enter…"
                className="flex-1 min-w-0 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-1.5 text-xs font-mono text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <button
                onClick={applyFen}
                className="shrink-0 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium px-3 py-1.5 transition-colors cursor-pointer"
              >
                Load
              </button>
            </div>
            {fenError && <p className="text-xs text-red-500">{fenError}</p>}
          </div>

          {/* Controls */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setOrientation(o => o === 'white' ? 'black' : 'white')}
              className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-medium px-4 py-2 transition-colors cursor-pointer"
            >
              Flip Board
            </button>
            <button
              onClick={() => { const u = new Chess(game.fen()); u.undo(); setGame(u) }}
              disabled={game.history().length === 0}
              className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-default text-gray-700 dark:text-gray-300 text-sm font-medium px-4 py-2 transition-colors cursor-pointer"
            >
              Undo
            </button>
            <button
              onClick={() => setGame(new Chess())}
              className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-medium px-4 py-2 transition-colors cursor-pointer"
            >
              Reset
            </button>
            <button
              onClick={() => setShowArrow(s => !s)}
              className={`rounded-lg border text-sm font-medium px-4 py-2 transition-colors cursor-pointer ${showArrow
                  ? 'bg-violet-600 hover:bg-violet-700 text-white border-violet-600'
                  : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                }`}
            >
              Best Move Arrow
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}
