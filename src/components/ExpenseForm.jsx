import { useMemo, useState } from 'react'
import { niceError, callRpc } from '../lib/supabase.js'
import { toPaise, paiseToInput, formatINR } from '../lib/money.js'
import { computeSplits, computeItemized } from '../lib/splits.js'
import { CATEGORIES, guessCategory, category } from '../lib/categories.js'
import { parseExpense } from '../lib/parser.js'
import { listen, voiceSupported } from '../lib/voice.js'
import { haptic, toast } from '../lib/fun.js'
import Modal from './Modal.jsx'
import Avatar from './Avatar.jsx'
import ItemizedEditor, { newItem, billFromState, stepProblem } from './ItemizedEditor.jsx'

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const SPLIT_LABELS = { equal: 'Equally', exact: 'Exact ₹', percent: '%', shares: 'Shares' }
const STEPS = ['🧾 Items', '👆 Who had what', '✅ Review']

/**
 * Add / edit an expense.
 *  - Quick add: amount first, tap faces for who paid and who's in. Type or say it to fill everything.
 *  - Split a bill: three-step itemized flow (with Birthday treat + Host Mode).
 */
export default function ExpenseForm({ g, me, expense, startMode, onClose, onSaved }) {
  const members = g.members
  const editing = !!expense
  const name = (id) => (id === me ? 'You' : members.find((m) => m.id === id)?.name?.split(' ')[0] || '?')

  const [description, setDescription] = useState(expense?.description || '')
  const [amount, setAmount] = useState(expense ? paiseToInput(expense.amount_paise) : '')
  const [paidBy, setPaidBy] = useState(expense?.paid_by && members.some((m) => m.id === expense.paid_by) ? expense.paid_by : me)
  const [date, setDate] = useState(expense?.expense_date || today())
  const [cat, setCat] = useState(expense?.category || 'other')
  const [catTouched, setCatTouched] = useState(editing)
  const [notes, setNotes] = useState(expense?.notes || '')
  const [smart, setSmart] = useState('')
  const [smartMsg, setSmartMsg] = useState(null)
  const [listening, setListening] = useState(false)
  const [more, setMore] = useState(false)

  const initialType = expense ? (['percent', 'shares'].includes(expense.split_type) ? 'exact' : expense.split_type)
    : ['scan', 'itemized', 'host'].includes(startMode) ? 'itemized' : 'equal'
  const [type, setType] = useState(initialType)
  const [step, setStep] = useState(1)
  const [people, setPeople] = useState(() => new Set(expense ? expense.expense_splits.map((s) => s.user_id) : members.map((m) => m.id)))
  const [values, setValues] = useState(() => {
    if (!expense || initialType !== 'exact') return {}
    return Object.fromEntries(expense.expense_splits.map((s) => [s.user_id, paiseToInput(s.share_paise)]))
  })
  const [bill, setBill] = useState(() => {
    const it = expense?.items
    if (it?.items?.length) {
      return {
        items: it.items.map((x) => newItem({ name: x.name, qty: x.qty || 1, price: paiseToInput(x.amount_paise), weights: x.weights })),
        tax: it.tax_paise ? paiseToInput(it.tax_paise) : '',
        service: it.service_paise ? paiseToInput(it.service_paise) : '',
        tip: it.tip_paise ? paiseToInput(it.tip_paise) : '',
        discount: it.discount_paise ? paiseToInput(it.discount_paise) : '',
        treat: it.treat_ids || [],
        host: !!it.host_mode,
      }
    }
    return { items: [newItem()], tax: '', service: '', tip: '', discount: '', treat: [], host: startMode === 'host' }
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const isBill = type === 'itemized'

  // ---------- compute live
  const calc = useMemo(() => {
    if (isBill && bill.host) {
      const b = billFromState(bill)
      const items = b.items.filter((x) => x.amount_paise > 0)
      const total = items.reduce((a, x) => a + x.amount_paise, 0) + b.tax_paise + b.service_paise + b.tip_paise - b.discount_paise
      const error = !items.length ? 'Add at least one item with a price' : total <= 0 ? 'Discount is larger than the bill' : null
      return { total, splits: error ? [] : [{ user_id: paidBy, share_paise: total }], error, items: { ...b, items } }
    }
    if (isBill) {
      const b = billFromState(bill)
      const r = computeItemized(b)
      return { total: r.total, splits: r.splits, error: r.error, items: { ...b, items: b.items.filter((x) => x.amount_paise > 0) } }
    }
    const total = toPaise(amount)
    const ids = members.map((m) => m.id).filter((id) => people.has(id))
    const vals = {}
    for (const id of ids) {
      const v = values[id]
      if (type === 'exact') vals[id] = toPaise(v || 0) || 0
      else if (type === 'percent') vals[id] = Number(v || 0)
      else if (type === 'shares') vals[id] = v === undefined || v === '' ? 1 : Number(v)
    }
    const r = computeSplits(type, total, ids, vals)
    return { total, splits: r.splits, error: !amount ? 'Enter an amount' : Number.isNaN(total) ? 'Enter a valid amount' : r.error, items: null }
  }, [isBill, type, bill, amount, people, values, members, paidBy])

  function onDescription(v) {
    setDescription(v)
    if (!catTouched) setCat(guessCategory(v))
  }

  function startVoice() {
    if (listening) return
    haptic(15)
    setSmartMsg('🎙️ Listening… try “1200 dinner paid by Rahul with Asha and Dev”')
    setListening(true)
    listen({
      onText: (t, final) => { setSmart(t); if (final) applySmart(null, t) },
      onEnd: () => setListening(false),
      onError: (m) => { setListening(false); setSmartMsg(m) },
    })
  }

  function applySmart(e, text = smart) {
    e?.preventDefault?.()
    if (!text.trim()) return
    const p = parseExpense(text, members, me)
    if (p.amountPaise) setAmount(paiseToInput(p.amountPaise))
    if (p.description) setDescription(p.description.slice(0, 120))
    setPaidBy(p.paidBy)
    setPeople(new Set(p.participants))
    if (!catTouched) setCat(p.category)
    haptic(12)
    setSmartMsg(p.unknownNames.length ? `Couldn't find ${p.unknownNames.join(', ')}. Check the faces below.` : '✨ Filled in. Check it and save.')
  }

  async function save(e) {
    e?.preventDefault?.()
    if (calc.error) return setErr(calc.error)
    if (calc.total > 100000000000) return setErr('That amount is too large')
    const desc = (description.replace(/\s+/g, ' ').trim() || CATEGORIES[cat]?.label || 'Expense').slice(0, 120)
    setBusy(true)
    setErr(null)
    const { error } = await callRpc('save_expense', {
      p_group_id: g.group.id,
      p_description: desc,
      p_amount: calc.total,
      p_paid_by: paidBy,
      p_category: isBill && cat === 'other' ? 'food' : cat,
      p_split_type: type,
      p_date: date,
      p_splits: calc.splits,
      p_notes: notes.trim() || null,
      p_expense_id: expense?.id || null,
      p_items: isBill ? calc.items : null,
    })
    setBusy(false)
    if (error) return setErr(niceError(error))
    haptic(25)
    const mine = calc.splits.find((s) => s.user_id === me)?.share_paise || 0
    toast(isBill && bill.host ? `Treat saved. Everyone owes ₹0 🎁` : paidBy === me
      ? `Saved! Friends owe you ${formatINR(calc.total - mine)}`
      : `Saved! Your share is ${formatINR(mine)}`, isBill && bill.host ? '🎁' : '✅')
    onSaved()
  }

  const togglePerson = (id) => { haptic(); setPeople((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  const shareOf = (id) => calc.splits.find((s) => s.user_id === id)?.share_paise || 0

  // ================================================================ Split a bill (3 steps)
  if (isBill) {
    const problem = step < 3 ? stepProblem(step, bill) : calc.error
    return (
      <Modal title={editing ? 'Edit bill' : bill.host ? '🙈 Host Mode' : 'Split a bill'} onClose={onClose} wide>
        <div className="stack">
          <div className="stepbar">
            {STEPS.map((s, i) => (
              <button key={s} type="button" className={`${step === i + 1 ? 'on' : ''} ${step > i + 1 ? 'done' : ''}`}
                onClick={() => i + 1 < step && setStep(i + 1)} disabled={i + 1 > step}>{step > i + 1 ? '✓ ' : ''}{s}</button>
            ))}
          </div>

          <ItemizedEditor members={members} me={me} bill={bill} setBill={setBill} step={step}
            paidBy={paidBy} setPaidBy={setPaidBy} title={description} setTitle={onDescription}
            autoScan={startMode === 'scan' && !editing}
            onScanned={(d) => { if (d.merchant && !description) onDescription(d.merchant.slice(0, 120)) }} />

          {err && <p className="note err">{err}</p>}

          <div className="row-between sticky-foot">
            {step > 1 ? <button type="button" className="btn" onClick={() => { setErr(null); setStep(step - 1) }}>← Back</button>
              : !editing ? <button type="button" className="link small" onClick={() => setType('equal')}>Quick add instead</button> : <span />}
            {step < 3 ? (
              <button type="button" className="btn primary" disabled={!!problem} title={problem || ''}
                onClick={() => { haptic(); setErr(null); setStep(step + 1) }}>
                {problem || (step === 1 ? 'Next: who had what →' : 'Next: review →')}
              </button>
            ) : (
              <button type="button" className="btn primary" disabled={busy || !!calc.error} onClick={save}>
                {busy ? 'Saving…' : calc.error ? calc.error : bill.host ? '🎁 Save treat' : `Save ${formatINR(calc.total || 0)}`}
              </button>
            )}
          </div>
        </div>
      </Modal>
    )
  }

  // ================================================================ Quick add
  const c = category(cat)
  return (
    <Modal title={editing ? 'Edit expense' : 'Add expense'} onClose={onClose}>
      <form onSubmit={save} className="stack">
        {!editing && (
          <div className="smart">
            <div className="row">
              <input value={smart} onChange={(e) => setSmart(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applySmart(e)}
                placeholder="✨ Type it: 1200 dinner paid by Rahul with Asha" aria-label="Describe the expense in one sentence" />
              {voiceSupported() && (
                <button type="button" className={`btn mic ${listening ? 'live' : ''}`} onClick={startVoice} aria-label="Say the expense">🎙️</button>
              )}
              {smart.trim() && <button type="button" className="btn primary" onClick={() => applySmart()}>Fill</button>}
            </div>
            {smartMsg && <small className="muted">{smartMsg}</small>}
          </div>
        )}

        <div className="amount-hero">
          <span>₹</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" aria-label="Amount in rupees" autoFocus={!editing} />
        </div>
        <div className="desc-row">
          <span className="cat-icon" style={{ background: c.color + '26' }} title={c.label}>{c.icon}</span>
          <input value={description} onChange={(e) => onDescription(e.target.value)} maxLength={120} placeholder="What was it for?" aria-label="Description" />
        </div>

        <div className="stack-sm">
          <span className="label">Paid by</span>
          <div className="face-row">
            {members.map((m) => (
              <button type="button" key={m.id} className={`face ${paidBy === m.id ? 'on' : ''}`} onClick={() => { haptic(); setPaidBy(m.id) }}>
                <Avatar name={m.name} size={40} /><span>{name(m.id)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="stack-sm">
          <div className="row-between">
            <span className="label">Split between</span>
            <button type="button" className="link small" onClick={() => { haptic(); setPeople(people.size === members.length ? new Set([me]) : new Set(members.map((m) => m.id))) }}>
              {people.size === members.length ? 'Just me' : 'Everyone'}
            </button>
          </div>
          <div className="face-row">
            {members.map((m) => {
              const on = people.has(m.id)
              return (
                <button type="button" key={m.id} className={`face multi ${on ? 'on' : ''}`} onClick={() => togglePerson(m.id)}>
                  <Avatar name={m.name} size={40} />
                  <span>{name(m.id)}</span>
                  <small className="num">{on && shareOf(m.id) ? formatINR(shareOf(m.id)) : on ? '…' : 'out'}</small>
                </button>
              )
            })}
          </div>
        </div>

        <button type="button" className="link small" onClick={() => setMore(!more)}>{more ? '− Fewer options' : '+ Uneven split, date, category, notes'}</button>
        {more && (
          <div className="stack card flat">
            <div className="seg" role="tablist" aria-label="How to split">
              {Object.entries(SPLIT_LABELS).map(([k, v]) => (
                <button type="button" key={k} className={type === k ? 'on' : ''} onClick={() => setType(k)}>{v}</button>
              ))}
            </div>
            {type !== 'equal' && members.filter((m) => people.has(m.id)).map((m) => (
              <div key={m.id} className="split-row">
                <Avatar name={m.name} size={26} /><span className="grow">{name(m.id)}</span>
                <input className="split-input" inputMode="decimal" value={values[m.id] ?? ''}
                  placeholder={type === 'exact' ? '₹0' : type === 'percent' ? '%' : '1'}
                  onChange={(e) => setValues((v) => ({ ...v, [m.id]: e.target.value }))} />
                <span className="split-share">{formatINR(shareOf(m.id))}</span>
              </div>
            ))}
            {type === 'shares' && <p className="muted small">1 = normal, 2 = had double, 0.5 = had half.</p>}
            <div className="grid-2">
              <label>Date<input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></label>
              <label>Category
                <select value={cat} onChange={(e) => { setCat(e.target.value); setCatTouched(true) }}>
                  {Object.entries(CATEGORIES).map(([k, x]) => <option key={k} value={k}>{x.icon} {x.label}</option>)}
                </select>
              </label>
            </div>
            <label>Notes<input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="Optional" /></label>
          </div>
        )}

        {err && <p className="note err">{err}</p>}
        <div className="row-between sticky-foot">
          {!editing ? <button type="button" className="link small" onClick={() => setType('itemized')}>🧾 Split by items</button> : <span />}
          <button className="btn primary" disabled={busy || !!calc.error}>
            {busy ? 'Saving…' : calc.error && amount ? calc.error : editing ? 'Save changes' : `Save${calc.total > 0 ? ` ${formatINR(calc.total)}` : ''}`}
          </button>
        </div>
      </form>
    </Modal>
  )
}
