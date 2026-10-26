import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/space-grotesk/500.css'
import '@fontsource/space-grotesk/700.css'
import './index.css'
import App from './App.tsx'
import { EvidenceProvider } from './context/EvidenceContext.tsx'
import { LlmConfigProvider } from './context/LlmConfigContext.tsx'
import { TourProvider } from './context/TourContext.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LlmConfigProvider>
      <EvidenceProvider>
        <TourProvider>
          <App />
        </TourProvider>
      </EvidenceProvider>
    </LlmConfigProvider>
  </StrictMode>,
)
