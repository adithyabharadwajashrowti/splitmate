import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toPaise, allocate, formatINR } from '../src/lib/money.js'
import { computeSplits, computeItemized } from '../src/lib/splits.js'
import { computeBalances, simplifyDebts } from '../src/lib/balances.js'
import { parseExpense } from '../src/lib/parser.js'
import { guessCategory } from '../src/lib/categories.js'
import { upiLink } from '../src/lib/upi.js'

const sum = (a) => a.reduce((x, y) => x + y, 0)

test('toPaise parses rupees safely', () => {
  assert.equal(toPaise('1,234.5'), 123450)
  assert.equal(toPaise('₹99.99'), 9999)
  assert.equal(toPaise('0.1'), 10)
  assert.ok(Number.isNaN(toPaise('12.345')))
  assert.ok(Number.isNaN(toPaise('abc')))
})

test('formatINR', () => {
  assert.equal(formatINR(123450), '₹1,234.50')
  assert.equal(formatINR(10000000), '₹1,00,000')
})

test('allocate always sums exactly', () => {
  assert.deepEqual(allocate(100000, [1, 1, 1]), [33334, 33333, 33333])
  for (let i = 0; i < 500; i++) {
    const total = Math.floor(Math.random() * 1e7) + 1
    const w = Array.from({ length: 1 + (i % 9) }, () => Math.random() * 5 + 0.1)
    assert.equal(sum(allocate(total, w)), total)
  }
})

test('equal / exact / percent / shares', () => {
  const p = ['a', 'b', 'c']
  assert.equal(sum(computeSplits('equal', 100000, p).splits.map((s) => s.share_paise)), 100000)
  assert.ok(computeSplits('exact', 1000, p, { a: 500, b: 400, c: 0 }).error)
  assert.equal(computeSplits('exact', 1000, p, { a: 500, b: 500, c: 0 }).splits.length, 2)
  assert.ok(computeSplits('percent', 1000, p, { a: 50, b: 30, c: 10 }).error)
  const sh = computeSplits('shares', 90000, p, { a: 2, b: 1, c: 0 }).splits
  assert.deepEqual(sh, [{ user_id: 'a', share_paise: 60000 }, { user_id: 'b', share_paise: 30000 }])
})

test('itemized: veg / non-veg / drinks + GST shared by what you ate', () => {
  // Asha & Dev veg, Rahul non-veg, Rahul + Dev had beer
  const r = computeItemized({
    items: [
      { name: 'Paneer tikka', amount_paise: 30000, weights: { asha: 1, dev: 1 } },
      { name: 'Chicken biryani', amount_paise: 40000, weights: { rahul: 1 } },
      { name: 'Naan', amount_paise: 12000, weights: { asha: 1, dev: 1, rahul: 2 } }, // Rahul had double
      { name: 'Beer', amount_paise: 50000, weights: { rahul: 1, dev: 1 } },
    ],
    tax_paise: 6600,
    service_paise: 6600,
  })
  assert.equal(r.error, null)
  assert.equal(r.subtotal, 132000)
  assert.equal(r.total, 145200)
  assert.equal(sum(r.splits.map((s) => s.share_paise)), 145200)
  assert.equal(r.perPerson.asha.items, 15000 + 3000)
  assert.equal(r.perPerson.rahul.items, 40000 + 6000 + 25000)
  // extras proportional to items: asha 18000/132000 of 13200 = 1800
  assert.equal(r.perPerson.asha.extras, 1800)
})

test('itemized: discount and validation', () => {
  const r = computeItemized({
    items: [{ name: 'Pizza', amount_paise: 1000, weights: { a: 1, b: 1, c: 1 } }],
    discount_paise: 100,
  })
  assert.equal(r.total, 900)
  assert.equal(sum(r.splits.map((s) => s.share_paise)), 900)
  assert.ok(computeItemized({ items: [{ name: 'X', amount_paise: 100, weights: {} }] }).error)
})

test('balances + simplification settle everyone to zero', () => {
  const expenses = [
    { paid_by: 'a', amount_paise: 3000, splits: [{ user_id: 'a', share_paise: 1000 }, { user_id: 'b', share_paise: 1000 }, { user_id: 'c', share_paise: 1000 }] },
    { paid_by: 'b', amount_paise: 1500, splits: [{ user_id: 'c', share_paise: 1500 }] },
    { paid_by: 'c', amount_paise: 600, splits: [{ user_id: 'a', share_paise: 300 }, { user_id: 'd', share_paise: 300 }] },
  ]
  const settlements = [{ from_user: 'd', to_user: 'c', amount_paise: 100 }]
  const bal = computeBalances(expenses, settlements, ['a', 'b', 'c', 'd'])
  assert.equal(sum(Object.values(bal)), 0)
  const pay = simplifyDebts(bal)
  assert.ok(pay.length <= 3)
  for (const p of pay) { bal[p.from] += p.amount; bal[p.to] -= p.amount }
  assert.ok(Object.values(bal).every((v) => v === 0))
})

test('smart parser', () => {
  const members = [
    { id: 'me', name: 'Adithya' }, { id: 'r', name: 'Rahul K' },
    { id: 'a', name: 'Asha' }, { id: 'd', name: 'Dev' }, { id: 'x', name: 'Sathvik' },
  ]
  const p = parseExpense('1200 dinner at Truffles paid by Rahul split with Asha and Dev', members, 'me')
  assert.equal(p.amountPaise, 120000)
  assert.equal(p.paidBy, 'r')
  assert.deepEqual(new Set(p.participants), new Set(['me', 'r', 'a', 'd']))
  assert.equal(p.description, 'Dinner at Truffles')
  assert.equal(p.category, 'food')

  const q = parseExpense('uber 340 with everyone', members, 'me')
  assert.equal(q.amountPaise, 34000)
  assert.equal(q.participants.length, 5)
  assert.equal(q.category, 'travel')

  const k = parseExpense('Asha paid 2.5k for groceries', members, 'me')
  assert.equal(k.amountPaise, 250000)
  assert.equal(k.paidBy, 'a')
  assert.equal(k.description, 'Groceries')
})

test('categories', () => {
  assert.equal(guessCategory('Turf booking Sunday'), 'sports')
  assert.equal(guessCategory('BESCOM electricity'), 'housing')
  assert.equal(guessCategory('random thing'), 'other')
})

test('upi link', () => {
  const l = upiLink({ upiId: 'rahul@okaxis', name: 'Rahul', amountPaise: 45050 })
  assert.match(l, /^upi:\/\/pay\?pa=rahul%40okaxis&pn=Rahul&am=450\.50&cu=INR/)
})

test('itemized: birthday treat redistributes the treated share', () => {
  const r = computeItemized({
    items: [{ name: 'Cake', amount_paise: 90000, weights: { a: 1, b: 1, c: 1 } }],
    treat_ids: ['c'],
  })
  assert.equal(r.perPerson.c.total, 0)
  assert.equal(r.perPerson.a.total, 45000)
  assert.equal(sum(r.splits.map((s) => s.share_paise)), 90000)
  assert.equal(r.splits.length, 2)
  assert.ok(computeItemized({ items: [{ name: 'X', amount_paise: 100, weights: { a: 1 } }], treat_ids: ['a'] }).error)
})

import { rawDebts } from '../src/lib/balances.js'
test('rawDebts nets each pair and matches balances', () => {
  const expenses = [
    { paid_by: 'a', amount_paise: 3000, splits: [{ user_id: 'a', share_paise: 1000 }, { user_id: 'b', share_paise: 1000 }, { user_id: 'c', share_paise: 1000 }] },
    { paid_by: 'b', amount_paise: 1500, splits: [{ user_id: 'a', share_paise: 1500 }] },
  ]
  const d = rawDebts(expenses, [{ from_user: 'c', to_user: 'a', amount_paise: 400 }])
  const ab = d.find((x) => (x.from === 'a' && x.to === 'b') || (x.from === 'b' && x.to === 'a'))
  assert.deepEqual(ab, { from: 'a', to: 'b', amount: 500 })
  assert.deepEqual(d.find((x) => x.from === 'c'), { from: 'c', to: 'a', amount: 600 })
})
