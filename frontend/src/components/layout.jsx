import { Outlet, Link, useNavigate } from 'react-router-dom';

export default function Layout() {
    const navigate = useNavigate();

    const handleLogout = () => {
        localStorage.clear();
        navigate('/login');
    };

    return (
        <div style={{ display: 'flex', minHeight: '100vh', background: '#F4F7FE' }}>
            {/* Sidebar */}
            <aside style={{ width: '260px', background: '#fff', padding: '24px', borderRight: '1px solid #E0E5F2', display: 'flex', flexDirection: 'column' }}>
                <h2 style={{ color: '#0052FF', fontSize: '20px', marginBottom: '40px' }}>TicketFlow</h2>
                <nav style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    <Link to="/dashboard" style={{ textDecoration: 'none', color: '#2B3674', fontWeight: 'bold' }}>Dashboard</Link>
                    <Link to="/projects" style={{ textDecoration: 'none', color: '#2B3674', fontWeight: 'bold' }}>Projects</Link>
                    <Link to="/kanban" style={{ textDecoration: 'none', color: '#2B3674', fontWeight: 'bold' }}>Kanban Board</Link>
                </nav>
                <button onClick={handleLogout} style={{ marginTop: 'auto', padding: '10px', background: '#ffebee', color: '#c62828', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
                    Logout
                </button>
            </aside>

            {/* Main Content Area */}
            <main style={{ flex: 1, padding: '40px', overflowY: 'auto' }}>
                <Outlet />
            </main>
        </div>
    );
}