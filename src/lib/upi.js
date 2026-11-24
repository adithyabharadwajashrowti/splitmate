/**
 * Build a UPI deep link. On a phone this opens GPay / PhonePe / Paytm / BHIM
 * with the payee, amount and note pre-filled. The payer still confirms with their PIN.
 */
export function upiLink({ upiId, name, amountPaise, note }) {
  const params = new URLSearchParams({
    pa: upiId,
    pn: name || 'SplitMate friend',
    am: (amountPaise / 100).toFixed(2),
    cu: 'INR',
    tn: (note || 'SplitMate settle up').slice(0, 50),
  })
  return `upi://pay?${params.toString()}`
}

export const isValidUpi = (v) => /^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,64}$/.test(v || '')

export const isMobile = () =>
  typeof navigator !== 'undefined' && /android|iphone|ipad|ipod/i.test(navigator.userAgent)
