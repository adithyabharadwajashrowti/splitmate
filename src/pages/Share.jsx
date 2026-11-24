import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { supabase, callRpc, niceError } from '../lib/supabase.js'
import { parseManySms } from '../lib/capture.js'
import { formatINR } from '../lib/money.js'
import { toast } from '../lib/fun.js'

/**
 * Android share target: in Messages, long-press a bank SMS → Share → SplitMate.
 * (Works once SplitMate is installed: Chrome menu → "Add to Home screen".)
 */
export default function Share() {
  const [params] = useSearchParams()
  const nav = useNavigate()
  const text = [params.get('title'), params.get('text'), params.get('url')].filter(Boolean).join('\n')
  const items = parseManySms(text)
  const [groups, setGroups] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    supabase.from('groups').select('id, name, emoji, tracking_started_at, tracking_ended_at').order('created_at', { ascending: false })
      .then(({ data, error }) => { if (error) setErr(niceError(error)); else setGroups(data) })
  }, [])

  async function add(g) {
    setBusy(true)
    const { error } = await callRpc('add_captured', { p_group_id: g.id, p_items: items, p_source: 'share' })
    setBusy(false)
    if (error) return setErr(niceError(error))
    toast(`Added to ${g.name} 📥`, '📥')
    nav(`/g/${g.id}`)
  }

  const tracking = (groups || []).filter((x) => x.tracking_started_at && !x.tracking_ended_at)
  const others = (groups || []).filter((x) => !tracking.includes(x))
  return (
    <div className="stack-lg narrow fade-in">
      <Link to="/" className="back">← Home</Link>
      <h1 className="page-title">📲 Add to a trip</h1>
      {!items.length ? (
        <div className="card stack-sm">
          <p>We couldn't find a spend in what you shared.</p>
          <p className="muted small">Share a bank or UPI debit SMS, for example “Rs.450 debited … to VPA swiggy@icici”.</p>
        </div>
      ) : (
        <div className="card stack-sm">
          {items.map((it, i) => (
            <div key={i} className="row-between"><strong>{it.merchant}</strong><strong className="num">{formatINR(it.amount_paise)}</strong></div>
          ))}
        </div>
      )}
      {items.length > 0 && (
        <div className="stack-sm">
          <span className="label">Which trip?</span>
          {groups === null && <p className="muted">Loading…</p>}
          {[...tracking, ...others].map((x) => (
            <button key={x.id} className={`chooser ${tracking.includes(x) ? 'hot' : ''}`} disabled={busy} onClick={() => add(x)}>
              <span className="chooser-ico">{x.emoji}</span>
              <span className="grow"><strong>{x.name}</strong><small className="muted">{tracking.includes(x) ? '📡 tracking now' : 'not tracking'}</small></span>
              <span className="muted">→</span>
            </button>
          ))}
        </div>
      )}
      {err && <p className="note err">{err}</p>}
    </div>
  )
}
