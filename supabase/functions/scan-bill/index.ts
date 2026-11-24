// SplitMate — AI bill / menu scanner (Supabase Edge Function, runs on Deno)
//
// Input  (POST JSON): { images: [{ mime: "image/jpeg", data: "<base64>" }], members: [{id, name}], hint?: string }
// Output (JSON)     : { items: [{ name, qty, amount_paise, assigned: [memberId] }],
//                       tax_paise, service_paise, tip_paise, discount_paise, total_paise, merchant, kind }
//
// The Gemini key lives only here, as a Supabase secret — never in the browser.
//   supabase secrets set GEMINI_API_KEY=xxxx
//   (optional) supabase secrets set GEMINI_MODEL=<model name from Google AI Studio>

import { createClient } from 'npm:@supabase/supabase-js@2'

const MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.7-flash'
const DAILY_LIMIT = Number(Deno.env.get('SCAN_DAILY_LIMIT') ?? '25')
const MAX_IMAGE_BYTES = 4_000_000

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const schema = {
  type: 'OBJECT',
  properties: {
    kind: { type: 'STRING', enum: ['bill', 'menu', 'other'] },
    merchant: { type: 'STRING' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          qty: { type: 'NUMBER' },
          line_total: { type: 'NUMBER', description: 'price for this line in rupees (qty × unit price)' },
          assigned: { type: 'ARRAY', items: { type: 'STRING' }, description: 'member ids who had this, from the hint' },
        },
        required: ['name', 'qty', 'line_total'],
      },
    },
    tax: { type: 'NUMBER', description: 'all taxes combined: CGST + SGST + VAT etc, rupees' },
    service_charge: { type: 'NUMBER' },
    tip: { type: 'NUMBER' },
    discount: { type: 'NUMBER', description: 'positive number' },
    grand_total: { type: 'NUMBER' },
  },
  required: ['kind', 'items'],
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    // ---- who is calling?
    const url = Deno.env.get('SUPABASE_URL')!
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Please sign in again' }, 401)

    // ---- daily limit
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const { count } = await admin.from('bill_scans').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).gte('created_at', since)
    if ((count ?? 0) >= DAILY_LIMIT) return json({ error: `Daily scan limit (${DAILY_LIMIT}) reached — try tomorrow or add items by hand` }, 429)

    // ---- validate input
    const { images, members = [], hint = '' } = await req.json()
    if (!Array.isArray(images) || !images.length || images.length > 4) return json({ error: 'Send 1–4 photos' }, 400)
    for (const im of images) {
      if (!/^image\/(jpeg|png|webp|heic)$/.test(im.mime) || typeof im.data !== 'string') return json({ error: 'Unsupported image' }, 400)
      if (im.data.length * 0.75 > MAX_IMAGE_BYTES) return json({ error: 'Photo too large' }, 413)
    }
    const people = (members as { id: string; name: string }[]).slice(0, 50)
      .map((m) => `- id "${m.id}": ${String(m.name).slice(0, 40)}`).join('\n')

    const prompt = `You read Indian restaurant bills, grocery receipts and menus.
Extract every purchasable line item with quantity and LINE TOTAL in rupees (qty × unit price).
- Do not list subtotal, taxes (CGST/SGST/VAT), service charge, round-off, tip or discount as items; put them in their fields.
- If it is a MENU (no quantities), set kind "menu", qty 1 and line_total = menu price, and only include items mentioned in the hint if a hint is given.
- Fix obvious OCR typos in dish names; keep them short.
- Group members:
${people || '(none given)'}
- Hint from the user about who had what (may be empty): """${String(hint).slice(0, 600)}"""
  Use the hint to fill "assigned" with member ids. "shared", "everyone", "all" → all ids. Leave empty if unknown.
Return only JSON.`

    const gem = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': Deno.env.get('GEMINI_API_KEY')! },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, ...images.map((im: any) => ({ inline_data: { mime_type: im.mime, data: im.data } }))] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0 },
        }),
      },
    )
    if (!gem.ok) {
      console.error('Gemini error', gem.status, await gem.text())
      return json({ error: 'The scanner is busy — try again in a moment' }, 502)
    }
    const out = await gem.json()
    const text = out?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '{}'
    const r = JSON.parse(text)

    await admin.from('bill_scans').insert({ user_id: user.id })

    const ids = new Set(people ? (members as any[]).map((m) => m.id) : [])
    const paise = (v: unknown) => Math.max(0, Math.round(Number(v || 0) * 100))
    const items = (r.items ?? [])
      .map((it: any) => ({
        name: String(it.name ?? '').slice(0, 60).trim(),
        qty: Math.max(1, Number(it.qty) || 1),
        amount_paise: paise(it.line_total),
        assigned: (it.assigned ?? []).filter((id: string) => ids.has(id)),
      }))
      .filter((it: any) => it.name && it.amount_paise > 0)
      .slice(0, 80)

    return json({
      kind: r.kind ?? 'bill',
      merchant: String(r.merchant ?? '').slice(0, 60),
      items,
      tax_paise: paise(r.tax),
      service_paise: paise(r.service_charge),
      tip_paise: paise(r.tip),
      discount_paise: paise(r.discount),
      total_paise: paise(r.grand_total),
    })
  } catch (e) {
    console.error(e)
    return json({ error: 'Could not read that photo — try a clearer, flatter shot' }, 500)
  }
})
