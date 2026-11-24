import { useEffect, useState } from 'react'

/** Shows toasts fired with toast() from lib/fun.js. */
export default function Toaster() {
  const [items, setItems] = useState([])
  useEffect(() => {
    const on = (e) => {
      const t = e.detail
      setItems((x) => [...x.slice(-2), t])
      setTimeout(() => setItems((x) => x.filter((y) => y.id !== t.id)), 3200)
    }
    window.addEventListener('splitmate:toast', on)
    return () => window.removeEventListener('splitmate:toast', on)
  }, [])
  return (
    <div className="toaster" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="toast"><span>{t.emoji}</span>{t.message}</div>
      ))}
    </div>
  )
}
