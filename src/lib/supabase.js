import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  // Shown in the browser console if .env (or Netlify env vars) are missing
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — see README step 3')
}

export const supabase = createClient(url || 'http://localhost', key || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

/** Turn Supabase/Postgres errors into short, human messages. */
export function niceError(err) {
  const m = err?.message || err?.error_description || String(err || 'Something went wrong')
  const rules = [
    [/Invalid login credentials/i, 'Wrong email or password'],
    [/Email not confirmed/i, 'Please confirm your email first — check your inbox'],
    [/User already registered|already been registered/i, 'That email already has an account — sign in instead'],
    [/Password should be at least/i, 'Password must be at least 8 characters'],
    [/rate limit|too many requests|429/i, 'Too many attempts — wait a minute and try again'],
    [/Failed to fetch|NetworkError|Load failed|ERR_INTERNET/i, 'No internet connection — check your Wi-Fi and retry'],
    [/JWT expired|invalid JWT|refresh token/i, 'Session expired — please sign in again'],
    [/row-level security|permission denied/i, 'You don’t have permission to do that in this group'],
    [/invalid input syntax for type uuid/i, 'That link looks broken — go back and open the group again'],
    [/duplicate key/i, 'That already exists'],
    [/violates foreign key/i, 'Someone in this action is no longer in the group'],
    [/description_check/i, 'Description must be 1–120 characters'],
    [/display_name_check/i, 'Name must be 1–40 characters'],
    [/name_check/i, 'Name is too long or empty'],
    [/upi_id_check/i, 'UPI ID looks wrong — it should look like name@okaxis'],
    [/amount_paise_check|budget_paise_check/i, 'Enter an amount above ₹0'],
    [/from_user.*to_user|settlements_check/i, 'Pick two different people'],
    [/violates check constraint/i, 'Some details look invalid — please check the form'],
    [/Could not find the function|schema cache/i, 'The app was just updated — refresh the page (Ctrl+Shift+R)'],
  ]
  for (const [re, msg] of rules) if (re.test(m)) return msg
  return m.replace(/^.*?exception:\s*/i, '')
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v) => UUID.test(v || '')

/**
 * Safe RPC call used everywhere in the app:
 *  - empty strings become null (Postgres rejects "" for uuid columns)
 *  - any *_id / p_from / p_to / p_paid_by argument must be a real UUID or null
 *  - network failures come back as { error } instead of throwing
 */
const ID_ARG = /(_id$|^p_from$|^p_to$|^p_paid_by$)/
export async function callRpc(name, args = {}) {
  const clean = {}
  for (const [k, v] of Object.entries(args)) {
    let val = typeof v === 'string' ? v.trim() : v
    if (val === '' || val === undefined || (typeof val === 'number' && !Number.isFinite(val))) val = null
    if (ID_ARG.test(k) && val !== null && !isUuid(val)) {
      return { data: null, error: { message: k === 'p_group_id' ? 'Group not found — go back and open it again' : 'Pick a person from the list first' } }
    }
    clean[k] = val
  }
  if ('p_group_id' in clean && !clean.p_group_id) return { data: null, error: { message: 'Group not found — go back and open it again' } }
  if (Array.isArray(clean.p_splits)) {
    if (clean.p_splits.some((x) => !isUuid(x.user_id))) return { data: null, error: { message: 'Pick who shares this expense' } }
  }
  try {
    return await supabase.rpc(name, clean)
  } catch (e) {
    return { data: null, error: e }
  }
}

/** Absolute link to a page of this app, e.g. appUrl('/join/AB12') — works on GitHub Pages sub-paths too. */
export const appUrl = (path = '/') => `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}${path}`
