import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase, callRpc } from './lib/supabase.js'
import { resetDemoTour } from './components/Welcome.jsx'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = still loading
  const [profile, setProfile] = useState(null)

  const loadProfile = useCallback(async (uid) => {
    if (!uid) return setProfile(null)
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle()
    setProfile(data)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      loadProfile(data.session?.user?.id)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      loadProfile(s?.user?.id)
    })
    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    refreshProfile: () => loadProfile(session?.user?.id),
    signOut: async () => {
      // the shared demo account cleans up after itself so the next person gets a fresh Goa Trip
      if (session?.user?.email && session.user.email === import.meta.env.VITE_DEMO_EMAIL) {
        await callRpc('reset_demo')
        resetDemoTour() // next person sees the guide from the start
      }
      return supabase.auth.signOut()
    },
    isDemo: !!session?.user?.email && session.user.email === import.meta.env.VITE_DEMO_EMAIL,
  }
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)
