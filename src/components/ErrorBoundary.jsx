import { Component } from 'react'

/** Catches any crash in the UI and shows a friendly recovery screen instead of a blank page. */
export default class ErrorBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { console.error('SplitMate crashed:', error, info) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="center stack" style={{ textAlign: 'center', padding: 24, minHeight: '100vh' }}>
        <div style={{ fontSize: '3rem' }}>😵‍💫</div>
        <h2>Something went wrong</h2>
        <p className="muted">Your data is safe. Reload to continue.</p>
        <button className="btn primary" onClick={() => { this.setState({ error: null }); window.location.reload() }}>Reload SplitMate</button>
        <a className="link small" href={import.meta.env.BASE_URL}>Go to home</a>
      </div>
    )
  }
}
