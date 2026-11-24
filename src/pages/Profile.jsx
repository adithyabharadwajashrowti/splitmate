import { useEffect, useState } from 'react'
import { supabase, niceError } from '../lib/supabase.js'
import { isValidUpi } from '../lib/upi.js'
import { useAuth } from '../auth.jsx'

export const DIETS = { veg: '🥦 Veg', egg: '🥚 Eggetarian', nonveg: '🍗 Non-veg', vegan: '🌱 Vegan' }

export default function Profile() {
  const { user, profile, refreshProfile, signOut } = useAuth()
  const [name, setName] = useState('')
  const [upi, setUpi] = useState('')
  const [diet, setDiet] = useState('')
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const isDemo = !!user?.email && user.email === import.meta.env.VITE_DEMO_EMAIL

  useEffect(() => {
    if (profile) {
      setName(profile.display_name || '')
      setUpi(profile.upi_id || '')
      setDiet(profile.diet || '')
    }
  }, [profile])

  async function save(e) {
    e.preventDefault()
    if (isDemo) return setMsg({ ok: false, text: 'This is the shared demo account, so its profile is locked. Create your own account to try this.' })
    if (!name.trim()) return setMsg({ ok: false, text: 'Name can’t be empty' })
    if (pw && pw.length < 8) return setMsg({ ok: false, text: 'New password must be at least 8 characters' })
    if (upi && !isValidUpi(upi.trim())) return setMsg({ ok: false, text: 'UPI ID looks wrong — it should look like name@okaxis' })
    setBusy(true)
    const { error } = await supabase.from('profiles')
      .update({ display_name: name.trim(), upi_id: upi.trim() || null, diet: diet || null })
      .eq('id', user.id)
    if (!error && pw) {
      const r = await supabase.auth.updateUser({ password: pw })
      if (r.error) { setBusy(false); return setMsg({ ok: false, text: niceError(r.error) }) }
      setPw('')
    }
    setBusy(false)
    if (error) return setMsg({ ok: false, text: niceError(error) })
    setMsg({ ok: true, text: 'Saved' })
    refreshProfile()
  }

  return (
    <div className="stack-lg narrow">
      <h1>Your profile</h1>
      <form className="card stack" onSubmit={save}>
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} /></label>
        <label>UPI ID <small className="muted">— so friends can pay you in one tap</small>
          <input value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="yourname@okaxis" autoCapitalize="none" />
        </label>
        <div>
          <span className="label">Food preference <small className="muted">— speeds up itemized bills</small></span>
          <div className="chips">
            <button type="button" className={`chip ${!diet ? 'on' : ''}`} onClick={() => setDiet('')}>Not set</button>
            {Object.entries(DIETS).map(([k, v]) => (
              <button type="button" key={k} className={`chip ${diet === k ? 'on' : ''}`} onClick={() => setDiet(k)}>{v}</button>
            ))}
          </div>
        </div>
        {isDemo ? (
          <p className="note warn small">🔒 You’re in the shared demo account, so the profile is read-only to keep the demo working for everyone.</p>
        ) : (
          <label>New password <small className="muted">(leave empty to keep)</small>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} autoComplete="new-password" />
          </label>
        )}
        {msg && <p className={msg.ok ? 'note ok' : 'note err'}>{msg.text}</p>}
        <button className="btn primary" disabled={busy || isDemo}>{busy ? 'Saving…' : 'Save'}</button>
      </form>
      <p className="muted small">Signed in as {user?.email}</p>
      <button className="btn danger-ghost" disabled={busy} onClick={async () => { setBusy(true); await signOut() }}>
        {isDemo ? (busy ? 'Resetting demo…' : 'Sign out & reset demo') : 'Sign out'}
      </button>
      {isDemo && <p className="muted small">Signing out puts the demo trip back to how it started, so the next person gets a fresh demo.</p>}
    </div>
  )
}
