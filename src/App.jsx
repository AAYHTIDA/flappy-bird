import { useEffect, useRef, useCallback } from 'react'

// ─── SWAP ASSET URLs HERE ────────────────────────────────────────────────────
const ASSETS = {
  birdImage: null,          // e.g. '/bird.png'
  backgroundImage: null,    // e.g. '/bg.png'
  pipeImage: null,          // e.g. '/pipe.png'
  // Leave null to use procedural Web Audio API sounds (no files needed)
  flapSound: null,          // e.g. '/flap.mp3'
  scoreSound: null,         // e.g. '/score.mp3'
  hitSound: null,           // e.g. '/hit.mp3'
}
// ─────────────────────────────────────────────────────────────────────────────

// ─── Web Audio API sound engine ───────────────────────────────────────────────
let audioCtx = null
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  // Resume if suspended (browser autoplay policy)
  if (audioCtx.state === 'suspended') audioCtx.resume()
  return audioCtx
}

function playFlap() {
  try {
    const ctx = getAudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(600, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.08)
    gain.gain.setValueAtTime(0.25, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.12)
  } catch (_) {}
}

function playScore() {
  try {
    const ctx = getAudioCtx()
    // Two quick ascending beeps
    ;[0, 0.1].forEach((offset, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(i === 0 ? 800 : 1100, ctx.currentTime + offset)
      gain.gain.setValueAtTime(0.3, ctx.currentTime + offset)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.1)
      osc.start(ctx.currentTime + offset)
      osc.stop(ctx.currentTime + offset + 0.1)
    })
  } catch (_) {}
}

function playHit() {
  try {
    const ctx = getAudioCtx()
    // Low thud + noise burst
    const bufferSize = ctx.sampleRate * 0.3
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize)
    const noise = ctx.createBufferSource()
    noise.buffer = buffer
    const noiseGain = ctx.createGain()
    noiseGain.gain.setValueAtTime(0.4, ctx.currentTime)
    noiseGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
    noise.connect(noiseGain)
    noiseGain.connect(ctx.destination)
    noise.start(ctx.currentTime)

    const osc = ctx.createOscillator()
    const oscGain = ctx.createGain()
    osc.connect(oscGain)
    oscGain.connect(ctx.destination)
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(220, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.3)
    oscGain.gain.setValueAtTime(0.35, ctx.currentTime)
    oscGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.3)
  } catch (_) {}
}
// ─────────────────────────────────────────────────────────────────────────────

// Game constants
const W = 400
const H = 600
const GRAVITY = 0.5
const JUMP_VELOCITY = -9
const PIPE_WIDTH = 60
const PIPE_GAP = 150
const PIPE_SPEED = 3
const PIPE_INTERVAL = 1600   // ms between new pipes
const GROUND_H = 60
const BIRD_X = 80
const BIRD_SIZE = 36

function playSound(type) {
  if (type === 'flap') return ASSETS.flapSound ? new Audio(ASSETS.flapSound).play().catch(() => {}) : playFlap()
  if (type === 'score') return ASSETS.scoreSound ? new Audio(ASSETS.scoreSound).play().catch(() => {}) : playScore()
  if (type === 'hit') return ASSETS.hitSound ? new Audio(ASSETS.hitSound).play().catch(() => {}) : playHit()
}

export default function App() {
  const canvasRef = useRef(null)
  const stateRef = useRef(null)   // mutable game state (no re-renders)
  const rafRef = useRef(null)
  const overlayRef = useRef(null)
  const scoreDisplayRef = useRef(null)
  const highScoreDisplayRef = useRef(null)
  const gameOverRef = useRef(null)
  const finalScoreRef = useRef(null)
  const finalHiRef = useRef(null)

  // Preload images
  const images = useRef({})
  useEffect(() => {
    const load = (key, src) => {
      if (!src) return
      const img = new Image()
      img.src = src
      images.current[key] = img
    }
    load('bird', ASSETS.birdImage)
    load('bg', ASSETS.backgroundImage)
    load('pipe', ASSETS.pipeImage)
  }, [])

  const initState = useCallback((hiScore = 0) => ({
    bird: { y: H / 2, vy: 0 },
    pipes: [],
    score: 0,
    hiScore,
    lastPipeTime: 0,
    running: false,
    dead: false,
    started: false,
  }), [])

  // ── Draw ──────────────────────────────────────────────────────────────────
  const draw = useCallback((ctx, s) => {
    const bg = images.current.bg
    if (bg && bg.complete) {
      ctx.drawImage(bg, 0, 0, W, H)
    } else {
      // placeholder sky gradient
      const grad = ctx.createLinearGradient(0, 0, 0, H)
      grad.addColorStop(0, '#70c5ce')
      grad.addColorStop(1, '#c9e8f0')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, W, H)
    }

    // Pipes
    s.pipes.forEach(p => {
      const pipeImg = images.current.pipe
      if (pipeImg && pipeImg.complete) {
        // top pipe (flipped)
        ctx.save()
        ctx.translate(p.x + PIPE_WIDTH / 2, p.topH / 2)
        ctx.scale(1, -1)
        ctx.drawImage(pipeImg, -PIPE_WIDTH / 2, -p.topH / 2, PIPE_WIDTH, p.topH)
        ctx.restore()
        // bottom pipe
        ctx.drawImage(pipeImg, p.x, p.topH + PIPE_GAP, PIPE_WIDTH, H - p.topH - PIPE_GAP - GROUND_H)
      } else {
        // placeholder pipes
        ctx.fillStyle = '#5aad3f'
        ctx.strokeStyle = '#3d7a2b'
        ctx.lineWidth = 2
        // top
        ctx.fillRect(p.x, 0, PIPE_WIDTH, p.topH)
        ctx.strokeRect(p.x, 0, PIPE_WIDTH, p.topH)
        // cap top
        ctx.fillRect(p.x - 4, p.topH - 20, PIPE_WIDTH + 8, 20)
        ctx.strokeRect(p.x - 4, p.topH - 20, PIPE_WIDTH + 8, 20)
        // bottom
        const botY = p.topH + PIPE_GAP
        const botH = H - botY - GROUND_H
        ctx.fillRect(p.x, botY, PIPE_WIDTH, botH)
        ctx.strokeRect(p.x, botY, PIPE_WIDTH, botH)
        // cap bottom
        ctx.fillRect(p.x - 4, botY, PIPE_WIDTH + 8, 20)
        ctx.strokeRect(p.x - 4, botY, PIPE_WIDTH + 8, 20)
      }
    })

    // Ground
    ctx.fillStyle = '#ded895'
    ctx.fillRect(0, H - GROUND_H, W, GROUND_H)
    ctx.fillStyle = '#5aad3f'
    ctx.fillRect(0, H - GROUND_H, W, 8)

    // Bird
    const birdImg = images.current.bird
    const bx = BIRD_X - BIRD_SIZE / 2
    const by = s.bird.y - BIRD_SIZE / 2
    const angle = Math.min(Math.max(s.bird.vy * 3, -30), 90) * (Math.PI / 180)

    ctx.save()
    ctx.translate(BIRD_X, s.bird.y)
    ctx.rotate(angle)
    if (birdImg && birdImg.complete) {
      ctx.drawImage(birdImg, -BIRD_SIZE / 2, -BIRD_SIZE / 2, BIRD_SIZE, BIRD_SIZE)
    } else {
      // placeholder bird
      ctx.fillStyle = '#f5c518'
      ctx.beginPath()
      ctx.ellipse(0, 0, BIRD_SIZE / 2, BIRD_SIZE / 2.5, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#e0a800'
      ctx.lineWidth = 1.5
      ctx.stroke()
      // eye
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.arc(8, -5, 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#222'
      ctx.beginPath()
      ctx.arc(10, -5, 3, 0, Math.PI * 2)
      ctx.fill()
      // beak
      ctx.fillStyle = '#f08030'
      ctx.beginPath()
      ctx.moveTo(16, 0)
      ctx.lineTo(24, -3)
      ctx.lineTo(24, 3)
      ctx.closePath()
      ctx.fill()
      // wing
      ctx.fillStyle = '#e0b800'
      ctx.beginPath()
      ctx.ellipse(-4, 4, 10, 6, -0.3, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }, [])

  // ── Game loop ─────────────────────────────────────────────────────────────
  const loop = useCallback((timestamp) => {
    const s = stateRef.current
    if (!s || !s.running) return

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    // Spawn pipes
    if (timestamp - s.lastPipeTime > PIPE_INTERVAL) {
      const minTop = 60
      const maxTop = H - GROUND_H - PIPE_GAP - 60
      const topH = Math.floor(Math.random() * (maxTop - minTop + 1)) + minTop
      s.pipes.push({ x: W, topH, scored: false })
      s.lastPipeTime = timestamp
    }

    // Move pipes & score
    s.pipes.forEach(p => {
      p.x -= PIPE_SPEED
      if (!p.scored && p.x + PIPE_WIDTH < BIRD_X) {
        p.scored = true
        s.score++
        s.hiScore = Math.max(s.hiScore, s.score)
        if (scoreDisplayRef.current) scoreDisplayRef.current.textContent = s.score
        if (highScoreDisplayRef.current) highScoreDisplayRef.current.textContent = s.hiScore
        playSound('score')
      }
    })
    s.pipes = s.pipes.filter(p => p.x + PIPE_WIDTH > 0)

    // Bird physics
    s.bird.vy += GRAVITY
    s.bird.y += s.bird.vy

    // Collision: ground / ceiling
    if (s.bird.y + BIRD_SIZE / 2 >= H - GROUND_H || s.bird.y - BIRD_SIZE / 2 <= 0) {
      die(s)
      draw(ctx, s)
      return
    }

    // Collision: pipes
    const bLeft = BIRD_X - BIRD_SIZE / 2 + 4
    const bRight = BIRD_X + BIRD_SIZE / 2 - 4
    const bTop = s.bird.y - BIRD_SIZE / 2 + 4
    const bBottom = s.bird.y + BIRD_SIZE / 2 - 4

    for (const p of s.pipes) {
      const inX = bRight > p.x + 4 && bLeft < p.x + PIPE_WIDTH - 4
      if (inX && (bTop < p.topH || bBottom > p.topH + PIPE_GAP)) {
        die(s)
        draw(ctx, s)
        return
      }
    }

    draw(ctx, s)
    rafRef.current = requestAnimationFrame(loop)
  }, [draw])

  function die(s) {
    s.running = false
    s.dead = true
    playSound('hit')
    localStorage.setItem('flappy_hi', s.hiScore)
    if (finalScoreRef.current) finalScoreRef.current.textContent = s.score
    if (finalHiRef.current) finalHiRef.current.textContent = s.hiScore
    if (gameOverRef.current) gameOverRef.current.classList.remove('hidden')
  }

  const jump = useCallback(() => {
    const s = stateRef.current
    if (!s || s.dead) return
    if (!s.started) {
      s.started = true
      s.running = true
      s.lastPipeTime = performance.now()
      if (overlayRef.current) overlayRef.current.classList.add('hidden')
      rafRef.current = requestAnimationFrame(loop)
    }
    s.bird.vy = JUMP_VELOCITY
    playSound('flap')
  }, [loop])

  const startGame = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    const hi = parseInt(localStorage.getItem('flappy_hi') || '0', 10)
    stateRef.current = initState(hi)
    if (scoreDisplayRef.current) scoreDisplayRef.current.textContent = '0'
    if (highScoreDisplayRef.current) highScoreDisplayRef.current.textContent = hi
    if (gameOverRef.current) gameOverRef.current.classList.add('hidden')
    if (overlayRef.current) overlayRef.current.classList.remove('hidden')

    // Draw initial frame
    const canvas = canvasRef.current
    if (canvas) draw(canvas.getContext('2d'), stateRef.current)
  }, [initState, draw])

  // Input handlers
  useEffect(() => {
    const onKey = (e) => { if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); jump() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [jump])

  // Init on mount
  useEffect(() => {
    startGame()
  }, [startGame])

  return (
    <div className="flex items-center justify-center w-screen h-screen bg-black">
      <div className="relative" style={{ width: W, height: H }}>
        {/* Score HUD */}
        <div className="absolute top-4 left-0 right-0 flex justify-between px-4 z-10 pointer-events-none select-none">
          <span ref={scoreDisplayRef} className="text-white text-3xl font-bold drop-shadow-lg">0</span>
          <span className="text-white text-lg font-semibold drop-shadow">
            Best: <span ref={highScoreDisplayRef}>0</span>
          </span>
        </div>

        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="block cursor-pointer"
          onClick={jump}
        />

        {/* Start overlay */}
        <div
          ref={overlayRef}
          className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 z-20"
        >
          <h1 className="text-white text-5xl font-extrabold mb-2 drop-shadow-lg tracking-wide">
            🐦 Flappy Bird
          </h1>
          <p className="text-white/80 text-lg mb-8">Press Space, ↑, or tap to flap</p>
          <button
            onClick={(e) => { e.stopPropagation(); jump() }}
            className="bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-bold text-xl px-10 py-3 rounded-full shadow-lg transition-colors"
          >
            Start
          </button>
        </div>

        {/* Game Over overlay */}
        <div
          ref={gameOverRef}
          className="hidden absolute inset-0 flex flex-col items-center justify-center bg-black/50 z-20"
        >
          <h2 className="text-red-400 text-5xl font-extrabold mb-4 drop-shadow-lg">Game Over</h2>
          <div className="bg-white/10 backdrop-blur rounded-2xl px-10 py-6 mb-6 text-center">
            <p className="text-white text-xl mb-1">Score: <span ref={finalScoreRef} className="font-bold text-yellow-300">0</span></p>
            <p className="text-white text-xl">Best: <span ref={finalHiRef} className="font-bold text-yellow-300">0</span></p>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); startGame() }}
            className="bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-bold text-xl px-10 py-3 rounded-full shadow-lg transition-colors"
          >
            Play Again
          </button>
        </div>
      </div>
    </div>
  )
}
