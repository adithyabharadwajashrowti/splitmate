import { useState } from 'react'
import { Link } from 'react-router-dom'
import Welcome from '../components/Welcome.jsx'

const SECTIONS = [
  {
    icon: '🚀', title: 'Getting started',
    items: [
      ['Create a group', 'On the home screen tap “+ New group”, give it a name and an emoji (Goa Trip 🏖️, Flat 302 🏠).'],
      ['Invite friends', 'Open the group → Members → Share on WhatsApp. Friends tap the link, sign up, and land straight in the group.'],
      ['Add your UPI ID', 'Profile → UPI ID (like name@okaxis). Then friends can pay you back in one tap.'],
      ['Set your food preference', 'Profile → Veg / Non-veg. When splitting a bill, one tap selects all the veg people for a dish.'],
    ],
  },
  {
    icon: '🧾', title: 'Splitting bills',
    items: [
      ['Split a bill (itemized)', 'Add each dish and its price, then tap who had it. Shared dishes are split between whoever you tap.'],
      ['Someone ate more?', 'Under a dish tap “Someone had more / less?” and give them 2 portions or ½ a portion.'],
      ['Fast assign', 'Pick a person at the top, then tap every dish they had. Great for big tables.'],
      ['GST, service, tip', 'Enter them once. They’re shared in proportion to what each person ate, so the salad person pays salad-level GST.'],
      ['🎂 Birthday treat', 'Tap the birthday person in the pink box. Their share is split among everyone else.'],
      ['🙈 Host Mode', 'Paying for everyone? Turn on Host Mode: prices hide, guests tap what they had, you pay and they owe ₹0. Press and hold 🔒 to peek.'],
    ],
  },
  {
    icon: '✨', title: 'Quick expenses',
    items: [
      ['Type it like a message', '“1200 dinner at Truffles paid by Rahul with Asha and Dev”: the amount, payer, people and category all fill themselves in.'],
      ['Say it 🎙️', 'Tap the mic and speak the same sentence. Works in Chrome and Edge (allow the microphone).'],
      ['Other ways to split', 'Equally, exact ₹ amounts, percentages, or shares (2 = had double).'],
    ],
  },
  {
    icon: '💸', title: 'Settling up',
    items: [
      ['Who pays whom', 'Balances tab → Debt Untangler shows how the tangled debts become the fewest payments.'],
      ['Pay with UPI', 'Tap “Pay”. On your phone it opens GPay / PhonePe / Paytm with the amount filled in. Then tap “Record payment”.'],
      ['Remind a friend', 'If someone owes you, “Remind” opens WhatsApp with a polite message and your UPI ID.'],
      ['Share a summary', 'Expenses tab → Share summary sends the whole “who pays whom” list to your WhatsApp group.'],
    ],
  },
  {
    icon: '🎉', title: 'Fun stuff',
    items: [
      ['🎬 Trip Wrapped', 'Your trip as Spotify-Wrapped-style stories: total spent, biggest splurge, the group’s ATM…'],
      ['🎡 Who pays next?', 'Spin the wheel for the next chai. In Fair mode, whoever owes most gets the biggest slice.'],
      ['📊 SplitScore', 'A CIBIL-style 300–900 score per friend. Pay upfront and settle fast to become a Legend.'],
      ['🎯 Trip budget', 'Admins can set a budget, and a bar shows how much is left.'],
    ],
  },
  {
    icon: '🔒', title: 'Privacy & safety',
    items: [
      ['Who sees my data?', 'Only people in the same group. Every table is protected by row-level security in the database.'],
      ['Exact money maths', 'Amounts are stored in paise (whole numbers), so splits always add up to the exact bill, never ₹0.01 off.'],
      ['Leaving a group', 'Members → Leave. You need a ₹0 balance first, so nobody gets stuck with your share.'],
    ],
  },
]

export default function Help() {
  const [open, setOpen] = useState(0)
  const [tour, setTour] = useState(false)
  return (
    <div className="stack-lg fade-in">
      <section>
        <Link to="/" className="back">← Home</Link>
        <h1 className="page-title" style={{ marginTop: 10 }}>How SplitMate works</h1>
        <p className="muted">Everything you need in two minutes.</p>
        <button className="btn primary" style={{ marginTop: 14 }} onClick={() => setTour(true)}>▶ Replay the welcome tour</button>
      </section>
      <section className="stack">
        {SECTIONS.map((s, k) => (
          <div key={s.title} className={`card help-section ${open === k ? 'open' : ''}`}>
            <button className="help-head" onClick={() => setOpen(open === k ? -1 : k)} aria-expanded={open === k}>
              <span className="help-icon">{s.icon}</span>
              <strong>{s.title}</strong>
              <span className="muted">{open === k ? '−' : '+'}</span>
            </button>
            {open === k && (
              <div className="help-items">
                {s.items.map(([t, d]) => (
                  <div key={t} className="help-item"><strong>{t}</strong><p className="muted">{d}</p></div>
                ))}
              </div>
            )}
          </div>
        ))}
      </section>
      {tour && <Welcome hasGroups onClose={() => setTour(false)} />}
    </div>
  )
}
