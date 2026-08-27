import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import API from '../services/api';

export default function Dashboard() {
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    API.get('/api/issues')
      .then(res => {
        const data = res.data.issues || res.data.data || res.data;
        setIssues(Array.isArray(data) ? data : []);
      })
      .catch(err => console.error('Failed to fetch issues', err))
      .finally(() => setLoading(false));
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('token');
    window.location.href = '/login';
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8f9fa', fontFamily: 'Open Sans, sans-serif', display: 'flex' }}>
      
      {/* Soft UI Sidebar */}
      <aside style={{ width: '260px', backgroundColor: '#ffffff', borderRight: '1px solid rgba(0,0,0,0.05)', padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px', boxSizing: 'border-box' }}>
        <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#2d3748', letterSpacing: '-0.5px' }}>
          ⚡ DevSolve <span style={{ fontWeight: '300', color: '#a0aec0' }}>Dashboard</span>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
          <Link to="/dashboard" style={{ textDecoration: 'none', color: '#fff', backgroundColor: '#344767', padding: '12px 16px', borderRadius: '12px', fontSize: '14px', fontWeight: '600', boxShadow: '0 20px 27px 0 rgba(0, 0, 0, 0.05)' }}>
            Dashboard
          </Link>
          <Link to="/issues" style={{ textDecoration: 'none', color: '#67748e', padding: '12px 16px', borderRadius: '12px', fontSize: '14px', fontWeight: '600' }}>
            Issues List
          </Link>
          <Link to="/issues/new" style={{ textDecoration: 'none', color: '#67748e', padding: '12px 16px', borderRadius: '12px', fontSize: '14px', fontWeight: '600' }}>
            Create Issue
          </Link>
        </nav>

        {/* Bottom Logout Button */}
        <div style={{ paddingTop: '20px', borderTop: '1px solid rgba(0,0,0,0.05)' }}>
          <button 
            onClick={handleLogout}
            style={{ 
              width: '100%', 
              backgroundColor: 'rgba(239, 68, 68, 0.1)', 
              color: '#ef4444', 
              border: 'none', 
              padding: '12px 16px', 
              borderRadius: '12px', 
              fontWeight: '600', 
              fontSize: '14px', 
              cursor: 'pointer',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            🚪 Logout
          </button>
        </div>
      </aside>

      {/* Main Content Dashboard Area */}
      <main style={{ flex: 1, padding: '32px', boxSizing: 'border-box', overflowY: 'auto' }}>
        
        {/* Top Header Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
          <div>
            <span style={{ fontSize: '12px', color: '#67748e', fontWeight: '600' }}>Pages / Dashboard</span>
            <h1 style={{ fontSize: '20px', fontWeight: 'bold', color: '#2d3748', margin: '4px 0 0 0' }}>Active System Overview</h1>
          </div>
          <Link to="/issues/new" style={{ backgroundColor: '#cb0c9f', color: '#fff', padding: '10px 20px', borderRadius: '12px', textDecoration: 'none', fontWeight: '600', fontSize: '13px', boxShadow: '0 4px 7px -1px rgba(203, 12, 159, 0.4)' }}>
            + New Issue
          </Link>
        </div>

        {/* Soft UI Metric Cards Row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '24px', marginBottom: '32px' }}>
          <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '20px', boxShadow: '0 20px 27px 0 rgba(0, 0, 0, 0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontSize: '11px', fontWeight: '700', color: '#67748e', textTransform: 'uppercase' }}>Total Issues</span>
              <h4 style={{ fontSize: '24px', fontWeight: 'bold', color: '#2d3748', margin: '4px 0 0 0' }}>{issues.length}</h4>
            </div>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'linear-gradient(135deg, #7928ca 0%, #ff0080 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 'bold' }}>
              📊
            </div>
          </div>

          <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '20px', boxShadow: '0 20px 27px 0 rgba(0, 0, 0, 0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontSize: '11px', fontWeight: '700', color: '#67748e', textTransform: 'uppercase' }}>System Status</span>
              <h4 style={{ fontSize: '20px', fontWeight: 'bold', color: '#822ee3', margin: '4px 0 0 0' }}>Connected</h4>
            </div>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'linear-gradient(135deg, #17ad37 0%, #98ec2d 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 'bold' }}>
              🚀
            </div>
          </div>
        </div>

        {/* Projects / Issues Data Table Card */}
        <div style={{ backgroundColor: '#ffffff', borderRadius: '20px', padding: '24px', boxShadow: '0 20px 27px 0 rgba(0, 0, 0, 0.05)' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 'bold', color: '#2d3748', marginBottom: '16px' }}>Recent Development Issues</h3>
          
          {loading ? (
            <p style={{ color: '#67748e', fontSize: '14px' }}>Loading dashboard data...</p>
          ) : issues.length === 0 ? (
            <p style={{ color: '#67748e', fontSize: '14px' }}>No issues found in database.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {issues.slice(0, 5).map((issue) => {
                const issueId = issue.id || issue.ID;
                const issueTitle = issue.title || issue.Title || 'Untitled Issue';
                const issueCategory = issue.category || issue.Category || 'General';

                if (!issueId) return null;

                return (
                  <div key={issueId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', backgroundColor: '#f8f9fa', borderRadius: '12px', border: '1px solid rgba(0,0,0,0.02)' }}>
                    <div>
                      <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#2d3748', display: 'block' }}>{issueTitle}</span>
                      <span style={{ fontSize: '11px', color: '#67748e' }}>Category: {issueCategory}</span>
                    </div>
                    <Link to={`/issues/${issueId}`} style={{ fontSize: '12px', fontWeight: '600', color: '#344767', textDecoration: 'none', backgroundColor: '#fff', padding: '6px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      View &rarr;
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </main>
    </div>
  );
}