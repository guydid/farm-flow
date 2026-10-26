import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { applyBrandIcons } from '@/lib/branding'
import { applyA11y } from '@/lib/a11y'

// לוגו החברה השמור (אם הועלה) כאייקון הטאב ומסך הבית — עוד לפני ההתחברות
try { applyBrandIcons() } catch { /* ignore */ }
// העדפות נגישות שנשמרו (גודל טקסט, ניגודיות...) — לפני הרנדר הראשון
try { applyA11y() } catch { /* ignore */ }

ReactDOM.createRoot(document.getElementById('root')).render(
  // <React.StrictMode>
  <App />
  // </React.StrictMode>,
)

// Register Service Worker for PWA (offline support + installability)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => console.log('[SW] Registered:', reg.scope))
      .catch((err) => console.warn('[SW] Registration failed:', err));
  });
}

if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', () => {
    window.parent?.postMessage({ type: 'sandbox:beforeUpdate' }, '*');
  });
  import.meta.hot.on('vite:afterUpdate', () => {
    window.parent?.postMessage({ type: 'sandbox:afterUpdate' }, '*');
  });
}



