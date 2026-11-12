import { createRoot } from 'react-dom/client'
import '@/styles.css'
import './apex.css'
import { App } from './App'
import { installApexShim, syncTheme } from './host'

installApexShim()
syncTheme()
createRoot(document.getElementById('root')!).render(<App />)
