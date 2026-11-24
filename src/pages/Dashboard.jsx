import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, niceError, callRpc } from '../lib/supabase.js'
import { formatINR } from '../lib/money.js'
import { useAuth } from '../auth.jsx'
import Modal from '../components/Modal.jsx'
import Welcome, { shouldShowTour, markTourSeen } from '../components/Welcome.jsx'

const EMOJIS = ['👥', '🏖️', '🏠', '🍕', '⚽', '✈️', '🎉', '🚗', '🏕️', '💼']

export default function Dashboard() {
  const { profile, user, isDemo, refreshProfile } = useAuth()
  const nav = useNavigate()
  const [groups, setGroups] = useState(null)
  const [error, setError] = useState(null)
  const [show, setShow] = useState(null) // 'create' | 'join'
  const [tour, setTour] = useState(false)
  const [tourChecked, setTourChecked] = useState(false)
  useEffect(() => {
    if (tourChecked || !user || (!profile && !isDemo)) return
    setTour(shouldShowTour({ user, profile, isDemo }))
    setTourChecked(true)
  }, [user, profile, isDemo, tourChecked])
  const seen = () => markTourSeen({ user, isDemo, refreshProfile })
  const [sampleBusy, setSampleBusy] = useState(false)
  const [hideChecklist, setHideChecklist] = useState(() => { try { return localStorage.getItem('splitmate_checklist_done') === '1' } catch { return false } })

  async function createSample() {
    setTour(false)
    setSampleBusy(true)
    const { data, error } = await callRpc('create_sample_group')
    setSampleBusy(false)
    if (error) return setError(niceError(error))
    nav(`/g/${data}`)
  }

  async function load() {
    const { data, error } = await callRpc('my_groups')
    if (error) setError(niceError(error))
    else setGroups(data)
  }
  useEffect(() => { load() }, [])

  const owed = (groups || []).filter((g) => g.my_balance > 0).reduce((a, g) => a + Number(g.my_balance), 0)
  const owe = (groups || []).filter((g) => g.my_balance < 0).reduce((a, g) => a - Number(g.my_balance), 0)

  const net = owed - owe

  return (
    <div className="stack-lg fade-in">
      <section>
        <p className="hello">Hey {profile?.display_name?.split(' ')[0] || 'there'} 👋</p>
        <h1 className="page-title">Your money, settled.</h1>
      </section>

      <section className="hero-card">
        <span className="label">Overall balance</span>
        <div className="hero-amount">{net >= 0 ? '+' : '−'}{formatINR(Math.abs(net))}</div>
        <div className="hero-split">
          <div className="hero-pill"><small>You are owed</small><strong>{formatINR(owed)}</strong></div>
          <div className="hero-pill"><small>You owe</small><strong>{formatINR(owe)}</strong></div>
        </div>
      </section>

      {groups && !hideChecklist && user?.email !== import.meta.env.VITE_DEMO_EMAIL && (() => {
        const steps = [
          { done: groups.length > 0, label: 'Create or join a group', action: () => setShow('create') },
          { done: groups.some((x) => x.member_count > 1 && !x.name.endsWith('(sample)')), label: 'Invite a friend with the WhatsApp link', action: () => groups[0] && nav(`/g/${groups[0].id}`) },
          { done: !!profile?.upi_id, label: 'Add your UPI ID so friends can pay you', action: () => nav('/profile') },
          { done: !!profile?.diet, label: 'Set Veg / Non-veg for faster bill splits', action: () => nav('/profile') },
        ]
        const doneCount = steps.filter((x) => x.done).length
        if (doneCount === steps.length) return null
        return (
          <section className="card stack-sm checklist">
            <div className="row-between">
              <h3>🚀 Get started <span className="muted small">{doneCount}/{steps.length}</span></h3>
              <button className="link small" onClick={() => { try { localStorage.setItem('splitmate_checklist_done', '1') } catch { /* */ } setHideChecklist(true) }}>Hide</button>
            </div>
            <div className="progress"><span style={{ width: `${(doneCount / steps.length) * 100}%` }} /></div>
            {steps.map((x) => (
              <button key={x.label} className={`check-step ${x.done ? 'done' : ''}`} onClick={x.done ? undefined : x.action} disabled={x.done}>
                <span className="tick">{x.done ? '✓' : ''}</span><span>{x.label}</span>{!x.done && <span className="muted">→</span>}
              </button>
            ))}
          </section>
        )
      })()}

      <section className="stack">
        <div className="section-head">
          <h2>Groups</h2>
          <div className="row">
            <button className="btn" onClick={() => setShow('join')}>Join</button>
            <button className="btn primary" onClick={() => setShow('create')}>+ New group</button>
          </div>
        </div>

        {error && <p className="note err">{error}</p>}
        {groups === null && !error && <p className="muted">Loading…</p>}
        {groups?.length === 0 && (
          <div className="empty card stack" style={{ alignItems: 'center' }}>
            <div className="empty-emoji">🧾</div>
            <h3 style={{ color: 'var(--ink)' }}>No groups yet</h3>
            <p>Create one for your trip, flat or dinner, then share the invite link on WhatsApp. Want to look around first? Open a sample trip with 3 friends.</p>
            <div className="row wrap" style={{ justifyContent: 'center' }}>
              <button className="btn primary" onClick={() => setShow('create')}>+ Create a group</button>
              <button className="btn" onClick={createSample} disabled={sampleBusy}>{sampleBusy ? 'Setting up…' : '🏖️ Explore a sample trip'}</button>
            </div>
          </div>
        )}
        <div className="list">
          {groups?.map((g) => (
            <Link key={g.id} to={`/g/${g.id}`} className="list-item card">
              <span className="group-tile">{g.emoji}</span>
              <span className="grow">
                <strong style={{ fontFamily: 'var(--display)', fontSize: '1.08rem' }}>{g.name}</strong>
                <small className="muted">{g.member_count} member{g.member_count === 1 ? '' : 's'} · active {timeAgo(g.last_activity)}</small>
              </span>
              <BalanceTag paise={Number(g.my_balance)} />
            </Link>
          ))}
        </div>
      </section>

      {tour && groups !== null && <Welcome hasGroups={groups.length > 0} onSample={isDemo ? undefined : createSample} onSeen={seen} onClose={() => setTour(false)} />}
      {show === 'create' && <CreateGroup onClose={() => setShow(null)} onDone={(id) => nav(`/g/${id}`)} />}
      {show === 'join' && <JoinGroup onClose={() => setShow(null)} onDone={(id) => nav(`/g/${id}`)} />}
    </div>
  )
}

function timeAgo(t) {
  const d = (Date.now() - new Date(t).getTime()) / 864e5
  if (d < 1) return 'today'
  if (d < 2) return 'yesterday'
  return `${Math.floor(d)} days ago`
}

export function BalanceTag({ paise }) {
  if (!paise) return <span className="tag">settled</span>
  return paise > 0
    ? <span className="tag pos">gets {formatINR(paise)}</span>
    : <span className="tag neg">owes {formatINR(-paise)}</span>
}

function CreateGroup({ onClose, onDone }) {
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('👥')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  async function submit(e) {
    e.preventDefault()
    if (!name.trim()) return setErr('Give the group a name')
    setBusy(true)
    const { data, error } = await callRpc('create_group', { p_name: name, p_emoji: emoji })
    setBusy(false)
    if (error) return setErr(niceError(error))
    onDone(data)
  }
  return (
    <Modal title="New group" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <label>Name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} placeholder="Goa trip, Flat 302, Potato FC…" /></label>
        <div className="emoji-pick">
          {EMOJIS.map((x) => (
            <button type="button" key={x} className={x === emoji ? 'on' : ''} onClick={() => setEmoji(x)}>{x}</button>
          ))}
        </div>
        {err && <p className="note err">{err}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create group'}</button>
      </form>
    </Modal>
  )
}

function JoinGroup({ onClose, onDone }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    // accept a full invite link too
    const c = code.trim().split('/').pop()
    const { data, error } = await callRpc('join_group', { code: c })
    setBusy(false)
    if (error) return setErr(niceError(error))
    onDone(data)
  }
  return (
    <Modal title="Join a group" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <label>Invite code or link<input autoFocus value={code} onChange={(e) => setCode(e.target.value)} required placeholder="AB12CD34" /></label>
        {err && <p className="note err">{err}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Joining…' : 'Join'}</button>
      </form>
    </Modal>
  )
}
