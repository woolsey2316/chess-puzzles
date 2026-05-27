import './App.css'
import { AuthProvider, useAuth } from './auth'
import PuzzlePage from './PuzzlePage'
import AuthPage from './AuthPage'

function AppContent() {
  const { user } = useAuth()
  return user ? <PuzzlePage /> : <AuthPage />
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}

export default App
