import { NavLink, Outlet } from "react-router-dom";

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">▚</span>
          <span className="brand-name">MAINFRAME</span>
          <span className="brand-module">/ food</span>
        </div>
        <nav className="topnav">
          <NavLink to="/" end className="navlink">
            Dashboard
          </NavLink>
          <NavLink to="/log" className="navlink">
            Quick log
          </NavLink>
        </nav>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
