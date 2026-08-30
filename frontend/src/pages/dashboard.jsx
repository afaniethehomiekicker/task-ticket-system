import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function Dashboard() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const handleLogout = () => {
    localStorage.clear();
    navigate('/');
  };

  return (
    <div style={{ padding: '40px', fontFamily: 'sans-serif', background: '#f9fafb', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <div>
          <h1>Dashboard</h1>
          <p style={{ color: '#4b5563' }}>Welcome back, <strong>{user.name || 'User'}</strong>!</p>
        </div>
        <button onClick={handleLogout} style={{ padding: '8px 16px', background: '#dc2626', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
          Logout
        </button>
      </div>

      <div style={{ background: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '20px' }}>
        <h3>Role & Permissions Profile</h3>
        <p>Current Role: <span style={{ background: '#e0e7ff', color: '#3730a3', padding: '2px 8px', borderRadius: '4px', fontWeight: 'bold' }}>{user.role || 'N/A'}</span></p>
      </div>

      {/* Conditional Role-Based Content Sections */}
      {user.role === 'Super Admin' && (
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', padding: '20px', borderRadius: '8px' }}>
          <h4>Super Admin Control Panel</h4>
          <p>Full system metrics, user management, and global audit logs are accessible here.</p>
        </div>
      )}

      {user.role === 'Admin' && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '20px', borderRadius: '8px' }}>
          <h4>Department Admin Panel</h4>
          <p>Manage your department projects, team supervisors, and staff assignments.</p>
        </div>
      )}

      {user.role === 'Supervisor' && (
        <div style={{ background: '#fefce8', border: '1px solid #fef08a', padding: '20px', borderRadius: '8px' }}>
          <h4>Supervisor Oversight Panel</h4>
          <p>Track team workloads, review staff submissions, and monitor active ticket queues.</p>
        </div>
      )}

      {user.role === 'Staff' && (
        <div style={{ background: '#faf5ff', border: '1px solid #e9d5ff', padding: '20px', borderRadius: '8px' }}>
          <h4>Staff Workspace</h4>
          <p>View your assigned tasks, update work statuses, and submit items for review.</p>
        </div>
      )}
    </div>
  );
}