import { useRef, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { compressImage } from '../lib/image.js'
import { toPaise, paiseToInput, formatINR } from '../lib/money.js'
import { computeItemized } from '../lib/splits.js'
import { haptic } from '../lib/fun.js'
import Avatar from './Avatar.jsx'

const VEG = ['veg', 'vegan', 'egg']
const SCAN_ENABLED = import.meta.env.VITE_SCAN_ENABLED === 'true'
const POPULAR = ['Paneer tikka', 'Chicken biryani', 'Veg biryani', 'Butter naan', 'Dal makhani', 'Masala dosa', 'Beer', 'Soft drink', 'Dessert']

let nextKey = 1
export const newItem = (over = {}) => ({ key: nextKey++, name: '', price: '', qty: 1, weights: {}, ...over })

/** Convert the editor's state into the shape computeItemized() / the database expects. */
export function billFromState(b) {
  return {
    items: b.items.map((it) => ({ name: it.name.trim() || 'Item', qty: it.qty, amount_paise: toPaise(it.price) || 0, weights: it.weights })),
    tax_paise: toPaise(b.tax) || 0,
    service_paise: toPaise(b.service) || 0,
    tip_paise: toPaise(b.tip) || 0,
    discount_paise: toPaise(b.discount) || 0,
    treat_ids: b.host ? [] : b.treat || [],
    host_mode: !!b.host,
  }
}

/** Which step-gate is failing, if any. Used by the parent for the Next button. */
export function stepProblem(step, bill) {
  const priced = bill.items.filter((it) => (toPaise(it.price) || 0) > 0)
  if (step === 1 && !priced.length) return 'Add at least one item with a price'
  if (step === 2 && !bill.host) {
    const left = priced.filter((it) => !Object.keys(it.weights).length).length
    if (left) return `${left} item${left > 1 ? 's' : ''} still need${left > 1 ? '' : 's'} someone`
  }
  return null
}

/**
 * Itemized bill splitter in three friendly steps:
 *   1 🧾 What did you order?   2 👆 Who had what?   3 ✅ Review
 */
export default function ItemizedEditor({ members, me, bill, setBill, step, paidBy, setPaidBy, title, setTitle, autoScan, onScanned }) {
  const [person, setPerson] = useState(me)
  const [peek, setPeek] = useState(false)
  const peekTimer = useRef(null)
  const hidden = !!bill.host && !peek
  const name = (id) => (id === me ? 'You' : members.find((m) => m.id === id)?.name?.split(' ')[0] || '?')
  const holdStart = () => { clearTimeout(peekTimer.current); peekTimer.current = setTimeout(() => { setPeek(true); haptic(20) }, 600) }
  const holdEnd = () => { clearTimeout(peekTimer.current); setPeek(false) }

  const result = computeItemized(billFromState(bill))
  const update = (patch) => setBill((b) => ({ ...b, ...patch }))
  const setItem = (key, patch) => setBill((b) => ({ ...b, items: b.items.map((it) => (it.key === key ? { ...it, ...patch } : it)) }))
  const addItem = (over) => { haptic(); setBill((b) => ({ ...b, items: [...b.items.filter((x) => x.name || x.price), newItem(over)] })) }
  const removeItem = (key) => setBill((b) => ({ ...b, items: b.items.length > 1 ? b.items.filter((x) => x.key !== key) : [newItem()] }))

  /** Tap cycle for the selected person: none → had it → had double → none */
  const tap = (it) => {
    haptic()
    const w = { ...it.weights }
    if (!w[person]) w[person] = 1
    else if (w[person] === 1) w[person] = 2
    else delete w[person]
    setItem(it.key, { weights: w })
  }
  const fill = (it, ids) => { haptic(); setItem(it.key, { weights: Object.fromEntries(ids.map((id) => [id, 1])) }) }
  const everyone = members.map((m) => m.id)
  const vegIds = members.filter((m) => VEG.includes(m.diet)).map((m) => m.id)
  const nonVegIds = members.filter((m) => m.diet === 'nonveg').map((m) => m.id)
  const priced = bill.items.filter((it) => (toPaise(it.price) || 0) > 0)

  // ---------------------------------------------------------------- step 1
  if (step === 1) {
    return (
      <div className="stack">
        <div className="grid-2">
          <label className="span-2">Where did you eat?
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Dinner at Truffles" />
          </label>
        </div>
        <div className="stack-sm">
          <span className="label">Who paid the bill?</span>
          <div className="chips">
            {members.map((m) => (
              <button type="button" key={m.id} className={`chip ${paidBy === m.id ? 'on' : ''}`} onClick={() => { haptic(); setPaidBy(m.id) }}>
                <Avatar name={m.name} size={20} /> {name(m.id)}
              </button>
            ))}
          </div>
        </div>

        {SCAN_ENABLED && <Scanner members={members} setBill={setBill} autoScan={autoScan} onScanned={onScanned} />}

        <div className="stack-sm">
          <span className="label">What did you order?</span>
          {bill.items.map((it, idx) => (
            <div key={it.key} className="order-line">
              <input className="grow" value={it.name} onChange={(e) => setItem(it.key, { name: e.target.value })}
                placeholder={idx === 0 ? 'e.g. Paneer tikka' : 'Item'} aria-label="Item name" />
              <div className="stepper" aria-label="Quantity">
                <button type="button" onClick={() => {
                  const q = Math.max(1, it.qty - 1); const unit = (toPaise(it.price) || 0) / (it.qty || 1)
                  setItem(it.key, { qty: q, price: unit ? paiseToInput(Math.round(unit * q)) : it.price })
                }}>−</button>
                <span>{it.qty}</span>
                <button type="button" onClick={() => {
                  const q = it.qty + 1; const unit = (toPaise(it.price) || 0) / (it.qty || 1)
                  setItem(it.key, { qty: q, price: unit ? paiseToInput(Math.round(unit * q)) : it.price })
                }}>+</button>
              </div>
              <input className="price" inputMode="decimal" type={hidden ? 'password' : 'text'} value={it.price}
                onChange={(e) => setItem(it.key, { price: e.target.value })} placeholder="₹" aria-label="Price" />
              <button type="button" className="icon-btn" aria-label="Remove item" onClick={() => removeItem(it.key)}>✕</button>
            </div>
          ))}
          <button type="button" className="btn ghost" onClick={() => addItem()}>+ Add item</button>
          <div className="chips small-chips">
            {POPULAR.filter((p) => !bill.items.some((it) => it.name === p)).slice(0, 6).map((p) => (
              <button type="button" key={p} className="chip ghost" onClick={() => addItem({ name: p })}>+ {p}</button>
            ))}
          </div>
        </div>

        <HostToggle bill={bill} update={update} treating={paidBy === me ? 'You’re treating' : `${name(paidBy)} is treating`} />
      </div>
    )
  }

  // ---------------------------------------------------------------- step 2
  if (step === 2) {
    const mine = priced.filter((it) => it.weights[person])
    return (
      <div className="stack">
        {bill.host && (
          <p className="note ok small">🙈 Host Mode is on. Pass the phone around: guests tap their own dishes, and prices stay hidden.</p>
        )}
        <div className="person-picker">
          {members.map((m) => {
            const count = priced.filter((it) => it.weights[m.id]).length
            return (
              <button type="button" key={m.id} className={`person ${person === m.id ? 'on' : ''}`} onClick={() => { haptic(); setPerson(m.id) }}>
                <span className="person-face"><Avatar name={m.name} size={44} />{count > 0 && <i>{count}</i>}</span>
                <span>{name(m.id)}</span>
              </button>
            )
          })}
        </div>
        <p className="tap-hint">Tap everything <strong>{person === me ? 'you' : name(person)}</strong> had · tap again for <strong>×2</strong></p>

        <div className="dish-grid">
          {priced.map((it) => {
            const w = it.weights[person]
            const ids = Object.keys(it.weights)
            return (
              <div key={it.key} className={`dish ${w ? 'on' : ''}`} role="button" tabIndex={0}
                onClick={() => tap(it)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), tap(it))}>
                {w > 1 && <span className="dish-x">×{w}</span>}
                <strong>{it.qty > 1 ? `${it.qty}× ` : ''}{it.name || 'Item'}</strong>
                <small className="muted">{hidden ? '₹ ••••' : formatINR(toPaise(it.price))}</small>
                <div className="dish-foot">
                  <div className="avatar-stack">{ids.slice(0, 4).map((id) => <Avatar key={id} name={members.find((m) => m.id === id)?.name} size={20} />)}</div>
                  <span className="dish-quick" onClick={(e) => e.stopPropagation()}>
                    <button type="button" title="Everyone shared this" onClick={() => fill(it, everyone)}>All</button>
                    {vegIds.length > 0 && <button type="button" title="Veg people" onClick={() => fill(it, vegIds)}>🥦</button>}
                    {nonVegIds.length > 0 && <button type="button" title="Non-veg people" onClick={() => fill(it, nonVegIds)}>🍗</button>}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
        {!hidden && mine.length > 0 && result.perPerson[person] && (
          <p className="muted small center-text">So far {person === me ? 'you owe' : `${name(person)} owes`} <strong className="num">{formatINR(result.perPerson[person].total)}</strong></p>
        )}
      </div>
    )
  }

  // ---------------------------------------------------------------- step 3
  const pct = (field, rate) => () => { haptic(); update({ [field]: paiseToInput(Math.round((result.subtotal * rate) / 100)) }) }
  if (bill.host && hidden) {
    return (
      <div className="stack">
        <div className="card flat center-text stack-sm">
          <div style={{ fontSize: '2.6rem' }}>🎁</div>
          <h3>{paidBy === me ? 'You’re treating everyone' : `${name(paidBy)} is treating everyone`}</h3>
          <p className="muted small">Guests owe ₹0. Only the host can see the bill.</p>
        </div>
        <HostReveal peek={peek} holdStart={holdStart} holdEnd={holdEnd} total={totalOf(bill)} />
      </div>
    )
  }
  return (
    <div className="stack">
      <div className="stack-sm">
        <span className="label">Add GST, service charge or tip</span>
        <div className="chips small-chips">
          <button type="button" className="chip ghost" onClick={pct('tax', 5)}>GST 5%</button>
          <button type="button" className="chip ghost" onClick={pct('tax', 18)}>GST 18%</button>
          <button type="button" className="chip ghost" onClick={pct('service', 10)}>Service 10%</button>
          <button type="button" className="chip ghost" onClick={pct('tip', 5)}>Tip 5%</button>
        </div>
        <div className="extras">
          <label>GST<input inputMode="decimal" value={bill.tax} onChange={(e) => update({ tax: e.target.value })} placeholder="0" /></label>
          <label>Service<input inputMode="decimal" value={bill.service} onChange={(e) => update({ service: e.target.value })} placeholder="0" /></label>
          <label>Tip<input inputMode="decimal" value={bill.tip} onChange={(e) => update({ tip: e.target.value })} placeholder="0" /></label>
          <label>Discount<input inputMode="decimal" value={bill.discount} onChange={(e) => update({ discount: e.target.value })} placeholder="0" /></label>
        </div>
      </div>

      {!bill.host && Object.keys(result.perPerson).length > 1 && (
        <div className="treat-box stack-sm">
          <span className="label">🎂 Anyone’s birthday? Tap to treat them</span>
          <div className="chips">
            {members.filter((m) => result.perPerson[m.id]).map((m) => {
              const on = (bill.treat || []).includes(m.id)
              return (
                <button type="button" key={m.id} className={`chip ${on ? 'on' : ''}`}
                  onClick={() => { haptic(); update({ treat: on ? bill.treat.filter((x) => x !== m.id) : [...(bill.treat || []), m.id] }) }}>
                  {on ? '🎂 ' : ''}{name(m.id)}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {bill.host ? (
        <HostReveal peek={peek} holdStart={holdStart} holdEnd={holdEnd} total={totalOf(bill)} />
      ) : (
        <div className="result-cards">
          {Object.entries(result.perPerson).sort((a, b) => b[1].total - a[1].total).map(([id, p]) => (
            <div key={id} className={`result-card ${p.treated ? 'treated' : ''}`}>
              <Avatar name={members.find((m) => m.id === id)?.name} size={36} />
              <span className="grow">
                <strong>{name(id)}</strong>
                <small className="muted">
                  {p.treated ? '🎂 Birthday treat!' : `food ${formatINR(p.items)}${p.extras ? ` · tax ${formatINR(p.extras)}` : ''}${p.treat ? ` · treat ${formatINR(p.treat)}` : ''}`}
                </small>
              </span>
              <strong className="num result-amt">{formatINR(p.total)}</strong>
            </div>
          ))}
          <p className="muted small">GST and service are shared by what each person ate, so the salad person pays salad-level GST.</p>
        </div>
      )}
    </div>
  )
}

function HostToggle({ bill, update, treating }) {
  return (
    <div className={`host-box ${bill.host ? 'on' : ''}`}>
      <div className="row-between">
        <div className="grow">
          <strong>🙈 Host Mode {bill.host ? 'on' : ''}</strong>
          <small className="muted">{bill.host
            ? `${treating}. Prices hide on the next screens, so guests can tap freely.`
            : 'Treating everyone? Hide prices from guests. You pay, they owe ₹0.'}</small>
        </div>
        <button type="button" className={`switch ${bill.host ? 'on' : ''}`} role="switch" aria-checked={!!bill.host}
          aria-label="Host mode" onClick={() => { haptic(); update({ host: !bill.host }) }}><span /></button>
      </div>
    </div>
  )
}

function HostReveal({ peek, holdStart, holdEnd, total }) {
  return (
    <button type="button" className={`btn reveal ${peek ? 'peeking' : ''}`}
      onPointerDown={holdStart} onPointerUp={holdEnd} onPointerLeave={holdEnd} onContextMenu={(e) => e.preventDefault()}>
      {peek ? `🔓 Bill total ${formatINR(total)}` : '🔒 Host: press & hold to see the bill'}
    </button>
  )
}

/** AI bill / menu scanner. Only shown when VITE_SCAN_ENABLED=true (the scan-bill Edge Function is deployed). */
function Scanner({ members, setBill, autoScan, onScanned }) {
  const fileRef = useRef(null)
  const [photos, setPhotos] = useState([])
  const [hint, setHint] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => { if (autoScan) fileRef.current?.click() }, [autoScan])

  async function pick(e) {
    const files = [...e.target.files].slice(0, 4)
    e.target.value = ''
    if (!files.length) return
    try { setPhotos(await Promise.all(files.map((f) => compressImage(f)))) } catch (x) { setErr(x.message) }
  }
  async function scan() {
    setBusy(true); setErr(null)
    const { data, error } = await supabase.functions.invoke('scan-bill', {
      body: { images: photos.map(({ mime, data }) => ({ mime, data })), members: members.map((m) => ({ id: m.id, name: m.name })), hint },
    })
    setBusy(false)
    if (error || data?.error || !data?.items?.length) return setErr(data?.error || 'Could not read that bill. Add the items by hand below.')
    setBill((b) => ({
      ...b,
      items: data.items.map((it) => newItem({ name: it.name, qty: it.qty, price: paiseToInput(it.amount_paise), weights: Object.fromEntries((it.assigned || []).map((id) => [id, 1])) })),
      tax: data.tax_paise ? paiseToInput(data.tax_paise) : '',
      service: data.service_paise ? paiseToInput(data.service_paise) : '',
      tip: data.tip_paise ? paiseToInput(data.tip_paise) : '',
      discount: data.discount_paise ? paiseToInput(data.discount_paise) : '',
    }))
    onScanned?.(data)
  }
  return (
    <div className="card flat stack-sm scan-box">
      <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={pick} />
      {!photos.length ? (
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>📷 Scan the bill. AI fills the items</button>
      ) : (
        <>
          <div className="thumbs">{photos.map((p, i) => <img key={i} src={p.preview} alt={`Bill photo ${i + 1}`} />)}</div>
          <input value={hint} onChange={(e) => setHint(e.target.value)} maxLength={600} placeholder="Optional: “Rahul had biryani, naan for everyone”" />
          <button type="button" className="btn primary" onClick={scan} disabled={busy}>{busy ? 'Reading bill…' : 'Read this bill'}</button>
        </>
      )}
      {err && <p className="note err small">{err}</p>}
    </div>
  )
}

function totalOf(b) {
  const x = billFromState(b)
  return x.items.reduce((a, i) => a + i.amount_paise, 0) + x.tax_paise + x.service_paise + x.tip_paise - x.discount_paise
}
