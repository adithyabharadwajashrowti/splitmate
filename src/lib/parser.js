import { guessCategory } from './categories.js'

/**
 * Smart entry: turn a sentence into an expense draft.
 *   "1200 dinner at Truffles paid by Rahul split with Asha and Dev"
 *   "uber 340 with everyone"
 *   "Asha paid 2.5k for groceries"
 *
 * @param {string} text
 * @param {{id:string, name:string}[]} members
 * @param {string} meId
 * @returns {{ amountPaise:number|null, description:string, paidBy:string, participants:string[],
 *             category:string, unknownNames:string[] }}
 */
export function parseExpense(text, members, meId) {
  let t = ` ${text.trim()} `
  const unknownNames = []

  // ---- amount: ₹1,200 | rs 1200 | 1200.50 | 2.5k
  let amountPaise = null
  const m = t.match(/(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{2,3})+|\d+(?:\.\d{1,2})?)\s*(k)?\b/i)
  if (m) {
    let v = Number(m[1].replace(/,/g, ''))
    if (m[2]) v *= 1000
    amountPaise = Math.round(v * 100)
    t = t.replace(m[0], ' ')
  }

  // ---- who paid: "paid by X" | "X paid" | "I paid"
  let paidBy = meId
  const findMember = (raw) => {
    const n = raw.trim().toLowerCase()
    if (!n) return null
    if (['i', 'me', 'myself', 'mine'].includes(n)) return meId
    const exact = members.find((x) => x.name.toLowerCase() === n || first(x.name) === n)
    if (exact) return exact.id
    const pre = members.filter((x) => x.name.toLowerCase().startsWith(n))
    return pre.length === 1 ? pre[0].id : null
  }

  const pb = t.match(/\bpaid\s+by\s+([a-z][\w.]*)/i) || t.match(/\b([a-z][\w.]*)\s+paid\b/i)
  if (pb) {
    const id = findMember(pb[1])
    if (id) paidBy = id
    else unknownNames.push(pb[1])
    t = t.replace(pb[0], ' ')
  }

  // ---- who shares: "split with A, B and C" | "with A & B" | "between ..." | "with everyone"
  let participants = members.map((x) => x.id)
  const sw = t.match(/\b(?:split\s+(?:with|between|among)|shared\s+with|with|between|among)\s+(.+?)(?=\s+(?:for|at|on|paid)\b|$)/i)
  if (sw) {
    const chunk = sw[1].trim()
    if (!/^(everyone|everybody|all|the group|group)\b/i.test(chunk)) {
      const names = chunk.split(/\s*(?:,|&|\band\b|\+)\s*/i).filter(Boolean)
      const ids = new Set([meId, paidBy])
      for (const n of names) {
        const id = findMember(n)
        if (id) ids.add(id)
        else unknownNames.push(n)
      }
      // "with only X" style phrasing still includes the person entering it, like Splitwise
      participants = [...ids]
    }
    t = t.replace(sw[0], ' ')
  }

  const description = cap(
    t.replace(/\b(for|on|split|equally)\b\s*$/i, '')
      .replace(/^\s*(for|on)\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim(),
  )

  return {
    amountPaise,
    description,
    paidBy,
    participants,
    category: guessCategory(text),
    unknownNames,
  }
}

const first = (name) => name.toLowerCase().split(/\s+/)[0]
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)
