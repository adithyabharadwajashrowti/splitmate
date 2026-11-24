/**
 * Net balance per user in a group (paise).
 *   positive → the group owes them
 *   negative → they owe the group
 */
export function computeBalances(expenses, settlements, memberIds = []) {
  const bal = Object.fromEntries(memberIds.map((id) => [id, 0]))
  const add = (id, v) => (bal[id] = (bal[id] || 0) + v)

  for (const e of expenses) {
    add(e.paid_by, e.amount_paise)
    for (const s of e.expense_splits || e.splits || []) add(s.user_id, -s.share_paise)
  }
  for (const s of settlements) {
    add(s.from_user, s.amount_paise) // paying back reduces what you owe
    add(s.to_user, -s.amount_paise)
  }
  return bal
}

/**
 * Minimise the number of payments needed to settle everyone up.
 * Greedy: repeatedly match the biggest debtor with the biggest creditor.
 * Produces at most (n − 1) payments and is exact in paise.
 * @returns {{from:string, to:string, amount:number}[]}
 */
export function simplifyDebts(balances) {
  const creditors = []
  const debtors = []
  for (const [id, v] of Object.entries(balances)) {
    if (v > 0) creditors.push({ id, v })
    else if (v < 0) debtors.push({ id, v: -v })
  }
  const byAmount = (a, b) => b.v - a.v || a.id.localeCompare(b.id)
  const out = []
  creditors.sort(byAmount)
  debtors.sort(byAmount)
  while (creditors.length && debtors.length) {
    const c = creditors[0]
    const d = debtors[0]
    const amt = Math.min(c.v, d.v)
    out.push({ from: d.id, to: c.id, amount: amt })
    c.v -= amt
    d.v -= amt
    if (!c.v) creditors.shift()
    if (!d.v) debtors.shift()
    creditors.sort(byAmount)
    debtors.sort(byAmount)
  }
  return out
}

/** How many payments it would take without simplification (pairwise net debts). */
export function rawDebtCount(expenses) {
  const pair = {}
  for (const e of expenses) {
    for (const s of e.expense_splits || e.splits || []) {
      if (s.user_id === e.paid_by) continue
      const [a, b] = [s.user_id, e.paid_by].sort()
      const sign = s.user_id === a ? 1 : -1
      pair[a + '|' + b] = (pair[a + '|' + b] || 0) + sign * s.share_paise
    }
  }
  return Object.values(pair).filter((v) => v !== 0).length
}

/**
 * Pairwise debts BEFORE simplification (who owes whom directly), after netting each pair.
 * Used by the Debt Untangler graph.
 */
export function rawDebts(expenses, settlements = []) {
  const pair = {}
  const add = (debtor, creditor, amt) => {
    const [a, b] = [debtor, creditor].sort()
    const sign = debtor === a ? 1 : -1 // + means a owes b
    pair[a + '|' + b] = (pair[a + '|' + b] || 0) + sign * amt
  }
  for (const e of expenses) {
    for (const s of e.expense_splits || e.splits || []) if (s.user_id !== e.paid_by) add(s.user_id, e.paid_by, s.share_paise)
  }
  for (const s of settlements) add(s.to_user, s.from_user, s.amount_paise) // repayment reduces from_user's debt
  return Object.entries(pair)
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => {
      const [a, b] = k.split('|')
      return v > 0 ? { from: a, to: b, amount: v } : { from: b, to: a, amount: -v }
    })
}

/**
 * SplitScore — a playful CIBIL-style trust score (300–900).
 * Rewards paying upfront and settling up; penalises outstanding debt.
 */
export function splitScores(g) {
  const paid = {}, share = {}, settledCount = {}
  for (const e of g.expenses) {
    paid[e.paid_by] = (paid[e.paid_by] || 0) + e.amount_paise
    for (const s of e.expense_splits || []) share[s.user_id] = (share[s.user_id] || 0) + s.share_paise
  }
  for (const s of g.settlements) settledCount[s.from_user] = (settledCount[s.from_user] || 0) + 1
  const out = {}
  for (const m of g.members) {
    const sh = share[m.id] || 0
    const pd = paid[m.id] || 0
    const bal = g.balances[m.id] || 0
    let score = 650
    score += Math.min(150, sh ? (pd / sh) * 75 : pd ? 150 : 0) // pays upfront
    score += Math.min(80, (settledCount[m.id] || 0) * 40) // settles up
    if (bal < 0 && sh) score -= Math.min(250, (-bal / sh) * 300) // owes a lot of their share
    score = Math.round(Math.max(300, Math.min(900, score)))
    const tier = score >= 800 ? ['Legend', '#d4ff3a'] : score >= 720 ? ['Excellent', '#4ade80'] : score >= 640 ? ['Good', '#a8f0c6'] : score >= 540 ? ['Fair', '#facc15'] : ['Risky', '#ff8a5c']
    out[m.id] = { score, tier: tier[0], color: tier[1] }
  }
  return out
}
