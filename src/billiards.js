// billiards.js — ナインボール用の軽量2D物理＆ルール（Reactに依存しない純粋ロジック）
// 座標系は「フェルト面ローカル」: 原点はテーブル左上（レール内側ではなくフェルト範囲の左上）、yは下向き。
//
// 各ボールは「order（プレイ順 1..9）」と「label（盤面の表示文字）」を持つ。
// ルールは order で動き、label は数字/英字/漢数字いずれでもよい。
// テーブルは形状（四角/円/星）ごとに「クッション線分」と「ポケット」を持ち、
// 衝突は線分ベースで統一的に処理する。

// ===== 共通定数 =====
export const RAIL = 26 // レール（木枠）の太さ（描画用）
export const R = 10 // ボール半径

export const DECEL = 460 // ころがり摩擦による減速 (units/s^2)
export const REST_WALL = 0.86 // クッション反発
export const REST_BALL = 0.95 // ボール同士の反発
export const STOP_EPS = 7 // この速さ未満で停止扱い (units/s)
export const FIXED_DT = 1 / 240 // 物理の固定ステップ
export const SHOT_MAX_SPEED = 1450 // 最大ショット速度
export const POWER_MAX_DRAG = 200 // この距離ドラッグで最大パワー

const POCKET_SIZES = { s: 15, m: 20, l: 27 }

// order（1..9）ごとのボール色（1〜8=ソリッド、9=ストライプ）。0=手球（白）。
export const BALL_COLORS = {
  0: '#fdfcf8', 1: '#f6c500', 2: '#1763b8', 3: '#e0322a', 4: '#6a2c91',
  5: '#e87211', 6: '#1f8a3b', 7: '#8a2f2f', 8: '#1a1a1a', 9: '#f6c500',
}
const MONEY_COLOR = '#f6c500' // マネーボール（最後＝勝ちボール）の色（ストライプ）

// ===== ラベル =====
const KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九']
const KANJI_OLD = ['壱', '弐', '参', '肆', '伍', '陸', '漆', '捌', '玖']
const ROMAN_UPPER = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ']
const ROMAN_LOWER = ['ⅰ', 'ⅱ', 'ⅲ', 'ⅳ', 'ⅴ', 'ⅵ', 'ⅶ', 'ⅷ', 'ⅸ']
const GREEK_UPPER = ['Α', 'Β', 'Γ', 'Δ', 'Ε', 'Ζ', 'Η', 'Θ', 'Ι', 'Κ', 'Λ', 'Μ', 'Ν', 'Ξ', 'Ο', 'Π', 'Ρ', 'Σ', 'Τ', 'Υ', 'Φ', 'Χ', 'Ψ', 'Ω']
const GREEK_LOWER = ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ', 'ν', 'ξ', 'ο', 'π', 'ρ', 'σ', 'τ', 'υ', 'φ', 'χ', 'ψ', 'ω']

export const LABEL_MODES = ['number', 'english', 'kanji', 'kanji-old', 'roman-upper', 'roman-lower', 'greek-upper', 'greek-lower']

// 配列から「ランダムな開始位置 + 連続n個」を返すラベラー
function pickConsecutive(arr, n) {
  const start = Math.floor(Math.random() * (arr.length - n + 1))
  return (order) => arr[start + order - 1]
}

function makeLabeler(mode, caseMode, n) {
  if (mode === 'english') {
    const start = Math.floor(Math.random() * (26 - n + 1))
    const cased = Array.from({ length: n }, (_, k) => {
      const ch = String.fromCharCode(65 + start + k)
      if (caseMode === 'lower') return ch.toLowerCase()
      if (caseMode === 'mix') return Math.random() < 0.5 ? ch : ch.toLowerCase()
      return ch
    })
    return (order) => cased[order - 1]
  }
  if (mode === 'kanji') return (order) => KANJI[order - 1]
  if (mode === 'kanji-old') return (order) => KANJI_OLD[order - 1]
  if (mode === 'roman-upper') return (order) => ROMAN_UPPER[order - 1]
  if (mode === 'roman-lower') return (order) => ROMAN_LOWER[order - 1]
  if (mode === 'greek-upper') return pickConsecutive(GREEK_UPPER, n)
  if (mode === 'greek-lower') return pickConsecutive(GREEK_LOWER, n)
  return (order) => String(order)
}

export function refOf(game, order) {
  const b = game.balls.find((x) => !x.isCue && x.order === order)
  const label = b ? b.label : String(order)
  const noBan = game.mode === 'english' || game.mode === 'greek-upper' || game.mode === 'greek-lower'
  return noBan ? label : `${label}ばん`
}

// ===== よみかた =====
const NUM_YOMI = ['いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう']
const ENG_NUM_YOMI = ['ワン', 'ツー', 'スリー', 'フォー', 'ファイブ', 'シックス', 'セブン', 'エイト', 'ナイン']
const LATIN_YOMI = {
  A: 'エー', B: 'ビー', C: 'シー', D: 'ディー', E: 'イー', F: 'エフ', G: 'ジー', H: 'エイチ',
  I: 'アイ', J: 'ジェー', K: 'ケー', L: 'エル', M: 'エム', N: 'エヌ', O: 'オー', P: 'ピー',
  Q: 'キュー', R: 'アール', S: 'エス', T: 'ティー', U: 'ユー', V: 'ブイ', W: 'ダブリュー',
  X: 'エックス', Y: 'ワイ', Z: 'ゼット',
}
const GREEK_NAMES = ['アルファ', 'ベータ', 'ガンマ', 'デルタ', 'イプシロン', 'ゼータ', 'イータ', 'シータ', 'イオタ', 'カッパ', 'ラムダ', 'ミュー', 'ニュー', 'クサイ', 'オミクロン', 'パイ', 'ロー', 'シグマ', 'タウ', 'ウプシロン', 'ファイ', 'カイ', 'プサイ', 'オメガ']
const GREEK_YOMI = {}
GREEK_UPPER.forEach((ch, i) => { GREEK_YOMI[ch] = GREEK_NAMES[i] })
GREEK_LOWER.forEach((ch, i) => { GREEK_YOMI[ch] = GREEK_NAMES[i] })

// ターゲットの「よみかた」を返す（モードに応じて）
export function readingOf(game, order) {
  const b = game.balls.find((x) => !x.isCue && x.order === order)
  if (!b) return ''
  const m = game.mode
  if (m === 'english') return LATIN_YOMI[b.label.toUpperCase()] || ''
  if (m === 'greek-upper' || m === 'greek-lower') return GREEK_YOMI[b.label] || ''
  if (m === 'roman-upper' || m === 'roman-lower') return ENG_NUM_YOMI[order - 1] || '' // ローマ数字は英語読み
  return NUM_YOMI[order - 1] || '' // number / kanji / kanji-old は数の読み
}

// ===== 幾何ヘルパー =====
const len = (x, y) => Math.hypot(x, y)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

const shuffle = (arr) => {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function segsFromVerts(verts) {
  const segs = []
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i]
    const b = verts[(i + 1) % verts.length]
    segs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })
  }
  return segs
}

function distToSeg(px, py, s) {
  const dx = s.x2 - s.x1
  const dy = s.y2 - s.y1
  const L2 = dx * dx + dy * dy
  const t = L2 > 0 ? clamp(((px - s.x1) * dx + (py - s.y1) * dy) / L2, 0, 1) : 0
  return len(px - (s.x1 + t * dx), py - (s.y1 + t * dy))
}

function pointInPolygon(verts, x, y) {
  let inside = false
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i].x, yi = verts[i].y
    const xj = verts[j].x, yj = verts[j].y
    const hit = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (hit) inside = !inside
  }
  return inside
}

// 任意中心の頂点列を、左上が(0,0)になるよう平行移動して bbox の幅高さを返す
function normalizePoly(rawVerts) {
  const xs = rawVerts.map((v) => v.x)
  const ys = rawVerts.map((v) => v.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const W = Math.max(...xs) - minX
  const H = Math.max(...ys) - minY
  const verts = rawVerts.map((v) => ({ x: v.x - minX, y: v.y - minY }))
  return { verts, W, H }
}

// ===== ラック =====
// apex（index0）は手球側（下）。rows は上方向へ広がる。
// 各行は三角格子で半個ずつオフセットされる前提。連続する行の個数を変える
// （同数だと真上に重なってめり込むため）ことで密に組める形状にする。
const FORMATIONS = { 3: [1, 2], 5: [2, 3], 9: [1, 2, 3, 2, 1] }

function buildRack(cx, apexY, count) {
  const rows = FORMATIONS[count] || FORMATIONS[9]
  const rowH = Math.sqrt(3) * R
  const gap = 0.5
  const spots = []
  rows.forEach((c, k) => {
    const y = apexY - k * (rowH + gap)
    for (let i = 0; i < c; i++) {
      spots.push({ x: cx + (i - (c - 1) / 2) * (2 * R + gap), y })
    }
  })
  return spots
}

// マネーボール（最後＝勝ちボール）を置くスポット：apex以外で重心に最も近い位置
function moneyIndex(spots) {
  const cxm = spots.reduce((s, p) => s + p.x, 0) / spots.length
  const cym = spots.reduce((s, p) => s + p.y, 0) / spots.length
  let best = 1
  let bd = Infinity
  for (let i = 1; i < spots.length; i++) {
    const d = len(spots[i].x - cxm, spots[i].y - cym)
    if (d < bd) {
      bd = d
      best = i
    }
  }
  return best
}

// 星形（n芒星）テーブルを作る。ox/oy で楕円スケール（縦長化）、ir で内側半径比（大きいほど食い込み浅い）。
function starlikeTable(shape, points, ox, oy, ir, pocketR, anchorFracY, cueFracY) {
  const raw = []
  const step = 360 / points
  for (let k = 0; k < points; k++) {
    const ao = (-90 + k * step) * (Math.PI / 180)
    const ai = (-90 + step / 2 + k * step) * (Math.PI / 180)
    raw.push({ x: ox * Math.cos(ao), y: oy * Math.sin(ao) })
    raw.push({ x: ox * ir * Math.cos(ai), y: oy * ir * Math.sin(ai) })
  }
  const { verts, W, H } = normalizePoly(raw)
  const pockets = verts.filter((_, i) => i % 2 === 0) // 外側の頂点＝ポケット
  const segments = segsFromVerts(verts)
  const cx = W / 2
  return {
    shape, pocketR,
    cw: W + 2 * RAIL, ch: H + 2 * RAIL,
    segments,
    pockets,
    rackAnchor: { cx, apexY: H * anchorFracY },
    cueSpot: { x: cx, y: H * cueFracY },
    feltKind: 'poly', feltParams: { verts },
    contains: (x, y) => pointInPolygon(verts, x, y) && segments.every((s) => distToSeg(x, y, s) >= R),
  }
}

// ===== テーブル生成 =====
export function makeTable(shape = 'rect', pocketSize = 'm') {
  const pocketR = POCKET_SIZES[pocketSize] || POCKET_SIZES.m

  // 縦長・食い込み浅めの5芒星
  if (shape === 'star') {
    return starlikeTable('star', 5, 120, 185, 0.74, pocketR, 0.40, 0.56)
  }
  // 縦長の六芒星
  if (shape === 'hexagram') {
    return starlikeTable('hexagram', 6, 150, 185, 0.60, pocketR, 0.44, 0.62)
  }

  if (shape === 'circle') {
    const cx = 150, cy = 150, CR = 150
    const N = 36
    const verts = Array.from({ length: N }, (_, i) => {
      const a = (i / N) * Math.PI * 2
      return { x: cx + CR * Math.cos(a), y: cy + CR * Math.sin(a) }
    })
    const pockets = Array.from({ length: 6 }, (_, i) => {
      const a = (i / 6) * Math.PI * 2
      return { x: cx + CR * Math.cos(a), y: cy + CR * Math.sin(a) }
    })
    return {
      shape, pocketR,
      cw: 2 * cx + 2 * RAIL, ch: 2 * cy + 2 * RAIL,
      segments: segsFromVerts(verts),
      pockets,
      rackAnchor: { cx, apexY: cy + 8 },
      cueSpot: { x: cx, y: cy + 80 },
      feltKind: 'circle', feltParams: { cx, cy, r: CR },
      contains: (x, y) => len(x - cx, y - cy) <= CR - R,
    }
  }

  // rect（既定）
  const W = 300, H = 510
  const verts = [
    { x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H },
  ]
  const pockets = [
    { x: 0, y: 0 }, { x: W, y: 0 }, { x: 0, y: H }, { x: W, y: H },
    { x: 0, y: H / 2 }, { x: W, y: H / 2 },
  ]
  return {
    shape: 'rect', pocketR,
    cw: W + 2 * RAIL, ch: H + 2 * RAIL,
    segments: segsFromVerts(verts),
    pockets,
    rackAnchor: { cx: W / 2, apexY: H * 0.40 },
    cueSpot: { x: W / 2, y: H * 0.76 },
    feltKind: 'rect', feltParams: { W, H },
    contains: (x, y) => x >= R && x <= W - R && y >= R && y <= H - R,
  }
}

// プレイヤー表示名（2人モード用）
export const playerLabel = (i) => `プレイヤー${i + 1}`

// ===== ゲーム生成 =====
export function createGame(options = {}) {
  const mode = LABEL_MODES.includes(options.mode) ? options.mode : 'number'
  const caseMode = options.caseMode || 'upper'
  const ballCount = [3, 5, 9].includes(options.ballCount) ? options.ballCount : 9
  const players = options.players === 2 ? 2 : 1
  const label = makeLabeler(mode, caseMode, ballCount)
  const table = makeTable(options.shape, options.pocketSize)

  const spots = buildRack(table.rackAnchor.cx, table.rackAnchor.apexY, ballCount)
  const mIdx = moneyIndex(spots)
  const orders = new Array(ballCount)
  orders[0] = 1 // apex＝最初に狙う
  orders[mIdx] = ballCount // マネーボール（最後＝勝ち）
  const rest = shuffle(Array.from({ length: ballCount - 2 }, (_, k) => k + 2)) // 2..ballCount-1
  let oi = 0
  for (let i = 0; i < ballCount; i++) {
    if (i === 0 || i === mIdx) continue
    orders[i] = rest[oi++]
  }
  const balls = spots.map((s, i) => {
    const order = orders[i]
    const isMoney = order === ballCount
    return {
      isCue: false, order, label: label(order),
      color: isMoney ? MONEY_COLOR : BALL_COLORS[order], stripe: isMoney,
      x: s.x, y: s.y, vx: 0, vy: 0, active: true,
      pocketedBy: null, // 落としたプレイヤーの番号（スコアトレイ表示用）
    }
  })
  balls.push({
    isCue: true, order: 0, label: null, color: BALL_COLORS[0], stripe: false,
    x: table.cueSpot.x, y: table.cueSpot.y, vx: 0, vy: 0, active: false,
  })
  return {
    balls, table, mode, caseMode, ballCount, rackSpots: spots,
    autoScroll: !!options.autoScroll,
    players, current: 0, winner: null,
    phase: 'ballInHand',
    target: 1, shots: 0, fouls: 0,
    message: players === 2
      ? `${playerLabel(0)}から！しろたまを おくところを タップしてね`
      : 'しろたまを おくところを タップしてね',
  }
}

export const cueBall = (game) => game.balls.find((b) => b.isCue)
export const objectBalls = (game) => game.balls.filter((b) => !b.isCue)
export const targetBall = (game) => game.balls.find((b) => !b.isCue && b.order === game.target)
export const lowestActive = (game) => {
  const live = objectBalls(game).filter((b) => b.active).map((b) => b.order)
  return live.length ? Math.min(...live) : null
}

export function canPlaceCue(game, x, y) {
  const t = game.table
  if (!t.contains(x, y)) return false
  for (const p of t.pockets) {
    if (len(x - p.x, y - p.y) < t.pocketR + R) return false
  }
  for (const b of game.balls) {
    if (b.isCue || !b.active) continue
    if (len(x - b.x, y - b.y) < 2 * R + 1) return false
  }
  return true
}

export function placeCue(game, x, y) {
  const cue = cueBall(game)
  cue.x = x
  cue.y = y
  cue.vx = 0
  cue.vy = 0
  cue.active = true
  game.phase = 'aiming'
  game.message = ''
}

// ===== 物理：1固定ステップ進める =====
export function advance(balls, dt, shotInfo, table) {
  // 1) 移動＋摩擦
  for (const b of balls) {
    if (!b.active) continue
    const sp = len(b.vx, b.vy)
    if (sp === 0) continue
    b.x += b.vx * dt
    b.y += b.vy * dt
    const ns = sp - DECEL * dt
    if (ns <= STOP_EPS) {
      b.vx = 0
      b.vy = 0
    } else {
      const f = ns / sp
      b.vx *= f
      b.vy *= f
    }
  }
  // 2) ポケット判定（クッションより先に）
  for (const b of balls) {
    if (!b.active) continue
    for (const p of table.pockets) {
      if (len(b.x - p.x, b.y - p.y) < table.pocketR) {
        b.active = false
        b.vx = 0
        b.vy = 0
        shotInfo.pocketed.push(b.order)
        break
      }
    }
  }
  // 3) クッション（線分）反射
  for (const b of balls) {
    if (!b.active) continue
    for (const s of table.segments) {
      const dx = s.x2 - s.x1
      const dy = s.y2 - s.y1
      const L2 = dx * dx + dy * dy
      const t = L2 > 0 ? clamp(((b.x - s.x1) * dx + (b.y - s.y1) * dy) / L2, 0, 1) : 0
      const cxp = s.x1 + t * dx
      const cyp = s.y1 + t * dy
      let nx = b.x - cxp
      let ny = b.y - cyp
      const d = len(nx, ny)
      if (d >= R || d === 0) continue
      nx /= d
      ny /= d
      b.x = cxp + nx * R
      b.y = cyp + ny * R
      const vn = b.vx * nx + b.vy * ny
      if (vn < 0) {
        b.vx -= (1 + REST_WALL) * vn * nx
        b.vy -= (1 + REST_WALL) * vn * ny
      }
    }
  }
  // 4) ボール同士の衝突（等質量・弾性）
  for (let i = 0; i < balls.length; i++) {
    const a = balls[i]
    if (!a.active) continue
    for (let j = i + 1; j < balls.length; j++) {
      const b = balls[j]
      if (!b.active) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = len(dx, dy)
      if (d >= 2 * R || d === 0) continue
      const nx = dx / d
      const ny = dy / d
      const overlap = 2 * R - d
      a.x -= (nx * overlap) / 2
      a.y -= (ny * overlap) / 2
      b.x += (nx * overlap) / 2
      b.y += (ny * overlap) / 2
      const vRel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny
      if (vRel <= 0) continue
      const imp = ((1 + REST_BALL) / 2) * vRel
      a.vx -= imp * nx
      a.vy -= imp * ny
      b.vx += imp * nx
      b.vy += imp * ny
      if (shotInfo.firstHit === null && (a.isCue || b.isCue)) {
        shotInfo.firstHit = a.isCue ? b.order : a.order
      }
    }
  }
}

export function allStopped(balls) {
  for (const b of balls) {
    if (b.active && (b.vx !== 0 || b.vy !== 0)) return false
  }
  return true
}

function findRespot(game) {
  const cands = [...game.rackSpots, game.table.cueSpot]
  for (const c of cands) {
    if (canPlaceCue(game, c.x, c.y)) return c
  }
  return game.table.cueSpot
}

// ===== ショット解決 =====
export function resolveShot(game, shotInfo) {
  game.shots += 1
  const cue = cueBall(game)
  const shooter = game.current
  const target = game.target
  const winOrder = game.ballCount // 最後のボール＝勝ちボール
  const targetRef = refOf(game, target)
  const scratch = !cue.active
  const pocketedWin = shotInfo.pocketed.includes(winOrder)
  const wrongFirst = shotInfo.firstHit !== null && shotInfo.firstHit !== target
  const noHit = shotInfo.firstHit === null
  const foul = scratch || wrongFirst || noHit
  const pottedAny = shotInfo.pocketed.some((o) => o > 0)

  // 落ちたボールに「だれが おとしたか」を記録（スコアトレイ表示用）
  for (const o of shotInfo.pocketed) {
    if (o === 0) continue
    const b = game.balls.find((x) => !x.isCue && x.order === o)
    if (b) b.pocketedBy = shooter
  }

  if (pocketedWin) {
    if (!foul) {
      game.phase = 'won'
      game.winner = shooter
      game.message = game.players === 2
        ? `🏆 ${refOf(game, winOrder)} イン！${playerLabel(shooter)}の かち！`
        : `🏆 ${refOf(game, winOrder)} イン！クリア！`
      return game
    }
    const moneyBall = game.balls.find((b) => b.order === winOrder && !b.isCue)
    const spot = findRespot(game)
    moneyBall.x = spot.x
    moneyBall.y = spot.y
    moneyBall.active = true
    moneyBall.pocketedBy = null
  }

  game.target = lowestActive(game) ?? 9

  if (foul) {
    game.fouls += 1
    cue.active = false
    if (game.players === 2) game.current = 1 - game.current
    game.phase = 'ballInHand'
    if (scratch) game.message = 'ファウル！しろたまを おきなおしてね'
    else if (wrongFirst) game.message = `ファウル！${targetRef}に さきに あてよう`
    else game.message = 'ファウル！どれにも あたらなかったよ'
    if (game.players === 2) game.message += `（${playerLabel(game.current)}に こうたい）`
    return game
  }

  game.phase = 'aiming'
  if (game.players === 2 && !pottedAny) {
    game.current = 1 - game.current
    game.message = `こうたい！${playerLabel(game.current)}は ${refOf(game, game.target)}を ねらおう`
  } else if (game.players === 2 && pottedAny) {
    game.message = 'ナイスイン！つづけて ねらおう'
  } else {
    game.message = pottedAny ? 'ナイスイン！つぎを ねらおう' : `${refOf(game, game.target)}を ねらおう`
  }
  return game
}

export function aimFromDrag(cue, px, py) {
  const dx = cue.x - px
  const dy = cue.y - py
  const d = len(dx, dy)
  if (d < 1) return { power: 0, dirx: 0, diry: 0, dist: 0 }
  const ratio = Math.min(d / POWER_MAX_DRAG, 1)
  return { power: ratio, dirx: dx / d, diry: dy / d, dist: d }
}
