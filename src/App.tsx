import { Navigate, Route, Routes } from 'react-router-dom'
import { isConfigured } from './lib/supabase'
import { useSession } from './lib/session'
import AuthPage from './pages/AuthPage'
import PairPage from './pages/PairPage'
import HomePage from './pages/HomePage'
import EpisodePage from './pages/EpisodePage'
import Shell from './components/Shell'

function Splash({ children }: { children: React.ReactNode }) {
  return <main className="splash"><div className="logo">G</div><p>{children}</p></main>
}

export default function App() {
  const { session, me, loading } = useSession()

  if (!isConfigured) {
    return (
      <Splash>
        Supabase isn't wired up yet. Copy <code>.env.example</code> to <code>.env.local</code> and fill in
        your project URL and anon key. The show must go on!
      </Splash>
    )
  }
  if (loading) return <Splash>Warming up the vocal cords…</Splash>
  if (!session) return <AuthPage />
  if (!me) return <PairPage />

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<HomePage />} />
        <Route path="ep/:id" element={<EpisodePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
