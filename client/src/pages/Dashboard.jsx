import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../services/api';

export default function Dashboard() {
  const [issues, setIssues] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch both issues and activities concurrently
        const [issuesRes, activitiesRes] = await Promise.all([
  API.get('/api/issues'),
  API.get('/api/activities') 
]);
        const issuesData = Array.isArray(issuesRes.data) ? issuesRes.data : (issuesRes.data?.issues || []);
        const activitiesData = Array.isArray(activitiesRes.data) ? activitiesRes.data : (activitiesRes.data?.activities || []);
        
        setIssues(issuesData);
        setActivities(activitiesData);
      } catch (err) {
        console.error('Failed to fetch dashboard data', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/login');
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#030712', color: '#f3f4f6', padding: '32px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px', borderBottom: '1px solid #1f2937', paddingBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#ffffff', margin: 0 }}>Developer Dashboard</h1>
          <p style={{ fontSize: '14px', color: '#9ca3af', marginTop: '4px' }}>Welcome back! Manage your issues and track solutions.</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={() => navigate('/issues/new')}
            style={{ backgroundColor: '#2563eb', color: '#ffffff', border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: '500' }}
          >
            + New Issue
          </button>
          <button
            onClick={handleLogout}
            style={{ backgroundColor: 'rgba(239, 68, 68, 0.2)', color: '#f87171', border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: '500' }}
          >
            Logout
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px', marginBottom: '32px' }}>
        <div style={{ backgroundColor: '#111827', border: '1px solid #1f2937', borderRadius: '12px', padding: '24px' }}>
          <h3 style={{ fontSize: '14px', color: '#9ca3af', margin: '0 0 8px 0' }}>Total Issues</h3>
          <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#ffffff', margin: 0 }}>{issues.length}</p>
        </div>
        <div style={{ backgroundColor: '#111827', border: '1px solid #1f2937', borderRadius: '12px', padding: '24px' }}>
          <h3 style={{ fontSize: '14px', color: '#9ca3af', margin: '0 0 8px 0' }}>Solutions Logged</h3>
          <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#34d399', margin: 0 }}>Synced</p>
        </div>
        <div style={{ backgroundColor: '#111827', border: '1px solid #1f2937', borderRadius: '12px', padding: '24px' }}>
          <h3 style={{ fontSize: '14px', color: '#9ca3af', margin: '0 0 8px 0' }}>System Status</h3>
          <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#60a5fa', margin: 0 }}>Online 🚀</p>
        </div>
      </div>

      {/* Issues Section - Clickable! */}
      <div style={{ backgroundColor: '#111827', border: '1px solid #1f2937', borderRadius: '12px', padding: '24px', marginBottom: '32px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', color: '#ffffff', marginTop: 0, marginBottom: '16px' }}>Project Issues</h2>
        {loading ? (
          <p style={{ color: '#9ca3af', fontSize: '14px', margin: 0 }}>Loading issues...</p>
        ) : issues.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: '14px', margin: 0 }}>No issues found. Create your first issue!</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {issues.map((issue) => (
              <div
                key={issue.ID || issue.id}
                onClick={() => navigate(`/issues/${issue.ID || issue.id}`)}
                style={{
                  padding: '16px',
                  backgroundColor: '#1f2937',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s',
                  border: '1px solid #374151'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#374151'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#1f2937'}
              >
                <h3 style={{ margin: '0 0 6px 0', fontSize: '16px', color: '#ffffff' }}>{issue.Title || issue.title}</h3>
                <p style={{ margin: 0, fontSize: '14px', color: '#9ca3af' }}>{issue.Description || issue.description}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Activities Section */}
      <div style={{ backgroundColor: '#111827', border: '1px solid #1f2937', borderRadius: '12px', padding: '24px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', color: '#ffffff', marginTop: 0, marginBottom: '16px' }}>Recent System Activity</h2>
        {activities.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: '14px', margin: 0 }}>No recent activities found.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {activities.map((act, index) => (
              <li key={index} style={{ padding: '12px 0', borderBottom: '1px solid #1f2937', color: '#d1d5db', fontSize: '14px' }}>
                {typeof act === 'string' ? act : (act.description || act.title || JSON.stringify(act))}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}