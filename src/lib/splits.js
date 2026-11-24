import { allocate } from './money.js'

/**
 * Turn the form's input into exact per-person shares (in paise).
 *
 * @param {'equal'|'exact'|'percent'|'shares'} type
 * @param {number} totalPaise
 * @param {string[]} people      user ids taking part
 * @param {Record<string, number>} values
 *        exact   → paise per person
 *        percent → percentage per person (must total 100)
 *        shares  → weight per person (e.g. 2 for someone who ate double)
 * @returns {{ splits: {user_id:string, share_paise:number}[], error: string|null }}
 */
export function computeSplits(type, totalPaise, people, values = {}) {
  if (!Number.isInteger(totalPaise) || totalPaise <= 0) return fail('Enter an amount above ₹0')
  if (!people.length) return fail('Pick at least one person')

  if (type === 'equal') {
    return ok(people, allocate(totalPaise, people.map(() => 1)))
  }
  if (type === 'exact') {
    const parts = people.map((id) => Math.round(values[id] || 0))
    const sum = parts.reduce((a, b) => a + b, 0)
    if (parts.some((p) => p < 0)) return fail('Amounts cannot be negative')
    if (sum !== totalPaise) {
      const diff = totalPaise - sum
      return fail(`Amounts are ₹${(Math.abs(diff) / 100).toFixed(2)} ${diff > 0 ? 'short of' : 'over'} the total`)
    }
    return ok(people, parts)
  }
  if (type === 'percent') {
    const pct = people.map((id) => Number(values[id] || 0))
    const sum = pct.reduce((a, b) => a + b, 0)
    if (pct.some((p) => p < 0)) return fail('Percentages cannot be negative')
    if (Math.abs(sum - 100) > 0.001) return fail(`Percentages add up to ${round2(sum)}%, not 100%`)
    return ok(people, allocate(totalPaise, pct))
  }
  if (type === 'shares') {
    const w = people.map((id) => Number(values[id] ?? 1))
    if (w.some((x) => x < 0)) return fail('Shares cannot be negative')
    if (w.reduce((a, b) => a + b, 0) <= 0) return fail('Give at least one person a share')
    return ok(people, allocate(totalPaise, w))
  }
  return fail('Unknown split type')
}

/**
 * Itemized bill — e.g. a restaurant where veg/non-veg/drinks are shared by different people.
 *
 * Each item is split only among the people who had it, by their portion weight
 * (1 = normal, 2 = had double, 0.5 = had a little).
 * Tax + service charge + tip − discount are then spread in proportion to what
 * each person's food cost (so someone who only had a salad pays less GST).
 *
 * @param {{ items: {name:string, amount_paise:number, weights: Record<string, number>}[],
 *           tax_paise?:number, service_paise?:number, tip_paise?:number, discount_paise?:number }} bill
 * @returns {{ total:number, subtotal:number, perPerson: Record<string,{items:number, extras:number, total:number}>,
 *             splits:{user_id:string, share_paise:number}[], error:string|null }}
 */
export function computeItemized(bill) {
  const items = (bill.items || []).filter((it) => it.amount_paise > 0)
  const tax = bill.tax_paise || 0
  const service = bill.service_paise || 0
  const tip = bill.tip_paise || 0
  const discount = bill.discount_paise || 0
  const empty = { total: 0, subtotal: 0, perPerson: {}, splits: [] }

  if (!items.length) return { ...empty, error: 'Add at least one item with a price' }
  if ([tax, service, tip, discount].some((x) => x < 0)) return { ...empty, error: 'Extras cannot be negative' }

  const itemTotals = {}
  for (const it of items) {
    const ids = Object.keys(it.weights || {}).filter((id) => it.weights[id] > 0)
    if (!ids.length) return { ...empty, error: `Pick who had “${it.name || 'an item'}”` }
    allocate(it.amount_paise, ids.map((id) => it.weights[id])).forEach((p, k) => {
      itemTotals[ids[k]] = (itemTotals[ids[k]] || 0) + p
    })
  }

  const subtotal = items.reduce((a, it) => a + it.amount_paise, 0)
  const extrasNet = tax + service + tip - discount
  if (subtotal + extrasNet <= 0) return { ...empty, error: 'Discount is larger than the bill' }

  const ids = Object.keys(itemTotals)
  const extras = extrasNet === 0 ? ids.map(() => 0) : allocate(extrasNet, ids.map((id) => itemTotals[id]))

  const perPerson = {}
  ids.forEach((id, k) => {
    perPerson[id] = { items: itemTotals[id], extras: extras[k], total: itemTotals[id] + extras[k], treat: 0 }
  })

  // 🎂 Birthday treat: treated people pay nothing; their share is split equally among everyone else on the bill.
  const treated = (bill.treat_ids || []).filter((id) => perPerson[id])
  if (treated.length) {
    const payers = ids.filter((id) => !treated.includes(id))
    if (!payers.length) return { ...empty, error: 'Someone has to pay — you can’t treat everyone 🙂' }
    const pot = treated.reduce((a, id) => a + perPerson[id].total, 0)
    allocate(pot, payers.map(() => 1)).forEach((p, k) => {
      perPerson[payers[k]].treat = p
      perPerson[payers[k]].total += p
    })
    for (const id of treated) { perPerson[id].treated = true; perPerson[id].total = 0 }
  }
  return {
    total: subtotal + extrasNet,
    subtotal,
    perPerson,
    splits: ids.map((id) => ({ user_id: id, share_paise: perPerson[id].total })).filter((s) => s.share_paise > 0),
    error: null,
  }
}

const round2 = (n) => Math.round(n * 100) / 100
const fail = (error) => ({ splits: [], error })
const ok = (people, parts) => ({
  splits: people.map((user_id, i) => ({ user_id, share_paise: parts[i] })).filter((s) => s.share_paise > 0),
  error: null,
})
