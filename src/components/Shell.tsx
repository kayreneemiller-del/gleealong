import { NavLink, Outlet } from 'react-router-dom'
import { useSession } from '../lib/session'

export default function Shell() {
  const { signOut } = useSession()
  return (
    <>
      <Outlet />
      <nav className="tabbar">
        <NavLink to="/" end>📺 Episodes</NavLink>
        <NavLink to="/stats">📊 Stats</NavLink>
        <button onClick={() => void signOut()}>👋 Sign out</button>
      </nav>
    </>
  )
}
