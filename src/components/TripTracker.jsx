import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, callRpc, niceError } from '../lib/supabase.js'
import { parseManySms, parseStatementCsv } from '../lib/capture.js'
import { toPaise, formatINR } from '../lib/money.js'
import { category, guessCategory } from '../lib/categories.js'
import { haptic, toast, confetti } from '../lib/fun.js'
import Modal from './Modal.jsx'
import Avatar from './Avatar.jsx'

/**
 * 📡 Trip Tracking card for the group page.
 * Off → Start tracking.  On → ＋ Capture, Wrap up (n), Stop.  Ended → Wrap up reminder.
 */
export default function TripTracker({ g, me, onChanged }) {
  const started = g.group.tracking_started_at
  const ended = g.group.tracking_ended_at
  const active = !!started && !ended
  const [mine, setMine] = useState([]) // my pending spends
  const [status, setStatus] = useState([])
  const [modal, setModal] = useState(null) // 'capture' | 'wrap' | 'about'
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!started) return
    const [a, b] = await Promise.all([
      supabase.from('captured_txns').select('*').eq('group_id', g.group.id).eq('user_id', me).eq('status', 'pending').order('txn_at'),
      callRpc('tracking_status', { p_group_id: g.group.id }),
    ])
    if (!a.error) setMine(a.data)
    if (!b.error) setStatus(b.data || [])
  }, [g.group.id, me, started])
  useEffect(() => { load() }, [load])

  async function toggle(on) {
    if (!on && !window.confirm('Stop tracking? Everyone can still wrap up what they captured.')) return
    setBusy(true)
    const { error } = await callRpc('set_tracking', { p_group_id: g.group.id, p_on: on })
    setBusy(false)
    if (error) return toast(niceError(error), '⚠️')
    haptic(20)
    toast(on ? 'Tracking started. Capture spends as you go 📡' : 'Tracking stopped. Time to wrap up!', on ? '📡' : '🏁')
    onChanged()
  }

  const waiting = status.filter((s) => s.pending > 0 && s.user_id !== me)
  const name = (id) => (id === me ? 'You' : g.byId[id]?.name?.split(' ')[0] || '?')

  if (!started) {
    return (
      <section className="tracker off">
        <div className="tracker-ico">📡</div>
        <div className="grow">
          <strong>Trip Tracking</strong>
          <small className="muted">Collect spends from bank SMS & statements as you go. Split them all at the end.</small>
        </div>
        <div className="row">
          <button className="link small" onClick={() => setModal('about')}>How?</button>
          <button className="btn small primary" disabled={busy} onClick={() => toggle(true)}>Start</button>
        </div>
        {modal === 'about' && <About onClose={() => setModal(null)} onStart={() => { setModal(null); toggle(true) }} />}
      </section>
    )
  }

  return (
    <section className={`tracker ${active ? 'on' : 'ended'}`}>
      <div className="row-between">
        <div className="row" style={{ gap: 10 }}>
          <span className={`live-dot ${active ? 'pulse' : ''}`} />
          <div>
            <strong>{active ? 'Tracking this trip' : 'Tracking ended. Wrap up!'}</strong>
            <small className="muted" style={{ display: 'block' }}>
              {active ? `since ${fmtWhen(started)}` : `${fmtWhen(started)} → ${fmtWhen(ended)}`} · you have {mine.length} to review
            </small>
          </div>
        </div>
        {active
          ? <button className="link small" disabled={busy} onClick={() => toggle(false)}>Stop</button>
          : <button className="link small" disabled={busy} onClick={() => toggle(true)}>Restart</button>}
      </div>
      {waiting.length > 0 && (
        <small className="muted">⏳ Waiting on {waiting.map((w) => `${name(w.user_id)} (${w.pending})`).join(', ')}</small>
      )}
      <div className="row">
        {active && <button className="btn" style={{ flex: 1 }} onClick={() => setModal('capture')}>＋ Capture spends</button>}
        <button className={`btn ${mine.length ? 'primary' : ''}`} style={{ flex: 1 }} disabled={!mine.length} onClick={() => setModal('wrap')}>
          {mine.length ? `🧺 Wrap up (${mine.length})` : '✓ All sorted'}
        </button>
      </div>
      {modal === 'capture' && <Capture g={g} onClose={() => setModal(null)} onAdded={() => { setModal(null); load() }} />}
      {modal === 'wrap' && <WrapUp g={g} me={me} items={mine} onClose={() => { setModal(null); load(); onChanged() }} />}
    </section>
  )
}

const fmtWhen = (t) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

function About({ onClose, onStart }) {
  return (
    <Modal title="📡 How Trip Tracking works" onClose={onClose}>
      <div className="stack">
        {[
          ['1', 'Start tracking', 'when the trip begins. Everyone in the group can capture.'],
          ['2', 'Capture as you go', 'paste bank / UPI SMS (many at once), upload your bank statement, or add cash. On Android you can Share an SMS straight to SplitMate.'],
          ['3', 'Wrap up', 'at the end. Swipe through your spends: Personal stays private, Split becomes a group expense.'],
          ['4', 'Settle', 'SplitMate turns it all into the fewest payments.'],
        ].map(([n, t, d]) => (
          <div key={n} className="about-step"><span>{n}</span><p><strong>{t}</strong> {d}</p></div>
        ))}
        <p className="note ok small">🔒 Only you see your captured spends. We keep amount, merchant and time, never account numbers or full SMS.</p>
        <button className="btn primary" onClick={onStart}>Start tracking</button>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- capture

function Capture({ g, onClose, onAdded }) {
  const [tab, setTab] = useState('sms')
  const [text, setText] = useState('')
  const [items, setItems] = useState([])
  const [picked, setPicked] = useState({})
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [cash, setCash] = useState({ amount: '', what: '' })
  const fileRef = useRef(null)

  const setParsed = (list) => { setItems(list); setPicked(Object.fromEntries(list.map((_, i) => [i, true]))) }

  useEffect(() => {
    if (tab !== 'sms') return
    const t = setTimeout(() => setParsed(parseManySms(text)), 250)
    return () => clearTimeout(t)
  }, [text, tab])

  async function onFile(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (f.size > 5_000_000) return setErr('That file is too big. Export just the trip dates.')
    const r = parseStatementCsv(await f.text(), { from: g.group.tracking_started_at, to: g.group.tracking_ended_at || new Date().toISOString() })
    setErr(r.error)
    setParsed(r.items)
  }

  async function save(list, source) {
    if (!list.length) return
    setBusy(true)
    const { data, error } = await callRpc('add_captured', { p_group_id: g.group.id, p_items: list, p_source: source })
    setBusy(false)
    if (error) return setErr(niceError(error))
    haptic(20)
    toast(data ? `${data} spend${data > 1 ? 's' : ''} added to your inbox 📥` : 'Already in your inbox', '📥')
    onAdded()
  }

  const chosen = items.filter((_, i) => picked[i])
  return (
    <Modal title="Capture spends" onClose={onClose}>
      <div className="stack">
        <div className="seg">
          {[['sms', '📩 SMS'], ['statement', '🏦 Statement'], ['cash', '💵 Cash']].map(([k, l]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setErr(null); setItems([]) }}>{l}</button>
          ))}
        </div>

        {tab === 'sms' && (
          <>
            <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} autoFocus
              placeholder={'Paste bank / UPI SMS here. One or many, e.g.\nRs.450.00 debited from A/c XX1234 to VPA swiggy@icici\nINR 1,250 spent on Card x1234 at ZOMATO'} />
            <button className="link small" onClick={() => setText(SAMPLE_SMS)}>Try with sample SMS</button>
          </>
        )}
        {tab === 'statement' && (
          <div className="card flat stack-sm center-text">
            <p className="muted small">Download your bank statement as <strong>CSV</strong> (net banking → Statement → Download → CSV/Excel). We pick only spends from the trip dates.</p>
            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onFile} />
            <button className="btn" onClick={() => fileRef.current?.click()}>Choose statement file</button>
          </div>
        )}
        {tab === 'cash' && (
          <div className="stack-sm">
            <div className="amount-hero"><span>₹</span>
              <input inputMode="decimal" value={cash.amount} onChange={(e) => setCash({ ...cash, amount: e.target.value })} placeholder="0" autoFocus aria-label="Amount" />
            </div>
            <input value={cash.what} onChange={(e) => setCash({ ...cash, what: e.target.value })} placeholder="What for? e.g. Parking, Coconut water" maxLength={60} />
            <button className="btn primary" disabled={busy || !(toPaise(cash.amount) > 0)}
              onClick={() => save([{ amount_paise: toPaise(cash.amount), merchant: cash.what.trim() || 'Cash', category: guessCategory(cash.what), txn_at: new Date().toISOString() }], 'cash')}>
              Add to my inbox
            </button>
          </div>
        )}

        {tab !== 'cash' && items.length > 0 && (
          <div className="stack-sm">
            <span className="label">Found {items.length} spend{items.length > 1 ? 's' : ''}. Untick any you don't want</span>
            {items.map((it, i) => (
              <label key={i} className={`capture-row ${picked[i] ? '' : 'off'}`}>
                <input type="checkbox" checked={!!picked[i]} onChange={() => setPicked({ ...picked, [i]: !picked[i] })} />
                <span className="cat-icon" style={{ width: 34, height: 34, fontSize: '1rem' }}>{category(it.category).icon}</span>
                <span className="grow"><strong>{it.merchant}</strong><small className="muted">{new Date(it.txn_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</small></span>
                <strong className="num">{formatINR(it.amount_paise)}</strong>
              </label>
            ))}
            <button className="btn primary" disabled={busy || !chosen.length} onClick={() => save(chosen, tab)}>
              {busy ? 'Adding…' : `Add ${chosen.length} to my inbox · ${formatINR(chosen.reduce((a, x) => a + x.amount_paise, 0))}`}
            </button>
          </div>
        )}
        {tab === 'sms' && text.trim() && !items.length && <p className="muted small">No spends recognised yet. Credits, OTPs and bill reminders are ignored on purpose.</p>}
        {err && <p className="note err small">{err}</p>}
        <p className="muted small">🔒 Only you can see your inbox. We store amount, merchant and time, never your account number.</p>
      </div>
    </Modal>
  )
}

const SAMPLE_SMS = `Rs.450.00 debited from A/c XX1234 on ${dmy(0)} to VPA swiggy@icici (UPI Ref No 432112345678)
INR 1,250.00 spent on HDFC Bank Card x1234 at ZOMATO on ${ymd(0)}
Your a/c XX1234 is debited for Rs 899.00 on ${dmy(0)} trf to Uber India
Rs.5000 credited to your A/c XX1234 by NEFT
Paid ₹120 to Chai Point via PhonePe`
function dmy(o) { const d = new Date(Date.now() - o * 864e5); return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getFullYear()).slice(2)}` }
function ymd(o) { const d = new Date(Date.now() - o * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

// ---------------------------------------------------------------- wrap up

function WrapUp({ g, me, items, onClose }) {
  const [i, setI] = useState(0)
  const [withIds, setWithIds] = useState(() => new Set(g.members.map((m) => m.id)))
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState({ shared: 0, personal: 0, sharedAmt: 0 })
  const [anim, setAnim] = useState('')
  const t = items[i]
  const name = (id) => (id === me ? 'You' : g.byId[id]?.name?.split(' ')[0] || '?')

  useEffect(() => { if (!t && (done.shared || done.personal)) confetti() }, [t, done])

  async function decide(kind) {
    if (!t || busy) return
    setBusy(true)
    let error = null
    if (kind === 'split') ({ error } = await callRpc('share_captured', { p_txn_id: t.id, p_with: [...withIds] }))
    else ({ error } = await supabase.from('captured_txns').update({ status: 'personal' }).eq('id', t.id))
    setBusy(false)
    if (error) return toast(niceError(error), '⚠️')
    haptic(kind === 'split' ? 25 : 10)
    setAnim(kind === 'split' ? 'fly-right' : 'fly-left')
    setDone((d) => ({ shared: d.shared + (kind === 'split'), personal: d.personal + (kind !== 'split'), sharedAmt: d.sharedAmt + (kind === 'split' ? t.amount_paise : 0) }))
    setTimeout(() => { setAnim(''); setI((x) => x + 1) }, 260)
  }

  const share = t && withIds.size ? Math.floor(t.amount_paise / withIds.size) : 0
  return (
    <Modal title={t ? `Wrap up · ${i + 1} of ${items.length}` : 'All sorted! 🎉'} onClose={onClose}>
      {t ? (
        <div className="stack">
          <div className="wrap-progress"><span style={{ width: `${(i / items.length) * 100}%` }} /></div>
          <div className={`wrap-card ${anim}`} key={t.id}>
            <span className="wrap-cat">{category(t.category).icon}</span>
            <div className="wrap-amt num">{formatINR(t.amount_paise)}</div>
            <strong className="wrap-merchant">{t.merchant}</strong>
            <small className="muted">{new Date(t.txn_at).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · {t.source === 'sms' ? '📩 SMS' : t.source === 'statement' ? '🏦 statement' : t.source === 'share' ? '📲 shared' : '💵 cash'}</small>
          </div>
          <div className="stack-sm">
            <span className="label">If it’s shared, who was in?</span>
            <div className="face-row">
              {g.members.map((m) => {
                const on = withIds.has(m.id)
                return (
                  <button key={m.id} className={`face multi ${on ? 'on' : ''}`} onClick={() => { haptic(); setWithIds((s) => { const n = new Set(s); n.has(m.id) ? n.delete(m.id) : n.add(m.id); return n }) }}>
                    <Avatar name={m.name} size={36} /><span>{name(m.id)}</span>
                  </button>
                )
              })}
            </div>
          </div>
          <div className="wrap-actions">
            <button className="btn" disabled={busy} onClick={() => decide('personal')}>🙅 Just mine</button>
            <button className="btn primary" disabled={busy || !withIds.size} onClick={() => decide('split')}>
              🤝 Split{withIds.size ? ` · ${formatINR(share)} each` : ''}
            </button>
          </div>
        </div>
      ) : (
        <div className="stack center-text">
          <div style={{ fontSize: '3rem' }}>🧺</div>
          <h3>{done.shared} shared · {done.personal} kept personal</h3>
          <p className="muted">{done.shared ? `${formatINR(done.sharedAmt)} added to the group. Balances are updated, so check who pays whom.` : 'Nothing was shared this time.'}</p>
          <button className="btn primary" onClick={onClose}>See balances</button>
        </div>
      )}
    </Modal>
  )
}
