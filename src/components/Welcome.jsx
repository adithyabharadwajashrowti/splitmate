import { useState } from 'react'

const KEY = 'splitmate_tour_v1'

export const tourSeen = () => {
  try { return localStorage.getItem(KEY) === '1' } catch { return true }
}
export const markTourSeen = () => {
  try { localStorage.setItem(KEY, '1') } catch { /* private mode */ }
}

const STEPS = [
  { emoji: '👋', title: 'Welcome to SplitMate', body: 'Split bills with friends by what each person actually ate. No more paying for someone else’s beer.' },
  { emoji: '👥', title: '1. Make a group', body: 'Create a group for a trip, your flat or a dinner. Share the invite link on WhatsApp so friends can join in one tap.' },
  { emoji: '🧾', title: '2. Split a bill', body: 'Tap “Split a bill”, add the dishes, then tap who had what. Veg, non-veg, drinks, extra portions: GST and service charge follow automatically.' },
  { emoji: '✨', title: '3. Or just say it', body: 'Type or speak “1200 dinner paid by Rahul with Asha and Dev” and SplitMate fills in the whole form.' },
  { emoji: '🎁', title: 'Treating someone?', body: 'Use 🎂 Birthday treat to cover one person’s share, or 🙈 Host Mode to hide prices when you’re paying for everyone.' },
  { emoji: '💸', title: '4. Settle up', body: 'SplitMate turns a mess of IOUs into the fewest payments. Pay in one tap with UPI, and confetti tells you you’re square.' },
]

/** First-run guided tour. Shown once; reopen anytime from the ? button. */
export default function Welcome({ onClose, onSample, hasGroups }) {
  const [i, setI] = useState(0)
  const last = i === STEPS.length - 1
  const s = STEPS[i]
  const close = () => { markTourSeen(); onClose() }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal tour" role="dialog" aria-modal="true" aria-label="Welcome tour">
        <div className="tour-art" key={i}><span>{s.emoji}</span></div>
        <div className="modal-body stack" style={{ textAlign: 'center' }}>
          <h2>{s.title}</h2>
          <p className="muted" style={{ lineHeight: 1.55 }}>{s.body}</p>
          <div className="tour-dots" aria-hidden="true">
            {STEPS.map((_, k) => <span key={k} className={k === i ? 'on' : ''} onClick={() => setI(k)} />)}
          </div>
          {!last ? (
            <div className="row-between">
              <button className="link" onClick={close}>Skip</button>
              <div className="row">
                {i > 0 && <button className="btn" onClick={() => setI(i - 1)}>Back</button>}
                <button className="btn primary" onClick={() => setI(i + 1)} autoFocus>Next →</button>
              </div>
            </div>
          ) : (
            <div className="stack-sm">
              {!hasGroups && onSample && (
                <button className="btn primary" onClick={() => { markTourSeen(); onSample() }}>🏖️ Explore a sample trip</button>
              )}
              <button className={`btn ${hasGroups ? 'primary' : ''}`} onClick={close}>{hasGroups ? 'Let’s go' : 'Start with an empty account'}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
