import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // Service workers need a secure context (HTTPS or localhost); elsewhere this is a no-op.
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
