import { splitScores } from '../lib/balances.js'
import Avatar from './Avatar.jsx'

/** 📊 SplitScore — playful CIBIL-style 300–900 trust score per friend. */
export default function SplitScore({ g, me }) {
  const scores = splitScores(g)
  const rows = g.members.map((m) => ({ ...m, ...scores[m.id] })).sort((a, b) => b.score - a.score)
  return (
    <div className="card stack">
      <div>
        <h3>📊 SplitScore</h3>
        <p className="muted small">Like a CIBIL score for friendships: paying upfront and settling fast push it up, unpaid debts pull it down.</p>
      </div>
      <div className="scores">
        {rows.map((r) => {
          const pct = (r.score - 300) / 600
          return (
            <div key={r.id} className="score-card">
              <div className="gauge" style={{ background: `conic-gradient(from -90deg at 50% 100%, ${r.color} ${pct * 180}deg, rgba(255,255,255,.08) ${pct * 180}deg 180deg, transparent 180deg)` }}>
                <div className="gauge-inner">
                  <strong className="num">{r.score}</strong>
                  <small style={{ color: r.color }}>{r.tier}</small>
                </div>
              </div>
              <div className="row" style={{ gap: 6, justifyContent: 'center' }}>
                <Avatar name={r.name} size={20} /><span className="small">{r.id === me ? 'You' : r.name.split(' ')[0]}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
