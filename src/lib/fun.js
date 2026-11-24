import { formatINR } from './money.js'
import { category } from './categories.js'
import { appUrl } from './supabase.js'

/** 🎉 Lightweight confetti burst, no library needed. */
export function confetti() {
  if (typeof document === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const colors = ['#d4ff3a', '#8b7bff', '#ff6fae', '#4ade80', '#facc15']
  const layer = document.createElement('div')
  layer.className = 'confetti-layer'
  for (let i = 0; i < 120; i++) {
    const p = document.createElement('i')
    p.style.left = Math.random() * 100 + 'vw'
    p.style.background = colors[i % colors.length]
    p.style.animationDelay = Math.random() * 0.4 + 's'
    p.style.animationDuration = 1.6 + Math.random() * 1.4 + 's'
    p.style.setProperty('--x', (Math.random() * 2 - 1) * 160 + 'px')
    p.style.setProperty('--r', Math.random() * 720 + 'deg')
    layer.appendChild(p)
  }
  document.body.appendChild(layer)
  setTimeout(() => layer.remove(), 3500)
}

const nameOf = (g, id) => g.byId[id]?.name || 'Former member'

/** Download all expenses + settlements as a CSV (opens in Excel / Google Sheets). */
export function exportCsv(g) {
  const people = g.members.map((m) => m.id)
  const head = ['Date', 'Type', 'Description', 'Category', 'Paid by', 'Amount (₹)', ...people.map((id) => `${nameOf(g, id)} share (₹)`)]
  const rows = g.expenses.map((e) => [
    e.expense_date, 'Expense', e.description, category(e.category).label, nameOf(g, e.paid_by), (e.amount_paise / 100).toFixed(2),
    ...people.map((id) => ((e.expense_splits.find((s) => s.user_id === id)?.share_paise || 0) / 100).toFixed(2)),
  ])
  for (const s of g.settlements) {
    rows.push([s.created_at.slice(0, 10), 'Settlement', `${nameOf(g, s.from_user)} paid ${nameOf(g, s.to_user)}`, s.method.toUpperCase(),
      nameOf(g, s.from_user), (s.amount_paise / 100).toFixed(2), ...people.map(() => '')])
  }
  rows.sort((a, b) => (a[0] < b[0] ? 1 : -1))
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`
  const csv = '﻿' + [head, ...rows].map((r) => r.map(esc).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: `${g.group.name.replace(/[^\w-]+/g, '_')}_splitmate.csv` })
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** WhatsApp-ready summary: totals + who pays whom. */
export function whatsappSummary(g) {
  const total = g.expenses.reduce((a, e) => a + e.amount_paise, 0)
  const lines = [
    `*${g.group.emoji} ${g.group.name}*: SplitMate summary`,
    `Total spent: ${formatINR(total)} across ${g.expenses.length} expenses`,
    '',
    g.payments.length ? '*To settle up:*' : '✨ Everyone is settled up!',
    ...g.payments.map((p) => {
      const upi = g.byId[p.to]?.upi_id
      return `• ${nameOf(g, p.from)} → ${nameOf(g, p.to)}: *${formatINR(p.amount)}*${upi ? ` (UPI: ${upi})` : ''}`
    }),
    '',
    `Open the group: ${appUrl(`/join/${g.group.invite_code}`)}`,
  ]
  return `https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`
}

/** Fun group awards for the Insights tab. */
export function badges(g) {
  if (!g.expenses.length) return []
  const paid = {}
  const share = {}
  const food = {}
  for (const e of g.expenses) {
    paid[e.paid_by] = (paid[e.paid_by] || 0) + e.amount_paise
    for (const s of e.expense_splits) {
      share[s.user_id] = (share[s.user_id] || 0) + s.share_paise
      if (e.category === 'food') food[s.user_id] = (food[s.user_id] || 0) + s.share_paise
    }
  }
  const top = (obj, dir = 1) => Object.entries(obj).sort((a, b) => dir * (b[1] - a[1]))[0]
  const out = []
  const p = top(paid); if (p) out.push({ icon: '💳', title: 'The Banker', who: p[0], note: `paid ${formatINR(p[1])} upfront` })
  const f = top(food); if (f) out.push({ icon: '🍗', title: 'Chief Foodie', who: f[0], note: `ate ${formatINR(f[1])} of food` })
  const l = top(share, -1); if (l && g.members.length > 2) out.push({ icon: '🪶', title: 'Light Traveller', who: l[0], note: `smallest share: ${formatINR(l[1])}` })
  const hosted = {}
  for (const e of g.expenses) if (e.items?.host_mode) hosted[e.paid_by] = (hosted[e.paid_by] || 0) + 1
  const h = top(hosted); if (h) out.unshift({ icon: '🎁', title: 'Generous Host', who: h[0], note: `treated the group ${h[1]} time${h[1] > 1 ? 's' : ''}` })
  const settled = {}
  for (const s of g.settlements) settled[s.from_user] = (settled[s.from_user] || 0) + 1
  const q = top(settled); if (q) out.push({ icon: '⚡', title: 'Quick Settler', who: q[0], note: `paid back ${q[1]} time${q[1] > 1 ? 's' : ''}` })
  return out
}

/** Tiny vibration on phones that support it: makes taps feel physical. */
export function haptic(ms = 8) {
  try { if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(ms) } catch { /* ignore */ }
}

/** App-wide toast: toast('Saved ✓'). Rendered by <Toaster/> in App. */
export function toast(message, emoji = '✅') {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('splitmate:toast', { detail: { message, emoji, id: Date.now() + Math.random() } }))
}
