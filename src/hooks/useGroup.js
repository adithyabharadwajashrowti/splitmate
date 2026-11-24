import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, niceError, isUuid } from '../lib/supabase.js'
import { computeBalances, simplifyDebts } from '../lib/balances.js'

/** Loads everything for one group and keeps it live via Supabase Realtime. */
export function useGroup(groupId) {
  const [state, setState] = useState({ loading: true, error: null, group: null, members: [], expenses: [], settlements: [] })
  const timer = useRef(null)

  const load = useCallback(async () => {
    if (!isUuid(groupId)) return setState((x) => ({ ...x, loading: false, error: 'Group not found — check the link' }))
    const [g, m, e, s] = await Promise.all([
      supabase.from('groups').select('*').eq('id', groupId).maybeSingle(),
      supabase.from('group_members').select('user_id, role, joined_at, profiles(id, display_name, upi_id, diet)').eq('group_id', groupId),
      supabase.from('expenses').select('*, expense_splits(user_id, share_paise)').eq('group_id', groupId)
        .order('expense_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('settlements').select('*').eq('group_id', groupId).order('created_at', { ascending: false }),
    ])
    const err = g.error || m.error || e.error || s.error
    if (err) return setState((x) => ({ ...x, loading: false, error: niceError(err) }))
    if (!g.data) return setState((x) => ({ ...x, loading: false, error: 'Group not found, or you are not a member' }))
    setState({
      loading: false,
      error: null,
      group: g.data,
      members: m.data.map((r) => ({ id: r.user_id, role: r.role, name: r.profiles?.display_name || 'Member', upi_id: r.profiles?.upi_id, diet: r.profiles?.diet }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      expenses: e.data,
      settlements: s.data,
    })
  }, [groupId])

  useEffect(() => {
    load()
    if (!isUuid(groupId)) return
    // debounce bursts of realtime events (e.g. an expense + its splits)
    const reload = () => { clearTimeout(timer.current); timer.current = setTimeout(load, 250) }
    const ch = supabase.channel(`group-${groupId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `group_id=eq.${groupId}` }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements', filter: `group_id=eq.${groupId}` }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members', filter: `group_id=eq.${groupId}` }, reload)
      .subscribe()
    // fallback if realtime is down: refresh when the tab regains focus and every 15s while visible
    const onFocus = () => document.visibilityState === 'visible' && reload()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    const poll = setInterval(() => document.visibilityState === 'visible' && load(), 15000)
    return () => {
      clearTimeout(timer.current); clearInterval(poll)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
      supabase.removeChannel(ch)
    }
  }, [groupId, load])

  const derived = useMemo(() => {
    const balances = computeBalances(state.expenses, state.settlements, state.members.map((m) => m.id))
    return { balances, payments: simplifyDebts(balances), byId: Object.fromEntries(state.members.map((m) => [m.id, m])) }
  }, [state.expenses, state.settlements, state.members])

  return { ...state, ...derived, reload: load }
}
