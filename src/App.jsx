import { useEffect, useRef, useState } from 'react'
import {
  R, RAIL,
  SHOT_MAX_SPEED, FIXED_DT,
  createGame, cueBall, objectBalls, targetBall, canPlaceCue, placeCue, advance, allStopped, resolveShot, aimFromDrag, readingOf, playerLabel,
} from './billiards.js'

const APP_VERSION = __APP_VERSION__
const APP_NAME = 'ナインボール'
const THEME_COLOR = '#1565c0'
const FELT_GREEN = '#1f7a44'
const RAIL_WOOD = '#6d4726'

const DEFAULT_OPTIONS = { mode: 'number', caseMode: 'upper', shape: 'rect', pocketSize: 'm', ballCount: 9, autoScroll: false, players: 1 }

// 2人モードのプレイヤーカラー（バッジ・手番表示）
const PLAYER_COLORS = ['#1565c0', '#f4511e']

// 横スクロール用の左右余白（ワールド単位）。端からのショットでキューを引く余地を作る。
const MARGIN = 175
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// ===== スプラッシュスクリーン（CLAUDE.md §7） =====
const SPLASH_SUBTITLE = 'びりやーどで あそぼう'
const GLOBAL_CSS = `
@keyframes splashPop {
  0% { transform: scale(0); opacity: 0; }
  70% { transform: scale(1.18); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
`

function SplashScreen({ onDone }) {
  const [fading, setFading] = useState(false)
  useEffect(() => {
    const t1 = setTimeout(() => setFading(true), 1400)
    const t2 = setTimeout(() => onDone(), 1900)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [onDone])

  const pop = (delay) => ({ animation: `splashPop 0.5s ${delay}s both` })

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999, pointerEvents: 'none',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 14, background: '#FFF8E7',
        backgroundImage: `radial-gradient(circle at 50% 38%, ${THEME_COLOR}33 0%, transparent 60%)`,
        opacity: fading ? 0 : 1, transition: 'opacity 0.5s ease',
      }}
    >
      <img
        src="/pwa-192x192.png"
        alt=""
        style={{ width: 120, height: 120, borderRadius: 28, filter: 'drop-shadow(0 6px 16px rgba(0,0,0,0.2))', ...pop(0) }}
      />
      <div style={{ fontSize: 28, fontWeight: 900, color: '#1a1a2e', ...pop(0.15) }}>{APP_NAME}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color: '#666', ...pop(0.25) }}>{SPLASH_SUBTITLE}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#bbb', ...pop(0.35) }}>v{APP_VERSION}</div>
    </div>
  )
}

// ===== 小物 =====
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function lerpColor(a, b, t) {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)]
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)]
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

// ===== Canvas 描画 =====
function drawBall(ctx, x, y, ball) {
  const { color, stripe, label, isCue } = ball
  // 影
  ctx.beginPath()
  ctx.ellipse(x, y + R * 0.55, R * 0.95, R * 0.55, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  ctx.fill()
  // ベース
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, R, 0, Math.PI * 2)
  ctx.clip()
  if (stripe) {
    ctx.fillStyle = '#fdfcf8'
    ctx.fillRect(x - R, y - R, 2 * R, 2 * R)
    ctx.fillStyle = color
    ctx.fillRect(x - R, y - R * 0.58, 2 * R, R * 1.16)
  } else {
    ctx.fillStyle = color
    ctx.fillRect(x - R, y - R, 2 * R, 2 * R)
  }
  // 光沢
  const g = ctx.createRadialGradient(x - R * 0.35, y - R * 0.4, R * 0.1, x, y, R)
  g.addColorStop(0, 'rgba(255,255,255,0.6)')
  g.addColorStop(0.4, 'rgba(255,255,255,0.12)')
  g.addColorStop(1, 'rgba(0,0,0,0.24)')
  ctx.fillStyle = g
  ctx.fillRect(x - R, y - R, 2 * R, 2 * R)
  ctx.restore()
  // ラベル（手球は無し）
  if (!isCue && label != null) {
    ctx.beginPath()
    ctx.arc(x, y, R * 0.54, 0, Math.PI * 2)
    ctx.fillStyle = '#fdfcf8'
    ctx.fill()
    ctx.fillStyle = '#1a1a2e'
    const fsize = label.length >= 3 ? R * 0.42 : label.length === 2 ? R * 0.56 : R * 0.7
    ctx.font = `800 ${fsize}px 'Nunito', sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, x, y + R * 0.06)
  }
  // 輪郭
  ctx.beginPath()
  ctx.arc(x, y, R, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'
  ctx.lineWidth = 1
  ctx.stroke()
}

function drawAim(ctx, cue, aim, table) {
  const cx = cue.x + RAIL
  const cy = cue.y + RAIL
  const { dirx, diry, power } = aim
  // 予測ライン
  const L = 30 + power * 240
  ctx.save()
  ctx.setLineDash([8, 9])
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(cx + dirx * (R + 2), cy + diry * (R + 2))
  ctx.lineTo(cx + dirx * (R + L), cy + diry * (R + L))
  ctx.stroke()
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.arc(cx + dirx * (R + L), cy + diry * (R + L), 5, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
  // キュー（うしろに引く）
  const back = R + 8 + power * 36
  ctx.lineCap = 'round'
  ctx.strokeStyle = '#d8b35a'
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.moveTo(cx - dirx * back, cy - diry * back)
  ctx.lineTo(cx - dirx * (back + 150), cy - diry * (back + 150))
  ctx.stroke()
  ctx.strokeStyle = '#7a4a22'
  ctx.beginPath()
  ctx.moveTo(cx - dirx * (back + 120), cy - diry * (back + 120))
  ctx.lineTo(cx - dirx * (back + 150), cy - diry * (back + 150))
  ctx.stroke()
  // パワーメーター（盤面下部）
  const barW = table.cw * 0.5
  const bx = (table.cw - barW) / 2
  const by = table.ch - RAIL * 0.62
  roundRect(ctx, bx, by, barW, 8, 4)
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  ctx.fill()
  if (power > 0) {
    roundRect(ctx, bx, by, barW * power, 8, 4)
    ctx.fillStyle = lerpColor('#4caf50', '#f44336', power)
    ctx.fill()
  }
}

// テーブル描画（形状ごと）
function buildFeltPath(ctx, table) {
  const { feltKind: k, feltParams: p } = table
  if (k === 'circle') {
    ctx.beginPath()
    ctx.arc(p.cx + RAIL, p.cy + RAIL, p.r, 0, Math.PI * 2)
  } else if (k === 'poly') {
    ctx.beginPath()
    p.verts.forEach((v, i) =>
      i ? ctx.lineTo(v.x + RAIL, v.y + RAIL) : ctx.moveTo(v.x + RAIL, v.y + RAIL),
    )
    ctx.closePath()
  } else {
    roundRect(ctx, RAIL, RAIL, p.W, p.H, 10)
  }
}

function drawTable(ctx, table) {
  // 木枠
  roundRect(ctx, 0, 0, table.cw, table.ch, RAIL * 0.7)
  ctx.fillStyle = RAIL_WOOD
  ctx.fill()
  roundRect(ctx, 4, 4, table.cw - 8, table.ch - 8, RAIL * 0.5)
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'
  ctx.lineWidth = 2
  ctx.stroke()
  // フェルト
  buildFeltPath(ctx, table)
  ctx.fillStyle = FELT_GREEN
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.18)'
  ctx.lineWidth = 3
  ctx.stroke()
  // ポケット
  for (const pk of table.pockets) {
    ctx.beginPath()
    ctx.arc(pk.x + RAIL, pk.y + RAIL, table.pocketR * 1.06, 0, Math.PI * 2)
    ctx.fillStyle = '#14141a'
    ctx.fill()
  }
}

// 手球プレースのゴースト
function drawGhost(ctx, x, y, ok) {
  ctx.save()
  ctx.globalAlpha = 0.6
  ctx.beginPath()
  ctx.arc(x + RAIL, y + RAIL, R, 0, Math.PI * 2)
  ctx.fillStyle = ok ? '#fdfcf8' : '#f44336'
  ctx.fill()
  ctx.strokeStyle = ok ? '#1565c0' : '#b71c1c'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.restore()
}

// ===== ボールチップ（UI内のターゲット表示）=====
function BallChip({ label, color = '#ccc', stripe = false, size = 28 }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: stripe ? `linear-gradient(#fff 30%, ${color} 30%, ${color} 70%, #fff 70%)` : color,
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        verticalAlign: 'middle',
      }}
    >
      <span
        style={{
          width: size * 0.56,
          height: size * 0.56,
          borderRadius: '50%',
          background: '#fdfcf8',
          color: '#1a1a2e',
          fontSize: size * 0.4,
          fontWeight: 800,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {label}
      </span>
    </span>
  )
}

// ===== ボールトレイ（余白に残り球を順番に並べ、落とした球は誰が落としたかを表示）=====
function BallTray({ balls, players }) {
  return (
    <div style={styles.tray}>
      {balls.map((b) => (
        <span key={b.order} style={{ position: 'relative', display: 'inline-flex' }}>
          <span style={b.active ? undefined : { filter: 'grayscale(0.75)', opacity: 0.4, display: 'inline-flex' }}>
            <BallChip label={b.label} color={b.color} stripe={b.stripe} size={26} />
          </span>
          {!b.active && (
            <span
              style={{
                ...styles.trayBadge,
                background: players === 2 && b.pocketedBy != null ? PLAYER_COLORS[b.pocketedBy] : '#4caf50',
              }}
            >
              {players === 2 && b.pocketedBy != null ? b.pocketedBy + 1 : '✓'}
            </span>
          )}
        </span>
      ))}
    </div>
  )
}

// ===== 手番＆スコアバー（2人モードのみ）=====
function PlayerBar({ balls, current, phase, winner }) {
  const counts = [0, 0]
  for (const b of balls) {
    if (!b.active && b.pocketedBy != null) counts[b.pocketedBy] += 1
  }
  return (
    <div style={styles.playerBar}>
      {[0, 1].map((i) => {
        const isTurn = phase === 'won' ? winner === i : current === i
        return (
          <div
            key={i}
            style={{
              ...styles.playerCard,
              border: `3px solid ${isTurn ? PLAYER_COLORS[i] : 'transparent'}`,
              background: isTurn ? '#fff' : 'rgba(255,255,255,0.5)',
              color: isTurn ? '#1a1a2e' : '#999',
            }}
          >
            {phase !== 'won' && isTurn && <span style={{ color: PLAYER_COLORS[i], fontSize: 11 }}>▶</span>}
            {phase === 'won' && winner === i && <span>🏆</span>}
            <span style={{ ...styles.playerDot, background: PLAYER_COLORS[i] }}>{i + 1}</span>
            <span>{playerLabel(i)}</span>
            <span style={{ fontWeight: 800 }}>{counts[i]}こ</span>
          </div>
        )
      })}
    </div>
  )
}

const styles = {
  container: {
    minHeight: '100dvh',
    backgroundColor: '#FFF8E7',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: "'Nunito', sans-serif",
    maxWidth: 480,
    margin: '0 auto',
  },
  header: {
    background: 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px 4px',
  },
  headerTitle: { fontSize: 22, fontWeight: 800, color: '#1a1a2e', flex: 1 },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: '50%',
    background: 'white',
    border: 'none',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    fontSize: 20,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 16px',
    gap: 8,
  },
  targetBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    color: '#1a1a2e',
  },
  targetLabelText: { fontSize: 15, fontWeight: 800, color: '#666' },
  targetReading: { fontSize: 26, fontWeight: 800, color: THEME_COLOR },
  counter: { fontSize: 14, fontWeight: 700, color: '#666' },
  message: {
    minHeight: 24,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: 800,
    color: THEME_COLOR,
    padding: '0 16px',
  },
  tray: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 5,
    padding: '2px 12px 4px',
    flexWrap: 'wrap',
  },
  trayBadge: {
    position: 'absolute',
    right: -4,
    bottom: -3,
    width: 14,
    height: 14,
    borderRadius: '50%',
    color: '#fff',
    fontSize: 9,
    fontWeight: 800,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 1px 2px rgba(0,0,0,0.35)',
  },
  playerBar: {
    display: 'flex',
    justifyContent: 'center',
    gap: 8,
    padding: '2px 16px 4px',
  },
  playerCard: {
    flex: '1 1 0',
    maxWidth: 180,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    padding: '5px 6px',
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: 'nowrap',
    boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
  },
  playerDot: {
    width: 18,
    height: 18,
    borderRadius: '50%',
    color: '#fff',
    fontSize: 11,
    fontWeight: 800,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  canvasWrap: { padding: '4px 12px 8px', display: 'flex', justifyContent: 'center' },
  panBar: { display: 'flex', gap: 8, padding: '0 16px', justifyContent: 'center' },
  panBtn: {
    flex: '1 1 0',
    maxWidth: 130,
    padding: '8px 6px',
    borderRadius: 12,
    border: 'none',
    background: '#fff',
    color: THEME_COLOR,
    fontSize: 14,
    fontWeight: 800,
    fontFamily: "'Nunito', sans-serif",
    cursor: 'pointer',
    boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
    minHeight: 40,
  },
  sliderWrap: { padding: '8px 20px 12px' },
  slider: { width: '100%', accentColor: THEME_COLOR, cursor: 'pointer' },
  canvas: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 16,
    boxShadow: '0 6px 18px rgba(0,0,0,0.22)',
    touchAction: 'none',
    display: 'block',
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    padding: 24,
  },
  modal: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
  },
  modalTitle: { fontSize: 20, fontWeight: 800, marginBottom: 16, color: '#1a1a2e' },
  modalText: { fontSize: 15, color: '#555', lineHeight: 1.7, marginBottom: 8 },
  closeBtn: {
    marginTop: 20,
    width: '100%',
    padding: 12,
    backgroundColor: THEME_COLOR,
    color: '#fff',
    border: 'none',
    borderRadius: 12,
    fontSize: 16,
    fontWeight: 700,
    fontFamily: "'Nunito', sans-serif",
    cursor: 'pointer',
    minHeight: 44,
  },
  versionText: { fontSize: 13, color: '#aaa', marginTop: 16, textAlign: 'right' },
  bigBtn: {
    width: '100%',
    padding: 16,
    borderRadius: 16,
    border: 'none',
    background: THEME_COLOR,
    color: 'white',
    fontSize: 20,
    fontWeight: 800,
    fontFamily: "'Nunito', sans-serif",
    cursor: 'pointer',
    boxShadow: '0 4px 0 rgba(0,0,0,0.15)',
    minHeight: 64,
  },
  winCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 28,
    width: '100%',
    maxWidth: 360,
    boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
    textAlign: 'center',
  },
}

function GuideModal({ onClose }) {
  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalTitle}>あそびかた</div>
        <p style={styles.modalText}>🎱 ちいさい じゅんばんに ボールを ポケットに いれて、さいごの ボールを いれたら クリア！</p>
        <p style={styles.modalText}>① しろたまを おくところを <b>タップ</b></p>
        <p style={styles.modalText}>② がめんを <b>ドラッグ</b>して むき と つよさを きめる（うしろに ひくほど つよい）</p>
        <p style={styles.modalText}>③ ゆびを <b>はなす</b>と ショット！</p>
        <p style={styles.modalText}>つぎに ねらう ボールは うえに でるよ。のこりの ボールは じゅんばんに ならんでいて、おとした ボールは うすくなって だれが おとしたか マークが つくよ。</p>
        <p style={styles.modalText}>⚙️で <b>ふたりで こうたい</b>を えらぶと 2人で あそべるよ。いれたら つづけて、はずしたら こうたい！</p>
        <p style={styles.modalText}>はしを ねらうときは、したの スライダーや ボタンで フィールドを よこに うごかせるよ。⚙️で「じどう よこスクロール」を オンにもできるよ。</p>
        <p style={styles.modalText}>⚙️から <b>すうじ / えいご / かんすうじ / ローマ / ギリシャ</b>、テーブルの <b>かたち</b>、<b>あなの おおきさ</b>、<b>ボールの かず</b>を えらべるよ。</p>
        <button style={styles.closeBtn} onClick={onClose}>とじる</button>
      </div>
    </div>
  )
}

function Pill({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: '1 1 0',
        minWidth: 80,
        padding: '10px 6px',
        borderRadius: 12,
        border: active ? `3px solid ${THEME_COLOR}` : '3px solid #e0e0e0',
        background: active ? THEME_COLOR : '#fff',
        color: active ? '#fff' : '#666',
        fontSize: 14,
        fontWeight: 800,
        fontFamily: "'Nunito', sans-serif",
        cursor: 'pointer',
        minHeight: 48,
      }}
    >
      {children}
    </button>
  )
}

const SECTION = { fontSize: 14, fontWeight: 800, color: '#666', marginBottom: 8 }
const ROW = { display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }

function SettingsModal({ options, onApply, onReset, onClose }) {
  const [mode, setMode] = useState(options.mode)
  const [caseMode, setCaseMode] = useState(options.caseMode)
  const [shape, setShape] = useState(options.shape)
  const [pocketSize, setPocketSize] = useState(options.pocketSize)
  const [ballCount, setBallCount] = useState(options.ballCount)
  const [autoScroll, setAutoScroll] = useState(options.autoScroll)
  const [players, setPlayers] = useState(options.players || 1)
  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={{ ...styles.modal, maxHeight: '86vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalTitle}>せってい</div>

        <div style={SECTION}>あそぶ にんずう</div>
        <div style={ROW}>
          <Pill active={players === 1} onClick={() => setPlayers(1)}>ひとりで</Pill>
          <Pill active={players === 2} onClick={() => setPlayers(2)}>ふたりで こうたい</Pill>
        </div>
        {players === 2 && (
          <p style={{ ...styles.modalText, fontSize: 13, color: '#888' }}>
            ※ ポケットに いれたら つづけて うてるよ。はずしたり ファウルしたら こうたい！
          </p>
        )}

        <div style={SECTION}>ボールの かず</div>
        <div style={ROW}>
          <Pill active={ballCount === 3} onClick={() => setBallCount(3)}>3こ</Pill>
          <Pill active={ballCount === 5} onClick={() => setBallCount(5)}>5こ</Pill>
          <Pill active={ballCount === 9} onClick={() => setBallCount(9)}>9こ</Pill>
        </div>

        <div style={SECTION}>ボールの モード</div>
        <div style={ROW}>
          <Pill active={mode === 'number'} onClick={() => setMode('number')}>すうじ 1-9</Pill>
          <Pill active={mode === 'english'} onClick={() => setMode('english')}>えいご ABC</Pill>
          <Pill active={mode === 'kanji'} onClick={() => setMode('kanji')}>かんすうじ 一二三</Pill>
          <Pill active={mode === 'kanji-old'} onClick={() => setMode('kanji-old')}>きゅうじ 壱弐参</Pill>
          <Pill active={mode === 'roman-upper'} onClick={() => setMode('roman-upper')}>ローマ大 ⅠⅡⅢ</Pill>
          <Pill active={mode === 'roman-lower'} onClick={() => setMode('roman-lower')}>ローマ小 ⅰⅱⅲ</Pill>
          <Pill active={mode === 'greek-upper'} onClick={() => setMode('greek-upper')}>ギリシャ大 ΑΒΓ</Pill>
          <Pill active={mode === 'greek-lower'} onClick={() => setMode('greek-lower')}>ギリシャ小 αβγ</Pill>
        </div>

        {mode === 'english' && (
          <>
            <div style={SECTION}>もじの しゅるい</div>
            <div style={ROW}>
              <Pill active={caseMode === 'upper'} onClick={() => setCaseMode('upper')}>大もじ ABC</Pill>
              <Pill active={caseMode === 'lower'} onClick={() => setCaseMode('lower')}>小もじ abc</Pill>
              <Pill active={caseMode === 'mix'} onClick={() => setCaseMode('mix')}>ミックス Ab</Pill>
            </div>
            <p style={{ ...styles.modalText, fontSize: 13, color: '#888' }}>
              ※ アルファベットは ランダムな もじから 9こ じゅんばんに ならぶよ
            </p>
          </>
        )}

        <div style={SECTION}>ビリヤードだい</div>
        <div style={ROW}>
          <Pill active={shape === 'rect'} onClick={() => setShape('rect')}>■ しかく</Pill>
          <Pill active={shape === 'circle'} onClick={() => setShape('circle')}>● まる</Pill>
          <Pill active={shape === 'star'} onClick={() => setShape('star')}>★ ほし</Pill>
          <Pill active={shape === 'hexagram'} onClick={() => setShape('hexagram')}>✡ ろくぼうせい</Pill>
        </div>

        <div style={SECTION}>あなの おおきさ</div>
        <div style={ROW}>
          <Pill active={pocketSize === 's'} onClick={() => setPocketSize('s')}>ちいさい</Pill>
          <Pill active={pocketSize === 'm'} onClick={() => setPocketSize('m')}>ふつう</Pill>
          <Pill active={pocketSize === 'l'} onClick={() => setPocketSize('l')}>おおきい</Pill>
        </div>

        <div style={SECTION}>じどう よこスクロール</div>
        <div style={ROW}>
          <Pill active={!autoScroll} onClick={() => setAutoScroll(false)}>オフ</Pill>
          <Pill active={autoScroll} onClick={() => setAutoScroll(true)}>オン</Pill>
        </div>
        <p style={{ ...styles.modalText, fontSize: 13, color: '#888' }}>
          ※ オンにすると、ねらう ドラッグが はしに きたとき じどうで スクロールします
        </p>

        <button style={{ ...styles.closeBtn, marginTop: 8 }} onClick={() => onApply({ mode, caseMode, shape, pocketSize, ballCount, autoScroll, players })}>
          このせっていで はじめる
        </button>
        <button
          style={{ ...styles.closeBtn, backgroundColor: '#f4511e', marginTop: 10 }}
          onClick={onReset}
        >
          いまのままで やりなおす
        </button>
        <p style={styles.versionText}>v{APP_VERSION}</p>
        <button style={{ ...styles.closeBtn, backgroundColor: '#999' }} onClick={onClose}>とじる</button>
      </div>
    </div>
  )
}

// ゲーム状態から React に渡す表示用スナップショットを作る
function readUi(g) {
  const tb = targetBall(g)
  return {
    phase: g.phase,
    target: g.target,
    targetLabel: tb ? tb.label : '',
    targetColor: tb ? tb.color : '#ccc',
    targetStripe: tb ? tb.stripe : false,
    targetReading: readingOf(g, g.target),
    message: g.message,
    shots: g.shots,
    fouls: g.fouls,
    players: g.players,
    current: g.current,
    winner: g.winner,
    balls: objectBalls(g)
      .map((b) => ({ order: b.order, label: b.label, color: b.color, stripe: b.stripe, active: b.active, pocketedBy: b.pocketedBy }))
      .sort((a, b) => a.order - b.order),
  }
}

export default function App() {
  const canvasRef = useRef(null)
  const gameRef = useRef(createGame(DEFAULT_OPTIONS))
  const aimRef = useRef(null)
  const ghostRef = useRef(null)
  const fitRef = useRef(null)
  const camRef = useRef(0) // フィールドの横スクロール量（ワールド単位、-MARGIN..+MARGIN）
  const sliderRef = useRef(null)
  if (import.meta.env.DEV) window.__gameRef = gameRef // 開発時のみ：E2Eテスト用フック

  const panTo = (v) => {
    camRef.current = clamp(v, -MARGIN, MARGIN)
    if (sliderRef.current) sliderRef.current.value = String(camRef.current)
  }

  const [splashDone, setSplashDone] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [options, setOptions] = useState(DEFAULT_OPTIONS)
  const [ui, setUi] = useState(() => readUi(gameRef.current))
  const syncUI = () => setUi(readUi(gameRef.current))

  const startGame = (opts) => {
    setOptions(opts)
    gameRef.current = createGame(opts)
    aimRef.current = null
    ghostRef.current = null
    panTo(0) // 中央表示にもどす
    fitRef.current?.() // 形状が変わると盤の縦横比が変わるため再フィット
    syncUI()
    setShowSettings(false)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    let raf
    let acc = 0
    let lastT = performance.now()
    let dragging = false
    let shotInfo = null

    // 描画サイズ調整（現在のテーブル形状の縦横比に合わせる）
    const fit = () => {
      const t = gameRef.current.table
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
      const cssW = canvas.clientWidth
      const cssH = cssW * (t.ch / t.cw)
      canvas.style.height = `${cssH}px`
      canvas.width = Math.round(cssW * dpr)
      canvas.height = Math.round(cssH * dpr)
    }
    fitRef.current = fit

    let lastClient = null // 照準ドラッグ中の最後のポインタ画面座標

    const toFelt = (e) => {
      const t = gameRef.current.table
      const rect = canvas.getBoundingClientRect()
      const wx = camRef.current + ((e.clientX - rect.left) / rect.width) * t.cw
      const wy = ((e.clientY - rect.top) / rect.height) * t.ch
      return { x: wx - RAIL, y: wy - RAIL }
    }

    const render = () => {
      const g = gameRef.current
      const t = g.table
      const cam = camRef.current
      const ctx = canvas.getContext('2d')
      const sx = canvas.width / t.cw
      const sy = canvas.height / t.ch
      ctx.setTransform(sx, 0, 0, sy, -cam * sx, 0)
      ctx.clearRect(cam, 0, t.cw, t.ch)
      // 余白の背景（クリーム）
      ctx.fillStyle = '#FFF8E7'
      ctx.fillRect(cam - 1, 0, t.cw + 2, t.ch)
      drawTable(ctx, t)
      // 照準
      if (g.phase === 'aiming' && aimRef.current && aimRef.current.power > 0) {
        drawAim(ctx, cueBall(g), aimRef.current, t)
      }
      // ゴースト（手球配置）
      if (g.phase === 'ballInHand' && ghostRef.current) {
        drawGhost(ctx, ghostRef.current.x, ghostRef.current.y, ghostRef.current.ok)
      }
      // ボール
      for (const b of g.balls) {
        if (b.active) drawBall(ctx, b.x + RAIL, b.y + RAIL, b)
      }
    }

    const frame = (t) => {
      const g = gameRef.current
      const dt = Math.min((t - lastT) / 1000, 0.05)
      lastT = t
      if (g.phase === 'shooting') {
        acc += dt
        while (acc >= FIXED_DT) {
          advance(g.balls, FIXED_DT, shotInfo, g.table)
          acc -= FIXED_DT
        }
        if (allStopped(g.balls)) {
          resolveShot(g, shotInfo)
          shotInfo = null
          syncUI()
        }
      }
      // 照準ドラッグが端にあるとき、フィールドを自動スクロール（設定がオンのときだけ）
      if (g.autoScroll && g.phase === 'aiming' && dragging && lastClient) {
        const tbl = g.table
        const rect = canvas.getBoundingClientRect()
        const fx = (lastClient.clientX - rect.left) / rect.width
        const speed = tbl.cw * 1.4
        let moved = false
        if (fx < 0.18) {
          camRef.current = clamp(camRef.current - speed * dt, -MARGIN, MARGIN)
          moved = true
        } else if (fx > 0.82) {
          camRef.current = clamp(camRef.current + speed * dt, -MARGIN, MARGIN)
          moved = true
        }
        if (moved) {
          if (sliderRef.current) sliderRef.current.value = String(camRef.current)
          const fy = (lastClient.clientY - rect.top) / rect.height
          const wx = camRef.current + fx * tbl.cw
          const wy = fy * tbl.ch
          aimRef.current = aimFromDrag(cueBall(g), wx - RAIL, wy - RAIL)
        }
      }
      render()
      raf = requestAnimationFrame(frame)
    }

    const onDown = (e) => {
      const g = gameRef.current
      const p = toFelt(e)
      if (g.phase === 'ballInHand') {
        if (canPlaceCue(g, p.x, p.y)) {
          placeCue(g, p.x, p.y)
          ghostRef.current = null
          syncUI()
        }
        return
      }
      if (g.phase === 'aiming') {
        dragging = true
        lastClient = { clientX: e.clientX, clientY: e.clientY }
        canvas.setPointerCapture?.(e.pointerId)
        aimRef.current = aimFromDrag(cueBall(g), p.x, p.y)
      }
    }

    const onMove = (e) => {
      const g = gameRef.current
      const p = toFelt(e)
      if (g.phase === 'ballInHand') {
        ghostRef.current = { x: p.x, y: p.y, ok: canPlaceCue(g, p.x, p.y) }
        return
      }
      if (g.phase === 'aiming' && dragging) {
        lastClient = { clientX: e.clientX, clientY: e.clientY }
        aimRef.current = aimFromDrag(cueBall(g), p.x, p.y)
      }
    }

    const onUp = (e) => {
      const g = gameRef.current
      if (g.phase === 'aiming' && dragging) {
        dragging = false
        lastClient = null
        canvas.releasePointerCapture?.(e.pointerId)
        const aim = aimRef.current
        if (aim && aim.power > 0.06) {
          const cue = cueBall(g)
          const speed = aim.power * SHOT_MAX_SPEED
          cue.vx = aim.dirx * speed
          cue.vy = aim.diry * speed
          shotInfo = { firstHit: null, pocketed: [] }
          acc = 0
          g.phase = 'shooting'
          g.message = ''
          aimRef.current = null
          syncUI()
        } else {
          aimRef.current = null
        }
      }
    }

    fit()
    render()
    raf = requestAnimationFrame(frame)
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    window.addEventListener('resize', fit)

    return () => {
      cancelAnimationFrame(raf)
      fitRef.current = null
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      window.removeEventListener('resize', fit)
    }
  }, [])

  const hint =
    ui.phase === 'ballInHand'
      ? 'しろたまを おくところを タップしてね'
      : ui.phase === 'aiming'
        ? 'ドラッグして ねらって、はなして ショット！'
        : ui.phase === 'shooting'
          ? 'ころがり中…'
          : ''

  return (
    <div style={styles.container}>
      <style>{GLOBAL_CSS}</style>
      {!splashDone && <SplashScreen onDone={() => setSplashDone(true)} />}
      <header style={styles.header}>
        <span style={styles.headerTitle}>{APP_NAME}</span>
        <button style={styles.iconBtn} onClick={() => setShowGuide(true)} aria-label="あそびかた">ℹ️</button>
        <button style={styles.iconBtn} onClick={() => setShowSettings(true)} aria-label="せってい">⚙️</button>
      </header>

      <div style={styles.statusBar}>
        <div style={styles.targetBox}>
          <span style={styles.targetLabelText}>ねらう</span>
          <BallChip label={ui.targetLabel} color={ui.targetColor} stripe={ui.targetStripe} size={52} />
          <span style={styles.targetReading}>{ui.targetReading}</span>
        </div>
        <div style={styles.counter}>ショット {ui.shots}・ファウル {ui.fouls}</div>
      </div>

      <div style={styles.message}>{ui.message || hint}</div>

      <BallTray balls={ui.balls} players={ui.players} />
      {ui.players === 2 && (
        <PlayerBar balls={ui.balls} current={ui.current} phase={ui.phase} winner={ui.winner} />
      )}

      <div style={styles.canvasWrap}>
        <canvas ref={canvasRef} style={styles.canvas} />
      </div>

      <div style={styles.panBar}>
        <button style={styles.panBtn} onClick={() => panTo(-MARGIN)} aria-label="ひだりはじ">◀ はじ</button>
        <button style={styles.panBtn} onClick={() => panTo(0)} aria-label="まんなか">● まんなか</button>
        <button style={styles.panBtn} onClick={() => panTo(MARGIN)} aria-label="みぎはじ">はじ ▶</button>
      </div>
      <div style={styles.sliderWrap}>
        <input
          ref={sliderRef}
          type="range"
          min={-MARGIN}
          max={MARGIN}
          step={1}
          defaultValue={0}
          onInput={(e) => { camRef.current = Number(e.target.value) }}
          style={styles.slider}
          aria-label="フィールドの よこスクロール"
        />
      </div>

      {showGuide && <GuideModal onClose={() => setShowGuide(false)} />}
      {showSettings && (
        <SettingsModal
          options={options}
          onApply={startGame}
          onReset={() => startGame(options)}
          onClose={() => setShowSettings(false)}
        />
      )}

      {ui.phase === 'won' && (
        <div style={styles.overlay}>
          <div style={styles.winCard}>
            <div style={{ fontSize: 56 }}>🏆</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: ui.players === 2 && ui.winner != null ? PLAYER_COLORS[ui.winner] : '#1a1a2e', margin: '8px 0' }}>
              {ui.players === 2 && ui.winner != null ? `${playerLabel(ui.winner)}の かち！` : 'クリア！'}
            </div>
            {ui.players === 2 && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
                <BallTray balls={ui.balls} players={ui.players} />
              </div>
            )}
            <div style={{ fontSize: 16, fontWeight: 700, color: '#666', marginBottom: 20 }}>
              {ui.shots} ショット・ファウル {ui.fouls}かい
            </div>
            <button style={styles.bigBtn} onClick={() => startGame(options)}>もういちど</button>
          </div>
        </div>
      )}
    </div>
  )
}
