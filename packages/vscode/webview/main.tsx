import { createRoot } from 'react-dom/client'
import '@/styles.css'
import './apex.css'
import { App } from './App'
import { installPrimeShim, syncTheme } from './host'

installPrimeShim()
syncTheme()
createRoot(document.getElementById('root')!).render(<App />)
