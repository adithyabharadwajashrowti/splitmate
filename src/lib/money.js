// All money is handled as integer PAISE (₹1 = 100 paise) to avoid float errors.

/** "1,234.50" | 1234.5 → 123450. Returns NaN for invalid input. */
export function toPaise(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) : NaN
  const clean = String(value ?? '').replace(/[₹,\s]/g, '').replace(/rs\.?/i, '')
  if (!/^\d*\.?\d{0,2}$/.test(clean) || clean === '' || clean === '.') return NaN
  const [r, p = ''] = clean.split('.')
  return Number(r || 0) * 100 + Number((p + '00').slice(0, 2))
}

/** 123450 → "1234.50" (for input boxes) */
export function paiseToInput(paise) {
  return (paise / 100).toFixed(2).replace(/\.00$/, '')
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 0 })

/** 123450 → "₹1,234.5" ; signed=false shows absolute value */
export function formatINR(paise, { signed = false } = {}) {
  const v = signed ? paise : Math.abs(paise)
  const out = inr.format(v / 100)
  return out.replace(/\.(\d)$/, '.$10') // ₹1,234.5 → ₹1,234.50
}

/**
 * Split `total` paise into integer parts proportional to `weights`,
 * guaranteed to sum exactly to `total` (largest-remainder method).
 * Ties are broken by order, so results are deterministic.
 */
export function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (sum <= 0) throw new Error('Weights must add up to more than zero')
  const sign = total < 0 ? -1 : 1
  const abs = Math.abs(total)
  const raw = weights.map((w) => (abs * w) / sum)
  const parts = raw.map(Math.floor)
  let left = abs - parts.reduce((a, b) => a + b, 0)
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .filter((x) => weights[x.i] > 0)
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) parts[order[k].i]++
  return parts.map((p) => p * sign)
}
