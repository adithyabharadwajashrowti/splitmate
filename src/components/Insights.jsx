import { formatINR } from '../lib/money.js'
import { category } from '../lib/categories.js'
import { badges } from '../lib/fun.js'
import Avatar from './Avatar.jsx'

export default function Insights({ g, me }) {
  const ex = g.expenses
  if (!ex.length) return <div className="empty card"><div className="empty-emoji">📊</div><p>Add a few expenses to see where the money goes.</p></div>

  const total = ex.reduce((a, e) => a + e.amount_paise, 0)
  const myShare = ex.reduce((a, e) => a + (e.expense_splits.find((s) => s.user_id === me)?.share_paise || 0), 0)

  const byCat = {}
  for (const e of ex) byCat[e.category] = (byCat[e.category] || 0) + e.amount_paise
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1])

  const consumed = {} // what each person's share was
  const paid = {}
  for (const e of ex) {
    paid[e.paid_by] = (paid[e.paid_by] || 0) + e.amount_paise
    for (const s of e.expense_splits) consumed[s.user_id] = (consumed[s.user_id] || 0) + s.share_paise
  }
  const people = g.members.map((m) => ({ ...m, consumed: consumed[m.id] || 0, paid: paid[m.id] || 0 }))
    .sort((a, b) => b.consumed - a.consumed)
  const maxPerson = Math.max(1, ...people.map((p) => Math.max(p.consumed, p.paid)))

  const byMonth = {}
  for (const e of ex) { const k = e.expense_date.slice(0, 7); byMonth[k] = (byMonth[k] || 0) + e.amount_paise }
  const months = Object.entries(byMonth).sort().slice(-6)
  const maxMonth = Math.max(1, ...months.map((m) => m[1]))

  const biggest = [...ex].sort((a, b) => b.amount_paise - a.amount_paise)[0]

  return (
    <section className="stack">
      <div className="stat-grid">
        <div className="stat"><small>Group spent</small><strong>{formatINR(total)}</strong></div>
        <div className="stat"><small>Your share</small><strong>{formatINR(myShare)}</strong></div>
        <div className="stat"><small>Per person avg</small><strong>{formatINR(Math.round(total / Math.max(1, g.members.length)))}</strong></div>
      </div>

      {badges(g).length > 0 && (
        <div className="badges">
          {badges(g).map((b) => (
            <div key={b.title} className="badge-card">
              <span className="badge-icon">{b.icon}</span>
              <small>{b.title}</small>
              <div className="row" style={{ gap: 6 }}><Avatar name={g.byId[b.who]?.name} size={20} /><strong>{b.who === me ? 'You' : g.byId[b.who]?.name?.split(' ')[0]}</strong></div>
              <span className="muted small">{b.note}</span>
            </div>
          ))}
        </div>
      )}

      <div className="card stack">
        <h3>Where the money went</h3>
        <div className="donut-wrap">
          <div className="donut" style={{ background: `conic-gradient(${donutStops(cats, total)})` }}>
            <div className="donut-center"><div><strong style={{ fontSize: '1.15rem' }}>{formatINR(total)}</strong><small>total</small></div></div>
          </div>
          <div className="legend">
            {cats.map(([k, v]) => {
              const c = category(k)
              return (
                <div key={k} className="legend-row">
                  <span className="sw" style={{ background: c.color }} />
                  <span>{c.icon} {c.label}</span>
                  <span className="v">{Math.round((v / total) * 100)}%</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="card stack-sm">
        <h3>Per person</h3>
        <p className="muted small"><span className="dot consumed" /> their share &nbsp;&nbsp; <span className="dot paid" /> paid upfront</p>
        {people.map((p) => (
          <div key={p.id} className="bar-row">
            <span className="bar-label">{p.id === me ? 'You' : p.name.split(' ')[0]}</span>
            <span className="bar double">
              <span className="consumed" style={{ width: `${(p.consumed / maxPerson) * 100}%` }} />
              <span className="paid" style={{ width: `${(p.paid / maxPerson) * 100}%` }} />
            </span>
            <span className="bar-val">{formatINR(p.consumed)}</span>
          </div>
        ))}
      </div>

      {months.length > 1 && (
        <div className="card stack-sm">
          <h3>Monthly</h3>
          <div className="months">
            {months.map(([k, v]) => (
              <div key={k} className="month">
                <span className="month-bar" style={{ height: `${(v / maxMonth) * 100}%` }} title={formatINR(v)} />
                <small>{new Date(k + '-01').toLocaleDateString('en-IN', { month: 'short' })}</small>
              </div>
            ))}
          </div>
        </div>
      )}

      {biggest && <p className="muted small">💡 Biggest expense: <strong>{biggest.description}</strong> ({formatINR(biggest.amount_paise)}). {cats[0] && `${category(cats[0][0]).label} is ${Math.round((cats[0][1] / total) * 100)}% of all spending.`}</p>}
    </section>
  )
}

function donutStops(cats, total) {
  let acc = 0
  return cats.map(([k, v]) => {
    const start = (acc / total) * 360
    acc += v
    return `${category(k).color} ${start}deg ${(acc / total) * 360}deg`
  }).join(', ')
}
