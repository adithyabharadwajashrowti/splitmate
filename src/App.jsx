import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom'
import { useAuth } from './auth.jsx'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Group from './pages/Group.jsx'
import Profile from './pages/Profile.jsx'
import Join from './pages/Join.jsx'
import Help from './pages/Help.jsx'
import Share from './pages/Share.jsx'
import Avatar from './components/Avatar.jsx'
import Toaster from './components/Toaster.jsx'

function RequireAuth({ children }) {
  const { session } = useAuth()
  const loc = useLocation()
  if (session === undefined) return <div className="center muted">Loading…</div>
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />
  return children
}

function Shell({ children }) {
  const { profile } = useAuth()
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark">S</span> SplitMate
        </Link>
        <div className="row" style={{ gap: 10 }}>
          <Link to="/help" className="help-btn" aria-label="How to use SplitMate" title="How to use SplitMate">?</Link>
          <Link to="/profile" className="topbar-me" aria-label="Your profile">
            <Avatar name={profile?.display_name} size={32} />
          </Link>
        </div>
      </header>
      <main className="container">{children}</main>
      <Toaster />
    </>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/join/:code" element={<RequireAuth><Join /></RequireAuth>} />
      <Route path="/" element={<RequireAuth><Shell><Dashboard /></Shell></RequireAuth>} />
      <Route path="/g/:id" element={<RequireAuth><Shell><Group /></Shell></RequireAuth>} />
      <Route path="/profile" element={<RequireAuth><Shell><Profile /></Shell></RequireAuth>} />
      <Route path="/help" element={<RequireAuth><Shell><Help /></Shell></RequireAuth>} />
      <Route path="/share" element={<RequireAuth><Shell><Share /></Shell></RequireAuth>} />
      <Route path="*" element={<Shell><NotFound /></Shell>} />
    </Routes>
  )
}

function NotFound() {
  return (
    <div className="center stack" style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '3rem' }}>🧭</div>
      <h2>This page wandered off</h2>
      <p className="muted">The link might be old or mistyped.</p>
      <Link to="/" className="btn primary">Take me home</Link>
    </div>
  )
}
