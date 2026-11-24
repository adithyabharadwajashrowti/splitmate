/** 🎙️ Browser speech-to-text (Chrome, Edge, Android Chrome, Safari). No API key needed. */
export const voiceSupported = () =>
  typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)

/**
 * Start listening. Calls onText(transcript, isFinal) as the person speaks.
 * Returns a stop() function.
 */
export function listen({ onText, onEnd, onError, lang = 'en-IN' }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  const rec = new SR()
  rec.lang = lang
  rec.interimResults = true
  rec.continuous = false
  rec.maxAlternatives = 1
  rec.onresult = (e) => {
    const res = e.results[e.results.length - 1]
    // spoken numbers: "twelve hundred" usually arrives as "1200" in Chrome; also map "rupees"
    const text = res[0].transcript.replace(/\brupees?\b/gi, '').replace(/\s+/g, ' ').trim()
    onText?.(text, res.isFinal)
  }
  rec.onerror = (e) => onError?.(e.error === 'not-allowed' ? 'Microphone permission was blocked' : 'Could not hear that, try again')
  rec.onend = () => onEnd?.()
  rec.start()
  return () => rec.stop()
}
