import { useEffect, useState } from 'react'
import QR from 'qrcode'

/** Renders a QR code for any text (used for the live-bill join link). */
export default function QRCode({ text, size = 220 }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let alive = true
    QR.toDataURL(text, { width: size * 2, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b0d12', light: '#ffffff' } })
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(null))
    return () => { alive = false }
  }, [text, size])
  if (!src) return <div className="qr-box" style={{ width: size, height: size }} />
  return <img className="qr-box" src={src} width={size} height={size} alt="Scan to open this bill on your phone" />
}
