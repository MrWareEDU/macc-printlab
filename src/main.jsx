import React from 'react'
import ReactDOM from 'react-dom/client'
import PrintPortal from './PrintPortal.jsx'

// ── Storage shim ──────────────────────────────────────────────────────────────
// The app was built for Claude's artifact sandbox which exposes window.storage.
// Outside that environment we provide a localStorage-backed drop-in replacement.
if (!window.storage) {
  window.storage = {
    get: async (key) => {
      const val = localStorage.getItem(key)
      if (val === null) return null
      return { key, value: val }
    },
    set: async (key, value) => {
      localStorage.setItem(key, value)
      return { key, value }
    },
    delete: async (key) => {
      localStorage.removeItem(key)
      return { key, deleted: true }
    },
    list: async (prefix) => {
      const keys = Object.keys(localStorage).filter(k => !prefix || k.startsWith(prefix))
      return { keys }
    }
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PrintPortal />
  </React.StrictMode>
)
