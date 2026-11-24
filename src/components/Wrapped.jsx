import { useEffect, useMemo, useState } from 'react'
import { formatINR } from '../lib/money.js'
import { category } from '../lib/categories.js'
import { rawDebts } from '../lib/balances.js'
import { confetti } from '../lib/fun.js'

const DURATION = 4500

/** 🎬 Trip Wrapped — Spotify-Wrapped-style story slides for a group. */
export default function Wrapped({ g, me, onClose }) {
  const slides = useMemo(() => buildSlides(g, me), [g, me])
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (paused) return
    const t = setTimeout(() => (i < slides.length - 1 ? setI(i + 1) : null), DURATION)
    return () => clearTimeout(t)
  }, [i, paused, slides.length])

  useEffect(() => { if (i === slides.length - 1) confetti() }, [i, slides.length])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') setI((x) => Math.min(slides.length - 1, x + 1))
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, slides.length])

  const s = slides[i]
  const tap = (e) => {
    const x = e.clientX / window.innerWidth
    setI(x < 0.3 ? Math.max(0, i - 1) : Math.min(slides.length - 1, i + 1))
  }

  return (
    <div className="wrapped" style={{ background: s.bg }} onPointerDown={() => setPaused(true)} onPointerUp={() => setPaused(false)}>
      <div className="wrapped-bars">
        {slides.map((_, k) => (
          <span key={k}><i className={k < i ? 'done' : k === i && !paused ? 'run' : ''} style={{ animationDuration: `${DURATION}ms` }} /></span>
        ))}
      </div>
      <button className="wrapped-close" onClick={onClose} aria-label="Close">✕</button>
      <div className="wrapped-body" key={i} onClick={tap}>
        <div className="wrapped-emoji">{s.emoji}</div>
        <p className="wrapped-kicker">{s.kicker}</p>
        <h1 className="wrapped-big">{s.big}</h1>
        <p className="wrapped-sub">{s.sub}</p>
      </div>
      <p className="wrapped-foot">{g.group.emoji} {g.group.name} · Wrapped by SplitMate</p>
    </div>
  )
}

function buildSlides(g, me) {
  const ex = g.expenses
  const name = (id) => (id === me ? 'You' : g.byId[id]?.name?.split(' ')[0] || 'Someone')
  const total = ex.reduce((a, e) => a + e.amount_paise, 0)
  const dates = ex.map((e) => e.expense_date).sort()
  const days = dates.length ? Math.round((new Date(dates.at(-1)) - new Date(dates[0])) / 864e5) + 1 : 1
  const myShare = ex.reduce((a, e) => a + (e.expense_splits.find((s) => s.user_id === me)?.share_paise || 0), 0)

  const byCat = {}
  for (const e of ex) byCat[e.category] = (byCat[e.category] || 0) + e.amount_paise
  const [topCat, topCatAmt] = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0] || ['other', 0]

  const biggest = [...ex].sort((a, b) => b.amount_paise - a.amount_paise)[0]

  const paid = {}
  for (const e of ex) paid[e.paid_by] = (paid[e.paid_by] || 0) + e.amount_paise
  const [banker, bankerAmt] = Object.entries(paid).sort((a, b) => b[1] - a[1])[0] || [me, 0]

  // the dish everyone fought over: most-shared item across itemized bills
  let dish = null
  for (const e of ex) for (const it of e.items?.items || []) {
    const n = Object.keys(it.weights || {}).length
    if (!dish || n > dish.n) dish = { name: it.name, n }
  }

  const raw = rawDebts(ex, g.settlements).length
  const pays = g.payments.length

  const slides = [
    { emoji: g.group.emoji, kicker: 'Your trip, wrapped', big: g.group.name, sub: `${days} day${days > 1 ? 's' : ''} · ${g.members.length} friends · ${ex.length} expenses`,
      bg: 'radial-gradient(circle at 30% 20%, #8b7bff, #1b1340 70%)' },
    { emoji: '💸', kicker: 'Together you spent', big: formatINR(total), sub: `That's ${formatINR(Math.round(total / Math.max(1, days)))} a day, or ${formatINR(Math.round(total / g.members.length))} each on average.`,
      bg: 'radial-gradient(circle at 70% 30%, #d4ff3a, #3a4a00 75%)' },
    { emoji: category(topCat).icon, kicker: 'Your group’s love language', big: category(topCat).label, sub: `${Math.round((topCatAmt / Math.max(1, total)) * 100)}% of everything went here: ${formatINR(topCatAmt)}.`,
      bg: 'radial-gradient(circle at 30% 70%, #ff6fae, #45102a 75%)' },
  ]
  if (biggest) slides.push({ emoji: '🤯', kicker: 'Biggest splurge', big: biggest.description, sub: `${formatINR(biggest.amount_paise)}, paid by ${name(biggest.paid_by)}.`,
    bg: 'radial-gradient(circle at 60% 20%, #fb923c, #4a1d05 75%)' })
  if (dish && dish.n > 1) slides.push({ emoji: '🍽️', kicker: 'The dish everyone shared', big: dish.name, sub: `${dish.n} of you dug into this one.`,
    bg: 'radial-gradient(circle at 40% 40%, #4ade80, #0b3a1e 75%)' })
  slides.push({ emoji: '🏦', kicker: 'The group’s ATM', big: name(banker), sub: `${banker === me ? 'You' : name(banker)} paid ${formatINR(bankerAmt)} upfront. Legend.`,
    bg: 'radial-gradient(circle at 70% 70%, #38bdf8, #082a3d 75%)' })
  slides.push({ emoji: '🧾', kicker: 'Your share of the fun', big: formatINR(myShare), sub: myShare ? `Worth every rupee? ${myShare > total / g.members.length ? 'You lived it up 😎' : 'You kept it classy 🪶'}` : 'You were the free-loader this time 👀',
    bg: 'radial-gradient(circle at 30% 30%, #facc15, #3d2f00 75%)' })
  slides.push({ emoji: '🪄', kicker: 'SplitMate magic', big: raw > pays ? `${raw} → ${pays}` : pays ? `${pays} payment${pays > 1 ? 's' : ''}` : 'All settled!',
    sub: raw > pays ? `We untangled ${raw} debts into just ${pays} payment${pays === 1 ? '' : 's'}. Settle up and stay friends 💚` : 'Friendship status: intact 💚',
    bg: 'radial-gradient(circle at 50% 30%, #d4ff3a, #8b7bff 60%, #1b1340)' })
  return slides
}
