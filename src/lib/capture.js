// 📡 Trip Tracking — turn bank/UPI SMS and bank-statement CSVs into draft expenses.
// Privacy: we keep only amount, merchant and time. Account numbers, refs and balances are never stored.

import { guessCategory } from './categories.js'

const AMOUNT = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/i
const CREDIT = /\b(credited|received|refund(?:ed)?|reversed|cashback|deposited)\b/i
const DEBIT = /\b(debited|spent|paid|sent|purchase|withdrawn|txn|transaction|payment|dr\b|trf)/i
const NOISE = /\b(otp|one time password|due|bill generated|statement|minimum amount|emi of)\b/i
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }

/** Parse one SMS / notification. Returns { amount_paise, merchant, txn_at, category } or null. */
export function parseSms(text, now = new Date()) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  if (!t || CREDIT.test(t) || NOISE.test(t)) return null
  const m = t.match(AMOUNT)
  if (!m || !DEBIT.test(t)) return null
  const amount_paise = Math.round(Number(m[1].replace(/,/g, '')) * 100)
  if (!(amount_paise > 0)) return null
  const merchant = findMerchant(t)
  return { amount_paise, merchant, txn_at: findDate(t, now).toISOString(), category: guessCategory(merchant + ' ' + t) }
}

/** Parse a block of pasted text that may contain many SMS (separated by new lines). */
export function parseManySms(block, now = new Date()) {
  const chunks = String(block || '')
    .split(/\n\s*\n|\r?\n(?=.*(?:₹|rs\.?|inr)\s*[\d,])/i)
    .map((s) => s.trim())
    .filter(Boolean)
  const out = []
  for (const c of chunks) {
    const p = parseSms(c, now)
    if (p) out.push(p)
  }
  return out
}

function findMerchant(t) {
  // UPI handle: "to VPA swiggy@icici", "VPA zomato.payu@hdfcbank"
  const vpa = t.match(/\bvpa\s+([a-z0-9._-]+)@[a-z]+/i) || t.match(/\bto\s+([a-z0-9._-]+)@[a-z]+/i)
  if (vpa) return tidy(vpa[1].replace(/[._-]?(payu|razorpay|paytm|pay|upi|ptm|ybl|okicici|axl)$/i, ''))
  // strongest keywords first; skip anything that is really an amount or an account
  const STOP = "(?=\\s+(?:on|via|using|ref|upi|avl|bal|from|thru|through|by)\\b|[.(,]|$)"
  for (const kw of ['trf to', 'paid to', 'sent to', 'at', 'towards', 'to', 'for']) {
    const re = new RegExp(`\\b${kw}\\s+([A-Za-z][A-Za-z0-9&'. -]{1,39}?)${STOP}`, 'i')
    const m = t.match(re)
    if (m && !/^(a\/?c|account|your|the|rs|inr|card|bank)\b/i.test(m[1])) return tidy(m[1])
  }
  return 'Payment'
}

const tidy = (s) =>
  s.replace(/\s+/g, ' ').replace(/\b(pvt|ltd|private|limited|india|technologies|tech)\b\.?/gi, '').trim()
    .toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 40) || 'Payment'

function findDate(t, now) {
  let m
  // 2026-11-24 or 2026-11-24:20:15
  if ((m = t.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})(?:[ T:](\d{1,2}):(\d{2}))?/))) return mk(+m[1], +m[2] - 1, +m[3], m[4], m[5])
  // 24-Nov-26 / 24 Nov 2026
  if ((m = t.match(/\b(\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ,]+(\d{2,4})\b/)) && MONTHS[m[2].toLowerCase()] !== undefined)
    return mk(year(m[3]), MONTHS[m[2].toLowerCase()], +m[1])
  // 24-11-26 / 24/11/2026
  if ((m = t.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/))) return mk(year(m[3]), +m[2] - 1, +m[1])
  return now
  function mk(y, mo, d, h, mi) {
    const x = new Date(y, mo, d, h ? +h : now.getHours(), mi ? +mi : now.getMinutes())
    return Number.isNaN(x.getTime()) ? now : x
  }
}
const year = (y) => (String(y).length === 2 ? 2000 + Number(y) : Number(y))

// ---------------------------------------------------------------- bank statement CSV

/** Minimal CSV reader that handles quotes and commas inside quotes. */
export function readCsv(text) {
  const rows = []
  let row = [], cell = '', q = false
  const s = String(text || '').replace(/\r/g, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') q = false
      else cell += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { row.push(cell.trim()); cell = '' }
    else if (ch === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = '' }
    else cell += ch
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row) }
  return rows.filter((r) => r.some((c) => c !== ''))
}

/**
 * Parse a bank statement CSV (HDFC, SBI, ICICI, Axis, Kotak … exports all look roughly alike).
 * Finds the header row, then the date / description / debit columns. Credits are ignored.
 */
export function parseStatementCsv(text, { from, to } = {}) {
  const rows = readCsv(text)
  const hi = rows.findIndex((r) => r.some((c) => /date/i.test(c)) && r.some((c) => /(withdrawal|debit|dr\b|amount)/i.test(c)))
  if (hi < 0) return { items: [], error: 'Could not find the Date / Debit columns. Export the statement as CSV and try again.' }
  const h = rows[hi].map((c) => c.toLowerCase())
  const col = (re) => h.findIndex((c) => re.test(c))
  const iDate = col(/(txn|transaction|value)?\s*date/)
  const iDesc = col(/(narration|description|particulars|details|remarks)/)
  const iDebit = col(/(withdrawal|debit|dr\b)/)
  const iAmt = col(/^amount|amount\s*\(/)
  const iType = col(/(cr\/dr|dr\/cr|type)/)
  const items = []
  for (const r of rows.slice(hi + 1)) {
    let amt = 0
    if (iDebit >= 0) amt = num(r[iDebit])
    else if (iAmt >= 0) {
      const v = num(r[iAmt])
      const type = (r[iType] || '').toLowerCase()
      if (type.startsWith('cr') || (iType < 0 && v > 0 && /\bcr\b/i.test(r.join(' ')))) continue
      amt = Math.abs(v)
    }
    if (!(amt > 0)) continue
    const when = parseAnyDate(r[iDate])
    if (!when) continue
    if (from && when < new Date(from)) continue
    if (to && when > new Date(to)) continue
    const desc = r[iDesc] || 'Payment'
    if (CREDIT.test(desc)) continue
    const merchant = findMerchant(' to ' + desc.replace(/^(upi|pos|imps|neft|ach)[/-]?/i, '').replace(/[/-]/g, ' ') + ' ')
    items.push({ amount_paise: Math.round(amt * 100), merchant: merchant === 'Payment' ? tidy(desc.split(/[/-]/)[1] || desc) : merchant, txn_at: when.toISOString(), category: guessCategory(desc) })
  }
  return { items, error: items.length ? null : 'No spends found in that file for the trip dates.' }
}

const num = (v) => Number(String(v || '').replace(/[₹,\s]/g, '').replace(/^\((.*)\)$/, '-$1')) || 0

export function parseAnyDate(v) {
  const s = String(v || '').trim()
  if (!s) return null
  let m
  if ((m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/))) return new Date(year(m[3]), +m[2] - 1, +m[1])
  if ((m = s.match(/^(\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ](\d{2,4})/)) && MONTHS[m[2].toLowerCase()] !== undefined) return new Date(year(m[3]), MONTHS[m[2].toLowerCase()], +m[1])
  if ((m = s.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})/))) return new Date(+m[1], +m[2] - 1, +m[3])
  return null
}
