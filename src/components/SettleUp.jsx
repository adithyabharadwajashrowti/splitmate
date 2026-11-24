import { useState } from 'react'
import { supabase, niceError, callRpc } from '../lib/supabase.js'
import { toPaise, paiseToInput, formatINR } from '../lib/money.js'
import { upiLink, isMobile } from '../lib/upi.js'
import Modal from './Modal.jsx'

export default function SettleUp({ g, me, preset, onClose, onSaved }) {
  // default: my biggest suggested payment, else whatever is owed to me
  const mine = g.payments.find((p) => p.from === me) || g.payments.find((p) => p.to === me)
  const start = preset || mine
  const others = g.members.filter((m) => m.id !== me)

  const [from, setFrom] = useState(start?.from || me)
  const [to, setTo] = useState(start?.to || others[0]?.id || null)
  const [amount, setAmount] = useState(start ? paiseToInput(start.amount) : '')
  const [method, setMethod] = useState('upi')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const paise = toPaise(amount)
  const payee = g.byId[to]
  const payer = g.byId[from]
  const iAmPaying = from === me
  const name = (id) => (id === me ? 'You' : g.byId[id]?.name)

  async function record(e) {
    e?.preventDefault()
    if (!Number.isFinite(paise) || paise <= 0) return setErr('Enter an amount above ₹0')
    if (!from || !to) return setErr('Pick who paid and who received it')
    if (from === to) return setErr('Pick two different people')
    if (from !== me && to !== me) return setErr('You can only record payments you made or received')
    setBusy(true)
    const { error } = await callRpc('record_settlement', {
      p_group_id: g.group.id, p_from: from, p_to: to, p_amount: paise, p_method: method, p_note: note.trim() || null,
    })
    setBusy(false)
    if (error) return setErr(niceError(error))
    onSaved()
  }

  const remindText = `Hi ${payer?.name?.split(' ')[0] || ''}! Gentle reminder: you owe me ${formatINR(paise || 0)} for "${g.group.name}" on SplitMate.` +
    (g.byId[me]?.upi_id ? ` My UPI: ${g.byId[me].upi_id}` : '')

  if (!others.length) {
    return (
      <Modal title="Settle up" onClose={onClose}>
        <div className="stack center-text">
          <div style={{ fontSize: '2.4rem' }}>👋</div>
          <h3>You're the only one here</h3>
          <p className="muted">Invite friends first. Open the <strong>Members</strong> tab and share the invite link on WhatsApp.</p>
          <button className="btn primary" onClick={onClose}>Got it</button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Settle up" onClose={onClose}>
      <form onSubmit={record} className="stack">
        <div className="grid-2">
          <label>Who paid
            <select value={from} onChange={(e) => setFrom(e.target.value)}>
              {g.members.map((m) => <option key={m.id} value={m.id}>{name(m.id)}</option>)}
            </select>
          </label>
          <label>To
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              {g.members.map((m) => <option key={m.id} value={m.id}>{name(m.id)}</option>)}
            </select>
          </label>
          <label>Amount (₹)<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="amount-input" /></label>
          <label>Method
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="upi">UPI</option><option value="cash">Cash</option><option value="bank">Bank transfer</option><option value="other">Other</option>
            </select>
          </label>
        </div>

        {iAmPaying && method === 'upi' && paise > 0 && (
          payee?.upi_id ? (
            <div className="card flat stack-sm">
              {isMobile()
                ? <a className="btn upi" href={upiLink({ upiId: payee.upi_id, name: payee.name, amountPaise: paise, note: `SplitMate ${g.group.name}` })}>
                    Pay {formatINR(paise)} with UPI app
                  </a>
                : <p className="small">Pay <strong>{formatINR(paise)}</strong> to <strong className="mono">{payee.upi_id}</strong> from any UPI app (open this page on your phone for one-tap pay).</p>}
              <p className="muted small">After paying, tap “Record payment” below.</p>
            </div>
          ) : (
            <p className="note warn small">{payee?.name} hasn't added a UPI ID yet. Ask them to add it in their Profile.</p>
          )
        )}

        {to === me && from !== me && paise > 0 && (
          <a className="btn whatsapp" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(remindText)}`}>
            Send a WhatsApp reminder
          </a>
        )}

        <label>Note <small className="muted">(optional)</small><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></label>
        {err && <p className="note err">{err}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Record payment'}</button>
      </form>
    </Modal>
  )
}
