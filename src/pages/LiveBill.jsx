import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { supabase, callRpc, niceError, appUrl, isUuid } from '../lib/supabase.js'
import { useGroup } from '../hooks/useGroup.js'
import { useAuth } from '../auth.jsx'
import { computeItemized } from '../lib/splits.js'
import { formatINR } from '../lib/money.js'
import { haptic, toast, confetti } from '../lib/fun.js'
import Avatar from '../components/Avatar.jsx'
import QRCode from '../components/QRCode.jsx'

/**
 * 📲 Live Table Mode: everyone opens this page (QR or link) and taps their OWN dishes.
 * The host sees taps arrive live, fills any gaps, adds GST and saves it as one itemized expense.
 */
export default function LiveBill() {
  const { id } = useParams()
  const nav = useNavigate()
  const { user } = useAuth()
  const me = user.id
  const [bill, setBill] = useState(null)
  const [claims, setClaims] = useState([])
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [showQr, setShowQr] = useState(true)
  const [assignFor, setAssignFor] = useState(null) // host: tapping on behalf of this person
  const [overrides, setOverrides] = useState({}) // host fills: { itemKey: { userId: weight } }
  const g = useGroup(bill?.group_id)

  const load = useCallback(async () => {
    if (!isUuid(id)) return setErr('This bill link looks broken')
    const [b, c] = await Promise.all([
      supabase.from('live_bills').select('*').eq('id', id).maybeSingle(),
      supabase.from('live_claims').select('*').eq('bill_id', id),
    ])
    if (b.error) return setErr(niceError(b.error))
    if (!b.data) return setErr('Bill not found. You need to be in the group first: ask the host for the group invite link.')
    setBill(b.data)
    if (!c.error) setClaims(c.data)
  }, [id])

  // live: poll every 2s while open (works even if realtime is down)
  useEffect(() => {
    load()
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 2000)
    return () => clearInterval(t)
  }, [load])

  const isHost = bill?.host === me
  const open = bill?.status === 'open'
  const name = (uid) => (uid === me ? 'You' : g.byId?.[uid]?.name?.split(' ')[0] || 'Someone')

  // claims + host overrides → weights per item
  const weights = useMemo(() => {
    const w = {}
    for (const it of bill?.items || []) w[it.key] = {}
    for (const c of claims) if (w[c.item_key]) w[c.item_key][c.user_id] = Number(c.weight)
    for (const [k, per] of Object.entries(overrides)) for (const [uid, v] of Object.entries(per)) {
      if (!w[k]) continue
      if (v > 0) w[k][uid] = v
      else delete w[k][uid]
    }
    return w
  }, [bill, claims, overrides])

  const extras = bill?.extras || {}
  const result = useMemo(() => bill && computeItemized({
    items: bill.items.map((it) => ({ name: it.name, amount_paise: it.amount_paise, weights: weights[it.key] || {} })).filter((it) => Object.keys(it.weights).length),
    tax_paise: extras.tax_paise || 0, service_paise: extras.service_paise || 0, tip_paise: extras.tip_paise || 0, discount_paise: extras.discount_paise || 0,
  }), [bill, weights, extras])
  const unclaimed = (bill?.items || []).filter((it) => !Object.keys(weights[it.key] || {}).length)
  const total = (bill?.items || []).reduce((a, it) => a + it.amount_paise, 0) + (extras.tax_paise || 0) + (extras.service_paise || 0) + (extras.tip_paise || 0) - (extras.discount_paise || 0)

  async function tap(it) {
    if (!open) return
    haptic()
    const target = isHost && assignFor ? assignFor : me
    const cur = weights[it.key]?.[target] || 0
    const next = cur === 0 ? 1 : cur === 1 ? 2 : 0
    if (target !== me) { // host filling in for someone (stays local until save)
      setOverrides((o) => ({ ...o, [it.key]: { ...(o[it.key] || {}), [target]: next } }))
      return
    }
    setClaims((cs) => { // optimistic
      const rest = cs.filter((c) => !(c.item_key === it.key && c.user_id === me))
      return next ? [...rest, { bill_id: id, user_id: me, item_key: it.key, weight: next }] : rest
    })
    const { error } = await callRpc('claim_item', { p_bill_id: id, p_item_key: it.key, p_weight: next })
    if (error) { toast(niceError(error), '⚠️'); load() }
  }

  async function setExtra(field, rate) {
    const sub = (bill.items || []).reduce((a, it) => a + it.amount_paise, 0)
    const next = { ...extras, [field]: rate === null ? 0 : Math.round((sub * rate) / 100) }
    haptic()
    setBill((b) => ({ ...b, extras: next }))
    const { error } = await callRpc('set_live_extras', { p_bill_id: id, p_extras: next })
    if (error) toast(niceError(error), '⚠️')
  }

  async function finalize() {
    if (!result || result.error) return toast(result?.error || 'Someone still needs to tap', '⚠️')
    if (unclaimed.length && !window.confirm(`${unclaimed.length} item(s) nobody tapped will be left out. Save anyway?`)) return
    setBusy(true)
    const items = bill.items.filter((it) => Object.keys(weights[it.key] || {}).length)
      .map((it) => ({ name: it.name, qty: it.qty || 1, amount_paise: it.amount_paise, weights: weights[it.key] }))
    const { data: eid, error } = await callRpc('save_expense', {
      p_group_id: bill.group_id, p_description: bill.title, p_amount: result.total, p_paid_by: bill.host,
      p_category: 'food', p_split_type: 'itemized', p_date: null, p_splits: result.splits,
      p_notes: '📲 split live at the table', p_expense_id: null,
      p_items: { items, tax_paise: extras.tax_paise || 0, service_paise: extras.service_paise || 0, tip_paise: extras.tip_paise || 0, discount_paise: extras.discount_paise || 0, treat_ids: [], host_mode: false },
    })
    if (error) { setBusy(false); return toast(niceError(error), '⚠️') }
    await callRpc('close_live_bill', { p_bill_id: id, p_expense_id: eid })
    setBusy(false)
    confetti(); haptic(30)
    toast('Bill saved. Everyone’s share is in the group 🎉', '🎉')
    nav(`/g/${bill.group_id}`)
  }

  async function cancel() {
    if (!window.confirm('Cancel this live bill? Nothing will be saved.')) return
    await callRpc('close_live_bill', { p_bill_id: id, p_expense_id: null })
    nav(`/g/${bill.group_id}`)
  }

  if (err) return <div className="stack"><p className="note err">{err}</p><Link to="/" className="btn">Home</Link></div>
  if (!bill) return <div className="skeleton" style={{ height: 300, borderRadius: 24 }} />

  if (!open) {
    return (
      <div className="stack center-text" style={{ alignItems: 'center', paddingTop: 30 }}>
        <div style={{ fontSize: '3rem' }}>{bill.expense_id ? '✅' : '🚫'}</div>
        <h2>{bill.expense_id ? 'This bill is saved' : 'This bill was cancelled'}</h2>
        <p className="muted">{bill.expense_id ? 'Your share is now in the group balances.' : 'Nothing was added.'}</p>
        <Link className="btn primary" to={`/g/${bill.group_id}`}>Open the group</Link>
      </div>
    )
  }

  const link = appUrl(`/bill/${id}`)
  const mineTotal = result?.perPerson?.[me]?.total || 0
  return (
    <div className="stack-lg fade-in live-page">
      <section className="group-hero">
        <Link to={`/g/${bill.group_id}`} className="back">← {g.group?.name || 'Group'}</Link>
        <div className="row-between" style={{ marginTop: 10 }}>
          <div>
            <span className="live-tag"><span className="live-dot pulse" /> LIVE BILL</span>
            <h1 style={{ fontSize: '1.5rem', marginTop: 6 }}>{bill.title}</h1>
            <small className="muted">Hosted by {name(bill.host)} · total {formatINR(total)}</small>
          </div>
          {isHost && <button className="link small" onClick={() => setShowQr(!showQr)}>{showQr ? 'Hide QR' : 'Show QR'}</button>}
        </div>
        {isHost && showQr && (
          <div className="qr-wrap">
            <QRCode text={link} size={200} />
            <div className="stack-sm">
              <strong>Everyone: scan & tap your dishes</strong>
              <small className="muted">Friends in this group open the link, tap what they ate, and their taps show up here instantly.</small>
              <button className="btn small" onClick={async () => { await navigator.clipboard?.writeText(link); toast('Link copied', '🔗') }}>Copy link</button>
              <a className="btn small whatsapp" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`Tap what you ate at ${bill.title}: ${link}`)}`}>Send on WhatsApp</a>
            </div>
          </div>
        )}
        <div className="live-mine">
          <span className="muted">{isHost && assignFor ? `Tapping for ${name(assignFor)}` : 'Your share so far'}</span>
          <strong className="num">{formatINR(isHost && assignFor ? (result?.perPerson?.[assignFor]?.total || 0) : mineTotal)}</strong>
        </div>
      </section>

      {isHost && (
        <div className="stack-sm">
          <span className="label">Host: fill in for someone without a phone</span>
          <div className="chips">
            <button className={`chip ${!assignFor ? 'on' : ''}`} onClick={() => setAssignFor(null)}>Me</button>
            {(g.members || []).filter((m) => m.id !== me).map((m) => (
              <button key={m.id} className={`chip ${assignFor === m.id ? 'on' : ''}`} onClick={() => setAssignFor(m.id)}>
                <Avatar name={m.name} size={18} /> {m.name.split(' ')[0]}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="tap-hint">Tap what <strong>{isHost && assignFor ? name(assignFor) : 'you'}</strong> ate · tap again for <strong>×2</strong></p>
      <div className="dish-grid">
        {bill.items.map((it) => {
          const w = weights[it.key] || {}
          const who = isHost && assignFor ? assignFor : me
          const ids = Object.keys(w)
          return (
            <div key={it.key} className={`dish ${w[who] ? 'on' : ''} ${!ids.length ? 'unclaimed' : ''}`} role="button" tabIndex={0}
              onClick={() => tap(it)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), tap(it))}>
              {w[who] > 1 && <span className="dish-x">×{w[who]}</span>}
              <strong>{it.qty > 1 ? `${it.qty}× ` : ''}{it.name}</strong>
              <small className="muted">{formatINR(it.amount_paise)}</small>
              <div className="dish-foot">
                <div className="avatar-stack">{ids.slice(0, 5).map((uid) => <Avatar key={uid} name={g.byId?.[uid]?.name || '?'} size={22} />)}</div>
                {!ids.length && <small className="warn-text">nobody yet</small>}
              </div>
            </div>
          )
        })}
      </div>

      <section className="card stack-sm">
        <div className="row-between"><h3>Live split</h3><small className="muted">{claims.length ? `updated ${new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}` : 'waiting for taps…'}</small></div>
        {isHost && (
          <div className="chips small-chips">
            <button className="chip ghost" onClick={() => setExtra('tax_paise', 5)}>GST 5%</button>
            <button className="chip ghost" onClick={() => setExtra('service_paise', 10)}>Service 10%</button>
            <button className="chip ghost" onClick={() => setExtra('tip_paise', 5)}>Tip 5%</button>
            {(extras.tax_paise || extras.service_paise || extras.tip_paise) ? <button className="chip ghost" onClick={() => { setExtra('tax_paise', null); setExtra('service_paise', null); setExtra('tip_paise', null) }}>Clear extras</button> : null}
          </div>
        )}
        {(extras.tax_paise || extras.service_paise || extras.tip_paise) ? (
          <small className="muted">Extras: {[extras.tax_paise && `GST ${formatINR(extras.tax_paise)}`, extras.service_paise && `service ${formatINR(extras.service_paise)}`, extras.tip_paise && `tip ${formatINR(extras.tip_paise)}`].filter(Boolean).join(' · ')}, shared by what each person ate</small>
        ) : null}
        {Object.entries(result?.perPerson || {}).sort((a, b) => b[1].total - a[1].total).map(([uid, p]) => (
          <div key={uid} className="pay-row">
            <Avatar name={g.byId?.[uid]?.name || '?'} size={30} />
            <span className="grow">{name(uid)}</span>
            <strong className="num">{formatINR(p.total)}</strong>
          </div>
        ))}
        {!Object.keys(result?.perPerson || {}).length && <p className="muted small">Nobody has tapped yet. Scan the QR!</p>}
        {unclaimed.length > 0 && <p className="note warn small">{unclaimed.length} dish{unclaimed.length > 1 ? 'es' : ''} still need{unclaimed.length > 1 ? '' : 's'} someone</p>}
      </section>

      {isHost ? (
        <div className="row sticky-foot" style={{ position: 'sticky', bottom: 12, background: 'transparent', border: 0 }}>
          <button className="btn" onClick={cancel}>Cancel</button>
          <button className="btn primary" style={{ flex: 1 }} disabled={busy || !result || !!result.error} onClick={finalize}>
            {busy ? 'Saving…' : `Save bill · ${formatINR(result?.total || 0)}`}
          </button>
        </div>
      ) : (
        <p className="muted small center-text">The host saves the bill when everyone’s done. Your share then appears in the group.</p>
      )}
    </div>
  )
}
