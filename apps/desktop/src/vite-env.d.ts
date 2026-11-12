/// <reference types="vite/client" />
import type { ApexApi } from './types/api'
declare global { interface Window { apex: ApexApi } }
