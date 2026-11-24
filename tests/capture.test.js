import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSms, parseManySms, parseStatementCsv } from '../src/lib/capture.js'

const now = new Date(2026, 10, 24, 15, 0)

test('UPI debit SMS (VPA merchant)', () => {
  const p = parseSms('Rs.450.00 debited from A/c XX1234 on 24-11-26 to VPA swiggy@icici (UPI Ref No 432112345678). Not you? Call 1800', now)
  assert.equal(p.amount_paise, 45000)
  assert.equal(p.merchant, 'Swiggy')
  assert.equal(p.category, 'food')
  assert.equal(new Date(p.txn_at).getDate(), 24)
})

test('card spend SMS', () => {
  const p = parseSms('INR 1,250.00 spent on HDFC Bank Card x1234 at ZOMATO on 2026-11-23:20:15:01. Avl Lmt: INR 45,000', now)
  assert.equal(p.amount_paise, 125000)
  assert.equal(p.merchant, 'Zomato')
  assert.equal(new Date(p.txn_at).getDate(), 23)
})

test('sent to a person', () => {
  const p = parseSms('Sent Rs.300.00 From HDFC Bank A/C x1234 To RAHUL KUMAR On 24/11/26 Ref 123456789', now)
  assert.equal(p.amount_paise, 30000)
  assert.equal(p.merchant, 'Rahul Kumar')
})

test('app notification + month-name dates', () => {
  assert.equal(parseSms('Paid ₹120 to Chai Point via PhonePe', now).merchant, 'Chai Point')
  const p = parseSms('Your a/c XX1234 is debited for Rs 899.00 on 22-Nov-26 trf to Uber India', now)
  assert.equal(p.amount_paise, 89900)
  assert.equal(p.merchant, 'Uber')
  assert.equal(p.category, 'travel')
})

test('ignores credits, OTPs and bill reminders', () => {
  assert.equal(parseSms('Rs.5000 credited to your A/c XX1234 by NEFT', now), null)
  assert.equal(parseSms('123456 is your OTP for txn of Rs.450 at Amazon', now), null)
  assert.equal(parseSms('Your credit card bill of Rs.12,000 is due on 5 Dec', now), null)
})

test('many SMS pasted at once', () => {
  const block = `Rs.450.00 debited from A/c XX1234 on 24-11-26 to VPA swiggy@icici
Rs.5000 credited to your A/c XX1234
INR 1,250.00 spent on Card x1234 at ZOMATO on 2026-11-23

Paid ₹120 to Chai Point via PhonePe`
  const r = parseManySms(block, now)
  assert.equal(r.length, 3)
  assert.deepEqual(r.map((x) => x.merchant), ['Swiggy', 'Zomato', 'Chai Point'])
})

test('bank statement CSV, filtered to trip dates', () => {
  const csv = `HDFC BANK,,,,
Account XX1234,,,,
Date,Narration,Chq./Ref.No.,Withdrawal Amt.,Deposit Amt.,Closing Balance
20/11/26,UPI-SWIGGY-swiggy@icici-ICIC0001,123,450.00,,10000
22/11/26,UPI-UBER INDIA-uber@axis-UTIB0001,124,899.00,,9101
22/11/26,NEFT CR-SALARY,125,,50000.00,59101
23/11/26,"POS 1234 ZOMATO, BANGALORE",126,"1,250.00",,57851
26/11/26,UPI-AMAZON-amazon@apl,127,2000.00,,55851`
  const r = parseStatementCsv(csv, { from: new Date(2026, 10, 21), to: new Date(2026, 10, 25) })
  assert.equal(r.error, null)
  assert.equal(r.items.length, 2)
  assert.deepEqual(r.items.map((x) => x.amount_paise), [89900, 125000])
})
