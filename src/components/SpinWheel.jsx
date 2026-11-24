import { useState } from 'react'
import Modal from './Modal.jsx'
import { formatINR } from '../lib/money.js'
import { confetti } from '../lib/fun.js'

const COLORS = ['#d4ff3a', '#8b7bff', '#ff6fae', '#4ade80', '#facc15', '#38bdf8', '#fb923c', '#f472b6']

/**
 * 🎡 Who pays next? — a wheel where people who owe more get a bigger slice.
 * Fair mode: odds ∝ 1 + what you owe / average share. Fun mode: equal odds.
 */
export default function SpinWheel({ g, me, onClose }) {
  const [fair, setFair] = useState(true)
  const [angle, setAngle] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const [winner, setWinner] = useState(null)
  const [what, setWhat] = useState('the next round of chai ☕')

  const avg = Math.max(1, g.expenses.reduce((a, e) => a + e.amount_paise, 0) / Math.max(1, g.members.length))
  const people = g.members.map((m, i) => {
    const owes = Math.max(0, -(g.balances[m.id] || 0))
    return { ...m, owes, weight: fair ? 1 + (owes / avg) * 4 : 1, color: COLORS[i % COLORS.length] }
  })
  const total = people.reduce((a, p) => a + p.weight, 0)
  let acc = 0
  const slices = people.map((p) => {
    const start = (acc / total) * 360
    acc += p.weight
    return { ...p, start, end: (acc / total) * 360 }
  })
  const gradient = slices.map((s) => `${s.color} ${s.start}deg ${s.end}deg`).join(', ')

  function spin() {
    if (spinning) return
    setWinner(null)
    // pick by weight
    let r = Math.random() * total
    const pick = slices.find((s) => (r -= s.weight) <= 0) || slices[slices.length - 1]
    const mid = (pick.start + pick.end) / 2
    const jitter = (Math.random() - 0.5) * (pick.end - pick.start) * 0.6
    // pointer is at the top (0deg); rotate so the slice's middle lands under it
    const target = angle - (angle % 360) + 360 * 6 + (360 - mid - jitter)
    setSpinning(true)
    setAngle(target)
    setTimeout(() => { setSpinning(false); setWinner(pick); confetti() }, 4200)
  }

  const nm = (p) => (p.id === me ? 'You' : p.name.split(' ')[0])

  return (
    <Modal title="🎡 Who pays next?" onClose={onClose}>
      <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
        <label style={{ width: '100%' }}>Paying for
          <input value={what} onChange={(e) => setWhat(e.target.value)} maxLength={60} />
        </label>
        <div className="seg" style={{ width: '100%' }}>
          <button className={fair ? 'on' : ''} onClick={() => setFair(true)}>⚖️ Fair: debtors get bigger slices</button>
          <button className={!fair ? 'on' : ''} onClick={() => setFair(false)}>🎲 Pure luck</button>
        </div>

        <div className="wheel-wrap">
          <div className="wheel-pointer" />
          <div className="wheel" style={{ background: `conic-gradient(${gradient})`, transform: `rotate(${angle}deg)`, transition: spinning ? 'transform 4.2s cubic-bezier(.12,.8,.12,1)' : 'none' }}>
            {slices.map((s) => {
              const mid = (s.start + s.end) / 2
              return (
                <span key={s.id} className="wheel-label" style={{ transform: `translate(-50%, -50%) rotate(${mid}deg) translateY(-82px) rotate(${-mid}deg)` }}>
                  {nm(s)}
                </span>
              )
            })}
          </div>
          <button className="wheel-hub" onClick={spin} disabled={spinning}>{spinning ? '…' : 'SPIN'}</button>
        </div>

        {winner ? (
          <div className="winner">
            <small className="muted">The wheel has spoken 🎉</small>
            <h2>{nm(winner)} {winner.id === me ? 'pay' : 'pays'} for {what}!</h2>
            {fair && winner.owes > 0 && <p className="muted small">Fair enough: {nm(winner)} still owe{winner.id === me ? '' : 's'} {formatINR(winner.owes)} in this group.</p>}
          </div>
        ) : (
          <p className="muted small">{fair ? 'Odds lean towards whoever owes the most. Karma, but make it maths.' : 'Everyone has equal odds.'}</p>
        )}

        <div className="odds">
          {slices.map((s) => (
            <span key={s.id} className="tag" style={{ borderLeft: `3px solid ${s.color}` }}>{nm(s)} {Math.round((s.weight / total) * 100)}%</span>
          ))}
        </div>
      </div>
    </Modal>
  )
}
