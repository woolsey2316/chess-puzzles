import './App.css'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import AuthPage from './pages/AuthPage'
import PuzzlePage from './pages/PuzzlePage'
import AnalysisPage from './pages/AnalysisPage'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  return user ? <>{children}</> : <Navigate to="/login" replace />
}

function GuestRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  return user ? <Navigate to="/puzzle" replace /> : <>{children}</>
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<GuestRoute><AuthPage /></GuestRoute>} />
          <Route path="/puzzle" element={<ProtectedRoute><PuzzlePage /></ProtectedRoute>} />
          <Route path="/analysis" element={<ProtectedRoute><AnalysisPage /></ProtectedRoute>} />
          <Route path="*" element={<NavigateByAuth />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

function NavigateByAuth() {
  const { user } = useAuth()
  return <Navigate to={user ? '/puzzle' : '/login'} replace />
}

export default App
