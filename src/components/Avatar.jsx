const COLORS = ['#0f766e', '#7c3aed', '#db2777', '#ea580c', '#2563eb', '#16a34a', '#ca8a04', '#dc2626']

export default function Avatar({ name = '?', size = 36 }) {
  const n = (name || '?').trim()
  const initials = n.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?'
  let h = 0
  for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4, background: COLORS[h % COLORS.length] }} title={n}>
      {initials}
    </span>
  )
}
