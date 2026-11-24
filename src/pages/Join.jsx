import { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { supabase, niceError, callRpc } from '../lib/supabase.js'

export default function Join() {
  const { code } = useParams()
  const nav = useNavigate()
  const [err, setErr] = useState(null)

  useEffect(() => {
    let done = false
    callRpc('join_group', { code }).then(({ data, error }) => {
      if (done) return
      if (error) setErr(niceError(error))
      else nav(`/g/${data}`, { replace: true })
    })
    return () => { done = true }
  }, [code, nav])

  return (
    <div className="center stack">
      {err ? <><p className="note err">{err}</p><Link to="/" className="btn">Go home</Link></> : <p className="muted">Joining group…</p>}
    </div>
  )
}
