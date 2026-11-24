import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

/**
 * When does the welcome tour show?
 *  - Demo account: every time someone signs in to it (cleared on sign-out).
 *  - Real accounts: once, right after sign-up — remembered in the database so it
 *    doesn't come back on another phone or laptop.
 */
const DEMO_KEY = 'splitmate_demo_tour_seen'
const userKey = (id) => `splitmate_tour_done_${id}`

export function shouldShowTour({ user, profile, isDemo }) {
  if (!user) return false
  try {
    if (isDemo) return sessionStorage.getItem(DEMO_KEY) !== '1'
    if (localStorage.getItem(userKey(user.id)) === '1') return false
  } catch { /* storage blocked */ }
  if (!profile) return false // wait until the profile loads
  return !profile.tour_done
}

export async function markTourSeen({ user, isDemo, refreshProfile } = {}) {
  try {
    if (isDemo) { sessionStorage.setItem(DEMO_KEY, '1'); return }
    if (user) localStorage.setItem(userKey(user.id), '1')
  } catch { /* ignore */ }
  if (user && !isDemo) {
    await supabase.from('profiles').update({ tour_done: true }).eq('id', user.id)
    refreshProfile?.()
  }
}

/** Called on demo sign-out so the next person sees the tour from the start. */
export function resetDemoTour() {
  try { sessionStorage.removeItem(DEMO_KEY) } catch { /* ignore */ }
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
export default function Welcome({ onClose, onSample, hasGroups, onSeen }) {
  const [i, setI] = useState(0)
  const last = i === STEPS.length - 1
  const s = STEPS[i]
  const close = () => { onSeen?.(); onClose() }

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
                <button className="btn primary" onClick={() => { onSeen?.(); onSample() }}>🏖️ Explore a sample trip</button>
              )}
              <button className={`btn ${hasGroups ? 'primary' : ''}`} onClick={close}>{hasGroups ? 'Let’s go' : 'Start with an empty account'}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
