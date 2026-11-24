import { useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { supabase, niceError, appUrl } from '../lib/supabase.js'
import { useAuth } from '../auth.jsx'

export default function Login() {
  const { session } = useAuth()
  const [params] = useSearchParams()
  const next = params.get('next') || '/'
  const [mode, setMode] = useState('signin') // signin | signup | reset
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const demoEmail = import.meta.env.VITE_DEMO_EMAIL
  const demoPassword = import.meta.env.VITE_DEMO_PASSWORD

  async function tryDemo() {
    setBusy(true)
    setMsg(null)
    const { error } = await supabase.auth.signInWithPassword({ email: demoEmail, password: demoPassword })
    setBusy(false)
    if (error) setMsg({ ok: false, text: niceError(error) })
  }

  if (session) return <Navigate to={next.startsWith('/') ? next : '/'} replace />

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { display_name: name.trim() },
            emailRedirectTo: appUrl(next),
          },
        })
        if (error) throw error
        if (!data.session) setMsg({ ok: true, text: 'Check your email to confirm your account, then sign in.' })
      } else if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: appUrl('/profile'),
        })
        if (error) throw error
        setMsg({ ok: true, text: 'Password reset link sent — check your email.' })
      }
    } catch (err) {
      setMsg({ ok: false, text: niceError(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <aside className="auth-hero-side">
        <div className="brand"><span className="brand-mark">S</span> SplitMate</div>
        <div>
          <h1>Split the bill <em>by what you ate.</em></h1>
          <p className="sub">Snap the bill, tap who had what. The veg friend never pays for the chicken, GST is shared fairly, and everyone settles on UPI in one tap.</p>
        </div>
        <div className="feature-list">
          <div className="feature"><span>🧾</span><span>Itemized splits: veg, non-veg, drinks</span></div>
          <div className="feature"><span>✨</span><span>Type “1200 dinner paid by Rahul” and it fills itself</span></div>
          <div className="feature"><span>🔀</span><span>Fewest payments with debt simplification</span></div>
          <div className="feature"><span>⚡</span><span>One-tap UPI settle-up</span></div>
        </div>
        <div className="receipt-float" aria-hidden="true">
          <div style={{ textAlign: 'center', fontWeight: 700 }}>FISHERMAN'S WHARF</div>
          <hr />
          <div className="r-row"><span>Paneer masala<span className="r-tag">Asha</span></span><span>380</span></div>
          <div className="r-row"><span>Chicken biryani<span className="r-tag">Rahul</span></span><span>640</span></div>
          <div className="r-row"><span>Beer ×3<span className="r-tag">Dev</span></span><span>540</span></div>
          <div className="r-row"><span>GST 5%</span><span>105</span></div>
          <hr />
          <div className="r-row"><b>Asha pays</b><b>₹391</b></div>
          <div className="r-row"><b>Rahul pays</b><b>₹920</b></div>
        </div>
      </aside>

      <div className="auth-form-side">
      <div className="auth-card">
        <div>
          <h2>{mode === 'signup' ? 'Create your account' : mode === 'signin' ? 'Welcome back' : 'Reset password'}</h2>
          <p className="muted">{mode === 'signup' ? 'Takes 20 seconds. No card needed.' : 'Sign in to see who owes what.'}</p>
        </div>
        {demoEmail && mode === 'signin' && (
          <>
            <button type="button" className="btn primary demo-btn" onClick={tryDemo} disabled={busy}>
              ⚡ Try the live demo, no signup
            </button>
            <div className="or"><span>or sign in</span></div>
          </>
        )}

        <form onSubmit={submit} className="stack">
          {mode === 'signup' && (
            <label>Your name
              <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} placeholder="Adithya" autoComplete="name" />
            </label>
          )}
          <label>Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="you@example.com" />
          </label>
          {mode !== 'reset' && (
            <label>Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} placeholder="At least 8 characters" />
            </label>
          )}
          {msg && <p className={msg.ok ? 'note ok' : 'note err'}>{msg.text}</p>}
          <button className={`btn ${demoEmail && mode === 'signin' ? '' : 'primary'}`} disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : mode === 'signin' ? 'Sign in' : 'Send reset link'}
          </button>
        </form>

        <div className="auth-switch">
          {mode === 'signin' && (
            <>
              <button className="link" onClick={() => { setMode('signup'); setMsg(null) }}>New here? Create an account</button>
              <button className="link" onClick={() => { setMode('reset'); setMsg(null) }}>Forgot password?</button>
            </>
          )}
          {mode !== 'signin' && <button className="link" onClick={() => { setMode('signin'); setMsg(null) }}>Already have an account? Sign in</button>}
        </div>
      </div>
      </div>
    </div>
  )
}
