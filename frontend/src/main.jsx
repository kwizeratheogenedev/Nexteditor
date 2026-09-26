import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import AppErrorBoundary from './components/AppErrorBoundary.jsx'
import RequireAuth from './components/RequireAuth.jsx'
import { SocketProvider } from './context/SocketContext.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'
import LandingPage from './pages/LandingPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import SignupPage from './pages/SignupPage.jsx'
import AuthCallbackPage from './pages/AuthCallbackPage.jsx'
import PricingPage from './pages/PricingPage.jsx'
import AccountPage from './pages/AccountPage.jsx'
import AdminPage from './pages/AdminPage.jsx'
import AnalyticsTracker from './analytics/AnalyticsTracker.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <ThemeProvider>
        <BrowserRouter>
          <AuthProvider>
            <SocketProvider>
              <AnalyticsTracker />
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/signup" element={<SignupPage />} />
                <Route path="/auth/callback" element={<AuthCallbackPage />} />
                <Route path="/pricing" element={<PricingPage />} />
                <Route path="/app/*" element={<RequireAuth><App /></RequireAuth>} />
                <Route path="/account" element={<RequireAuth><AccountPage /></RequireAuth>} />
                <Route path="/admin" element={<RequireAuth><AdminPage /></RequireAuth>} />
              </Routes>
            </SocketProvider>
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </AppErrorBoundary>
  </StrictMode>,
)
