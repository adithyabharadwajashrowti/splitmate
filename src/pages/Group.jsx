import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useGroup } from '../hooks/useGroup.js'
import { useAuth } from '../auth.jsx'
import { supabase, niceError, callRpc, appUrl } from '../lib/supabase.js'
import { formatINR } from '../lib/money.js'
import { category } from '../lib/categories.js'
import Avatar from '../components/Avatar.jsx'
import Modal from '../components/Modal.jsx'
import ExpenseForm from '../components/ExpenseForm.jsx'
import SettleUp from '../components/SettleUp.jsx'
import Insights from '../components/Insights.jsx'
import DebtGraph from '../components/DebtGraph.jsx'
import SpinWheel from '../components/SpinWheel.jsx'
import Wrapped from '../components/Wrapped.jsx'
import SplitScore from '../components/SplitScore.jsx'
import TripTracker from '../components/TripTracker.jsx'
import { BalanceTag } from './Dashboard.jsx'
import { confetti, exportCsv, whatsappSummary, toast, haptic } from '../lib/fun.js'
import { toPaise } from '../lib/money.js'

export default function Group() {
  const { id } = useParams()
  const g = useGroup(id)
  const { user } = useAuth()
  const [tab, setTab] = useState('activity')
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [catFilter, setCatFilter] = useState(null)
  const [modal, setModal] = useState(null) // {type:'add'|'expense'|'settle'|'view'|'members'|'wheel'|'wrapped', ...}

  if (g.loading) return <GroupSkeleton />
  if (g.error) return <div className="stack"><p className="note err">{g.error}</p><Link to="/" className="btn">Back</Link></div>

  const me = g.balances[user.id] || 0
  const totalSpent = g.expenses.reduce((a, e) => a + e.amount_paise, 0)
  const feed = [
    ...g.expenses.map((e) => ({ kind: 'expense', day: e.expense_date, at: e.expense_date + e.created_at, e })),
    ...g.settlements.map((s) => ({ kind: 'settle', day: s.created_at.slice(0, 10), at: s.created_at.slice(0, 10) + s.created_at, s })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1))
  const q = query.trim().toLowerCase()
  const shown = feed.filter((f) => {
    if (f.kind === 'settle') return !q && !catFilter
    if (catFilter && f.e.category !== catFilter) return false
    if (!q) return true
    const hay = [f.e.description, f.e.notes, g.byId[f.e.paid_by]?.name, ...(f.e.items?.items || []).map((i) => i.name)].join(' ').toLowerCase()
    return hay.includes(q)
  })
  const usedCats = [...new Set(g.expenses.map((e) => e.category))]
  const budget = Number(g.group.budget_paise) || 0
  const isAdmin = g.byId[user.id]?.role === 'admin'
  const myPay = g.payments.find((p) => p.from === user.id)
  const owedPay = g.payments.find((p) => p.to === user.id)
  const solo = g.members.length < 2
  const close = () => setModal(null)
  const saved = () => { close(); g.reload() }

  async function setBudget() {
    const v = window.prompt('Trip budget in ₹ (leave empty to remove)', budget ? String(budget / 100) : '')
    if (v === null) return
    const paise = v.trim() ? toPaise(v) : null
    if (v.trim() && !(paise > 0)) return alert('Enter a valid amount')
    const { error } = await callRpc('set_budget', { p_group_id: g.group.id, p_budget: paise })
    if (error) alert(niceError(error))
    else { toast('Budget set 🎯', '🎯'); g.reload() }
  }

  // group the activity feed by day
  const days = []
  for (const f of shown) {
    const last = days[days.length - 1]
    if (last && last.day === f.day) last.items.push(f)
    else days.push({ day: f.day, items: [f] })
  }

  return (
    <div className="stack-lg fade-in group-page">
      <section className="group-hero">
        <Link to="/" className="back">← All groups</Link>
        <div className="top" style={{ marginTop: 14 }}>
          <span className="group-tile">{g.group.emoji}</span>
          <div className="grow">
            <h1 style={{ fontSize: '1.6rem' }}>{g.group.name}</h1>
            <button className="members-btn" onClick={() => setModal({ type: 'members' })} aria-label="Members and invite">
              <div className="avatar-stack">{g.members.slice(0, 5).map((m) => <Avatar key={m.id} name={m.name} size={24} />)}</div>
              <small className="muted">{g.members.length} {g.members.length === 1 ? 'member' : 'members'} · {solo ? 'invite friends →' : `${formatINR(totalSpent)} spent`}</small>
            </button>
          </div>
        </div>

        <div className="status">
          {me > 0 && <><span className="muted">You get back</span><CountUp className="num pos" value={me} /></>}
          {me < 0 && <><span className="muted">You owe</span><CountUp className="num neg" value={-me} /></>}
          {me === 0 && <span className="num" style={{ fontSize: '1.4rem' }}>{g.expenses.length ? 'All settled up ✨' : 'Fresh start ✨'}</span>}
        </div>
        <div className="hero-actions">
          {solo ? (
            <button className="btn primary" onClick={() => setModal({ type: 'members' })}>👋 Invite friends</button>
          ) : myPay ? (
            <button className="btn primary" onClick={() => setModal({ type: 'settle', payment: myPay })}>💸 Settle up {formatINR(myPay.amount)}</button>
          ) : owedPay ? (
            <button className="btn" onClick={() => setModal({ type: 'settle', payment: owedPay })}>🔔 Remind {nameOf(g, owedPay.from, user.id).split(' ')[0]}</button>
          ) : null}
        </div>

        {budget > 0 ? (
          <div className="budget">
            <div className="row-between small">
              <span className="muted">Budget {isAdmin && <button className="link small" onClick={setBudget}>edit</button>}</span>
              <span><strong className="num">{formatINR(totalSpent)}</strong> <span className="muted">/ {formatINR(budget)}</span></span>
            </div>
            <div className="budget-track"><span className={totalSpent > budget ? 'over' : ''} style={{ width: `${Math.min(100, (totalSpent / budget) * 100)}%` }} /></div>
            <small className={totalSpent > budget ? 'neg' : 'muted'}>
              {totalSpent > budget ? `⚠️ ${formatINR(totalSpent - budget)} over budget` : `${formatINR(budget - totalSpent)} left · ${Math.round((totalSpent / budget) * 100)}% used`}
            </small>
          </div>
        ) : isAdmin && g.expenses.length > 0 && (
          <button className="link small" style={{ marginTop: 12 }} onClick={setBudget}>🎯 Set a budget</button>
        )}
      </section>

      {!solo && <TripTracker g={g} me={user.id} onChanged={g.reload} />}

      {g.expenses.length > 0 && (
        <section className="fun-strip">
          <button onClick={() => setModal({ type: 'wrapped' })}><span>🎬</span>Trip Wrapped</button>
          {!solo && <button onClick={() => setModal({ type: 'wheel' })}><span>🎡</span>Who pays next?</button>}
          <button onClick={() => window.open(whatsappSummary(g), '_blank', 'noopener')}><span>💬</span>Share summary</button>
          <button onClick={() => setModal({ type: 'members' })}><span>👥</span>Invite</button>
        </section>
      )}

      <nav className="tabs">
        {[['activity', 'Activity'], ['balances', 'Balances'], ['insights', 'Insights']].map(([t, label]) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{label}</button>
        ))}
      </nav>

      {tab === 'activity' && (
        <section className="list">
          {feed.length > 2 && (
            <div className="row-between">
              {searching ? (
                <input className="search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search dishes, people, places…" />
              ) : <span className="muted small">{g.expenses.length} expenses</span>}
              <button className="icon-btn" onClick={() => { setSearching(!searching); setQuery(''); setCatFilter(null) }} aria-label={searching ? 'Close search' : 'Search'}>{searching ? '✕' : '🔍'}</button>
            </div>
          )}
          {searching && usedCats.length > 1 && (
            <div className="chips small-chips">
              {usedCats.map((c) => (
                <button key={c} className={`chip ${catFilter === c ? 'on' : ''}`} onClick={() => setCatFilter(catFilter === c ? null : c)}>
                  {category(c).icon} {category(c).label}
                </button>
              ))}
            </div>
          )}
          {feed.length > 0 && shown.length === 0 && <p className="muted center-text">Nothing matches.</p>}
          {feed.length === 0 && (
            <div className="empty card stack" style={{ alignItems: 'center' }}>
              <div className="empty-emoji">🍽️</div>
              <h3 style={{ color: 'var(--ink)' }}>{solo ? 'Invite your friends first' : 'No expenses yet'}</h3>
              <p>{solo ? 'Share the invite link, then add your first bill together.' : 'Tap the ＋ button to split your first bill.'}</p>
              {solo
                ? <button className="btn primary" onClick={() => setModal({ type: 'members' })}>👋 Invite friends</button>
                : <button className="btn primary" onClick={() => setModal({ type: 'add' })}>＋ Add the first expense</button>}
            </div>
          )}
          {days.map((d) => (
            <div key={d.day} className="day-group">
              <div className="day-label">{dayLabel(d.day)}</div>
              {d.items.map((f) => f.kind === 'expense'
                ? <ExpenseRow key={f.e.id} e={f.e} g={g} me={user.id} onClick={() => setModal({ type: 'view', expense: f.e })} />
                : <SettleRow key={f.s.id} s={f.s} g={g} me={user.id} />)}
            </div>
          ))}
        </section>
      )}

      {tab === 'balances' && (
        <section className="stack">
          <DebtGraph g={g} me={user.id} />
          <div className="card stack">
            <h3>Who pays whom</h3>
            {g.payments.length === 0 && <p className="muted">Nobody owes anything 🎉</p>}
            {g.payments.map((p, i) => (
              <div key={i} className="flow">
                <span className="who"><Avatar name={g.byId[p.from]?.name} size={36} />{nameOf(g, p.from, user.id)}</span>
                <span className="arrow"><span className="amt">{formatINR(p.amount)}</span></span>
                <span className="who"><Avatar name={g.byId[p.to]?.name} size={36} />{nameOf(g, p.to, user.id)}</span>
                {(p.from === user.id || p.to === user.id) && (
                  <button className="btn small primary" onClick={() => setModal({ type: 'settle', payment: p })}>{p.from === user.id ? 'Pay' : 'Remind'}</button>
                )}
              </div>
            ))}
          </div>
          <div className="card stack-sm">
            <h3 style={{ marginBottom: 6 }}>Everyone's balance</h3>
            {g.members.map((m) => (
              <div key={m.id} className="pay-row" style={{ padding: '6px 0' }}>
                <Avatar name={m.name} size={30} />
                <span className="grow">{m.id === user.id ? 'You' : m.name}</span>
                <BalanceTag paise={g.balances[m.id] || 0} />
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === 'insights' && (
        <>
          <SplitScore g={g} me={user.id} />
          <Insights g={g} me={user.id} />
          {g.expenses.length > 0 && <button className="btn" onClick={() => exportCsv(g)}>⬇ Download all expenses (Excel / CSV)</button>}
        </>
      )}

      {!solo && (
        <button className="fab" onClick={() => setModal({ type: 'add' })} aria-label="Add an expense">＋</button>
      )}

      {modal?.type === 'add' && <AddChooser onPick={(mode) => setModal({ type: 'expense', mode })} onClose={close} />}
      {modal?.type === 'expense' && (
        <ExpenseForm g={g} me={user.id} expense={modal.expense} startMode={modal.mode} onClose={close} onSaved={saved} />
      )}
      {modal?.type === 'settle' && (
        <SettleUp g={g} me={user.id} preset={modal.payment} onClose={close} onSaved={() => { confetti(); toast('Payment recorded. You’re square! 🎉', '🎉'); saved() }} />
      )}
      {modal?.type === 'members' && <Modal title="Members & invite" onClose={close}><Members g={g} me={user.id} /></Modal>}
      {modal?.type === 'wheel' && <SpinWheel g={g} me={user.id} onClose={close} />}
      {modal?.type === 'wrapped' && <Wrapped g={g} me={user.id} onClose={close} />}
      {modal?.type === 'view' && (
        <ExpenseDetail e={modal.expense} g={g} me={user.id} onClose={close}
          onEdit={() => setModal({ type: 'expense', expense: modal.expense })}
          onDeleted={() => { toast('Expense deleted', '🗑️'); saved() }} />
      )}
    </div>
  )
}

/** The ＋ button opens three clear choices. */
function AddChooser({ onPick, onClose }) {
  const opts = [
    { mode: 'itemized', icon: '🧾', title: 'Split a bill', sub: 'Restaurant or shared order: tap who had what', hot: true },
    { mode: 'quick', icon: '⚡', title: 'Quick add', sub: 'Cab, groceries, tickets: type it, say it, done' },
    { mode: 'host', icon: '🙈', title: 'I’m treating', sub: 'Host Mode: you pay, prices stay hidden from guests' },
  ]
  return (
    <Modal title="What are we adding?" onClose={onClose}>
      <div className="stack-sm">
        {opts.map((o) => (
          <button key={o.mode} className={`chooser ${o.hot ? 'hot' : ''}`} onClick={() => { haptic(); onPick(o.mode === 'quick' ? undefined : o.mode) }}>
            <span className="chooser-ico">{o.icon}</span>
            <span className="grow"><strong>{o.title}</strong><small className="muted">{o.sub}</small></span>
            <span className="muted">→</span>
          </button>
        ))}
      </div>
    </Modal>
  )
}

/** Animated number for the hero balance: counts up on load. */
function CountUp({ value, className }) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    let raf, start
    const dur = 700
    const step = (t) => {
      if (!start) start = t
      const k = Math.min(1, (t - start) / dur)
      setShown(Math.round(value * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <span className={className}>{formatINR(shown)}</span>
}

function GroupSkeleton() {
  return (
    <div className="stack-lg">
      <div className="skeleton" style={{ height: 210, borderRadius: 26 }} />
      <div className="skeleton" style={{ height: 44, borderRadius: 999 }} />
      {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 70, borderRadius: 20 }} />)}
    </div>
  )
}

function dayLabel(d) {
  const t = new Date(); const ymd = (x) => new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  const today = ymd(t); const y = new Date(t); y.setDate(t.getDate() - 1)
  if (d === today) return 'Today'
  if (d === ymd(y)) return 'Yesterday'
  return new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

const nameOf = (g, id, me) => (id === me ? 'You' : g.byId[id]?.name || 'Former member')

function ExpenseRow({ e, g, me, onClick }) {
  const c = category(e.category)
  if (e.items?.host_mode && e.paid_by !== me) {
    return (
      <button className="list-item card hosted" onClick={onClick}>
        <span className="cat-icon">🎁</span>
        <span className="grow">
          <strong>{e.description}</strong>
          <small className="muted">Treat by {nameOf(g, e.paid_by, me)} · {fmtDate(e.expense_date)} · 🙈 host mode</small>
        </span>
        <span style={{ textAlign: 'right' }}>
          <strong className="num" style={{ display: 'block' }}>₹ ••••</strong>
          <small className="pos">you owe ₹0</small>
        </span>
      </button>
    )
  }
  const mine = (e.expense_splits.find((s) => s.user_id === me)?.share_paise || 0)
  const net = (e.paid_by === me ? e.amount_paise : 0) - mine
  return (
    <button className="list-item card" onClick={onClick}>
      <span className="cat-icon" style={{ background: c.color + '26' }}>{c.icon}</span>
      <span className="grow">
        <strong>{e.description}</strong>
        <small className="muted">{nameOf(g, e.paid_by, me)} paid · {fmtDate(e.expense_date)}{e.split_type === 'itemized' ? ' · 🧾 itemized' : ''}</small>
      </span>
      <span style={{ textAlign: 'right' }}>
        <strong className="num" style={{ display: 'block' }}>{formatINR(e.amount_paise)}</strong>
        <small className={net > 0 ? 'pos' : net < 0 ? 'neg' : 'muted'}>
          {net > 0 ? `you lent ${formatINR(net)}` : net < 0 ? `you owe ${formatINR(-net)}` : 'not involved'}
        </small>
      </span>
    </button>
  )
}

function SettleRow({ s, g, me }) {
  return (
    <div className="list-item card settle-item">
      <span className="cat-icon">💸</span>
      <span className="grow">
        <strong>{nameOf(g, s.from_user, me)} paid {nameOf(g, s.to_user, me)}</strong>
        <small className="muted">{s.method.toUpperCase()} · {fmtDate(s.created_at)}{s.note ? ` · ${s.note}` : ''}</small>
      </span>
      <strong className="pos">{formatINR(s.amount_paise)}</strong>
    </div>
  )
}

function ExpenseDetail({ e, g, me, onClose, onEdit, onDeleted }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const canEdit = e.created_by === me || e.paid_by === me || g.byId[me]?.role === 'admin'
  async function del() {
    if (!window.confirm('Delete this expense? This cannot be undone.')) return
    setBusy(true)
    const { error } = await callRpc('delete_expense', { p_expense_id: e.id })
    setBusy(false)
    if (error) return setErr(niceError(error))
    onDeleted()
  }
  const items = e.items?.items || []
  const guestView = !!e.items?.host_mode && e.paid_by !== me
  const money = (p) => (guestView ? '••••' : (p / 100).toFixed(2))
  const max = Math.max(1, ...e.expense_splits.map((s) => s.share_paise))
  const first = (id) => (id === me ? 'You' : g.byId[id]?.name?.split(' ')[0] || '?')
  return (
    <Modal title={e.description} onClose={onClose}>
      <div className="stack">
        <div className="row-between">
          <span className="muted small">{category(e.category).icon} {category(e.category).label} · {fmtDate(e.expense_date)}</span>
          <span className="tag">{e.split_type === 'itemized' ? '🧾 itemized' : e.split_type}</span>
        </div>

        {items.length > 0 ? (
          <div className="receipt">
            <div className="r-title">{e.description}</div>
            <div className="r-sub">paid by {nameOf(g, e.paid_by, me)} · {fmtDate(e.expense_date)}</div>
            {items.map((it, i) => (
              <div key={i}>
                <div className="r-row"><span>{it.qty > 1 ? `${it.qty}× ` : ''}{it.name}</span><span>{money(it.amount_paise)}</span></div>
                <div className="r-who">
                  {Object.entries(it.weights).map(([id, w]) => (
                    <span key={id} className={`r-chip ${g.byId[id]?.diet || ''}`}>{first(id)}{w !== 1 ? ` ×${w}` : ''}</span>
                  ))}
                </div>
              </div>
            ))}
            <hr />
            {['tax', 'service', 'tip', 'discount'].map((k) => e.items[`${k}_paise`] ? (
              <div key={k} className="r-row"><span>{{ tax: 'GST', service: 'Service charge', tip: 'Tip', discount: 'Discount' }[k]}</span><span>{k === 'discount' ? '-' : ''}{money(e.items[`${k}_paise`])}</span></div>
            ) : null)}
            {(e.items.treat_ids || []).length > 0 && (
              <div className="r-row"><span>🎂 Treat for {e.items.treat_ids.map(first).join(', ')}</span><span>covered</span></div>
            )}
            <div className="r-row r-total"><span>TOTAL</span><span>₹{money(e.amount_paise)}</span></div>
            {e.items.host_mode && <div className="r-sub" style={{ marginTop: 8 }}>🎁 Hosted by {nameOf(g, e.paid_by, me)}. Guests pay nothing.</div>}
          </div>
        ) : (
          <div className="card flat"><span className="muted small">Paid by {nameOf(g, e.paid_by, me)}</span><div className="num" style={{ fontSize: '2rem', fontWeight: 700 }}>{formatINR(e.amount_paise)}</div></div>
        )}

        {!e.items?.host_mode && <div className="stack-sm" style={{ marginTop: 8 }}>
          <h4>Each person's share</h4>
          <div className="share-bars">
            {[...e.expense_splits].sort((a, b) => b.share_paise - a.share_paise).map((s) => (
              <div key={s.user_id} className="share-bar">
                <Avatar name={g.byId[s.user_id]?.name} size={26} />
                <span>{first(s.user_id)}</span>
                <span className="track"><span className="fill" style={{ width: `${(s.share_paise / max) * 100}%` }} /></span>
                <strong className="num">{formatINR(s.share_paise)}</strong>
              </div>
            ))}
          </div>
          {items.length > 0 && <p className="muted small">GST and service charge are shared in proportion to what each person ate.</p>}
        </div>}
        {e.notes && <p className="muted">{e.notes}</p>}
        {err && <p className="note err">{err}</p>}
        {canEdit && (
          <div className="row">
            <button className="btn" onClick={onEdit}>Edit</button>
            <button className="btn danger-ghost" onClick={del} disabled={busy}>Delete</button>
          </div>
        )}
      </div>
    </Modal>
  )
}

function Members({ g, me }) {
  const nav = useNavigate()
  const [copied, setCopied] = useState(false)
  const link = appUrl(`/join/${g.group.invite_code}`)
  const isAdmin = g.byId[me]?.role === 'admin'

  async function share() {
    const text = `Join "${g.group.name}" on SplitMate to split expenses: ${link}`
    if (navigator.share) {
      try { await navigator.share({ title: 'SplitMate', text, url: link }); return } catch { /* cancelled */ }
    }
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function remove(uid) {
    const bal = g.balances[uid] || 0
    if (bal !== 0) return alert(`Settle ${formatINR(bal)} first — balances must be zero before leaving.`)
    if (!window.confirm(uid === me ? 'Leave this group?' : 'Remove this member?')) return
    const { error } = await callRpc('remove_member', { p_group_id: g.group.id, p_user_id: uid })
    if (error) return alert(niceError(error))
    if (uid === me) nav('/')
    else g.reload()
  }

  return (
    <section className="stack">
      <div className="card stack">
        <h3>Invite friends</h3>
        <p className="muted small">Share this link on WhatsApp. Code: <strong className="mono">{g.group.invite_code}</strong></p>
        <div className="row">
          <input readOnly value={link} onFocus={(e) => e.target.select()} />
          <button className="btn primary" onClick={share}>{copied ? 'Copied ✓' : 'Share'}</button>
        </div>
        <a className="btn whatsapp" target="_blank" rel="noreferrer"
          href={`https://wa.me/?text=${encodeURIComponent(`Join "${g.group.name}" on SplitMate: ${link}`)}`}>Share on WhatsApp</a>
      </div>
      <div className="card stack">
        <h3>{g.members.length} members</h3>
        {g.members.map((m) => (
          <div key={m.id} className="pay-row">
            <Avatar name={m.name} size={32} />
            <span className="grow">
              {m.id === me ? `${m.name} (you)` : m.name}
              <small className="muted"> {m.role === 'admin' ? '· admin' : ''}{m.diet ? ` · ${m.diet}` : ''}{m.upi_id ? ' · UPI ✓' : ''}</small>
            </span>
            {(m.id === me || isAdmin) && <button className="btn small danger-ghost" onClick={() => remove(m.id)}>{m.id === me ? 'Leave' : 'Remove'}</button>}
          </div>
        ))}
      </div>
    </section>
  )
}

export const fmtDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
