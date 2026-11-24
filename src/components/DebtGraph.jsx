import { useEffect, useState } from 'react'
import { rawDebts } from '../lib/balances.js'
import { formatINR } from '../lib/money.js'

const COLORS = ['#d4ff3a', '#8b7bff', '#ff6fae', '#4ade80', '#facc15', '#38bdf8', '#fb923c', '#f472b6']

/** 🕸️ Debt Untangler — animated before/after graph of who owes whom. */
export default function DebtGraph({ g, me }) {
  const before = rawDebts(g.expenses, g.settlements)
  const after = g.payments
  const [mode, setMode] = useState('before')
  const [auto, setAuto] = useState(true)

  // auto-play once: tangled → untangled
  useEffect(() => {
    if (!auto) return
    const t = setTimeout(() => setMode('after'), 1800)
    return () => clearTimeout(t)
  }, [auto])

  const W = 360, H = 300, cx = W / 2, cy = H / 2, R = 112
  const nodes = g.members.map((m, i) => {
    const a = (i / g.members.length) * Math.PI * 2 - Math.PI / 2
    return { ...m, x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), color: COLORS[i % COLORS.length] }
  })
  const pos = Object.fromEntries(nodes.map((n) => [n.id, n]))
  const edges = mode === 'before' ? before : after
  const label = (id) => (id === me ? 'You' : g.byId[id]?.name?.split(' ')[0] || '?')

  if (!before.length) return null

  return (
    <div className="card stack untangler">
      <div className="row-between">
        <div>
          <h3>🕸️ Debt Untangler</h3>
          <p className="muted small">{before.length} debts → {after.length} payment{after.length === 1 ? '' : 's'}</p>
        </div>
        <div className="seg" style={{ width: 'auto' }}>
          <button className={mode === 'before' ? 'on' : ''} onClick={() => { setAuto(false); setMode('before') }}>Tangled</button>
          <button className={mode === 'after' ? 'on' : ''} onClick={() => { setAuto(false); setMode('after') }}>Untangled ✨</button>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="graph" role="img" aria-label={`${edges.length} payments between ${g.members.length} people`}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={mode === 'after' ? '#d4ff3a' : '#ff8a5c'} />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const a = pos[e.from], b = pos[e.to]
          if (!a || !b) return null
          // shorten so arrows stop at the node edge, and bend slightly so A→B and B→A don't overlap
          const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1
          const ux = dx / len, uy = dy / len, r = 24
          const x1 = a.x + ux * r, y1 = a.y + uy * r, x2 = b.x - ux * (r + 4), y2 = b.y - uy * (r + 4)
          const mx = (x1 + x2) / 2 - uy * 18, my = (y1 + y2) / 2 + ux * 18
          return (
            <g key={mode + i} className="edge" style={{ animationDelay: `${i * 70}ms` }}>
              <path d={`M${x1},${y1} Q${mx},${my} ${x2},${y2}`} fill="none" stroke={mode === 'after' ? '#d4ff3a' : '#ff8a5c'}
                strokeWidth={mode === 'after' ? 2.6 : 1.6} strokeOpacity={mode === 'after' ? 0.95 : 0.7} markerEnd="url(#arrow)" />
              <text x={mx} y={my} className="edge-label" textAnchor="middle" dy="4">{formatINR(e.amount)}</text>
            </g>
          )
        })}
        {nodes.map((n) => (
          <g key={n.id}>
            <circle cx={n.x} cy={n.y} r="22" fill="#151922" stroke={n.color} strokeWidth="2.5" />
            <text x={n.x} y={n.y} textAnchor="middle" dy="5" className="node-label" fill={n.color}>{label(n.id).slice(0, 2).toUpperCase()}</text>
            <text x={n.x} y={n.y + 38} textAnchor="middle" className="node-name">{label(n.id)}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}
