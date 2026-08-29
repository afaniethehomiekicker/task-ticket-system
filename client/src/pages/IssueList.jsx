import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import API from '../services/api';

export default function IssueList() {
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

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8f9fa', fontFamily: 'Open Sans, sans-serif', display: 'flex' }}>
      
      {/* Soft UI Sidebar */}
      <aside style={{ width: '260px', backgroundColor: '#ffffff', borderRight: '1px solid rgba(0,0,0,0.05)', padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#2d3748', letterSpacing: '-0.5px' }}>
          ⚡ DevSolve <span style={{ fontWeight: '300', color: '#a0aec0' }}>Dashboard</span>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <Link to="/dashboard" style={{ textDecoration: 'none', color: '#67748e', padding: '12px 16px', borderRadius: '12px', fontSize: '14px', fontWeight: '600' }}>
            Dashboard
          </Link>
          <Link to="/issues" style={{ textDecoration: 'none', color: '#fff', backgroundColor: '#344767', padding: '12px 16px', borderRadius: '12px', fontSize: '14px', fontWeight: '600', boxShadow: '0 20px 27px 0 rgba(0, 0, 0, 0.05)' }}>
            Issues List
          </Link>
          <Link to="/issues/new" style={{ textDecoration: 'none', color: '#67748e', padding: '12px 16px', borderRadius: '12px', fontSize: '14px', fontWeight: '600' }}>
            Create Issue
          </Link>
        </nav>
      </aside>

      {/* Main Content Area */}
      <main style={{ flex: 1, padding: '32px', boxSizing: 'border-box', overflowY: 'auto' }}>
        
        {/* Header Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
          <div>
            <span style={{ fontSize: '12px', color: '#67748e', fontWeight: '600' }}>Pages / Issues</span>
            <h1 style={{ fontSize: '20px', fontWeight: 'bold', color: '#2d3748', margin: '4px 0 0 0' }}>All Development Issues</h1>
          </div>
          <Link to="/issues/new" style={{ backgroundColor: '#cb0c9f', color: '#fff', padding: '10px 20px', borderRadius: '12px', textDecoration: 'none', fontWeight: '600', fontSize: '13px', boxShadow: '0 4px 7px -1px rgba(203, 12, 159, 0.4)' }}>
            + New Issue
          </Link>
        </div>

        {/* Issues List Card */}
        <div style={{ backgroundColor: '#ffffff', borderRadius: '20px', padding: '24px', boxShadow: '0 20px 27px 0 rgba(0, 0, 0, 0.05)' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 'bold', color: '#2d3748', marginBottom: '16px' }}>Issue Repository</h3>
          
          {loading ? (
            <p style={{ color: '#67748e', fontSize: '14px' }}>Loading issues...</p>
          ) : issues.length === 0 ? (
            <p style={{ color: '#67748e', fontSize: '14px' }}>No issues found.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {issues.map((issue, index) => {
                const issueId = issue.id || issue.ID;
                const issueTitle = issue.title || issue.Title || 'Untitled Issue';
                const issueCategory = issue.category || issue.Category || 'General';

                if (!issueId) return null;

                return (
                  <div key={issueId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', backgroundColor: '#f8f9fa', borderRadius: '14px', border: '1px solid rgba(0,0,0,0.02)' }}>
                    <div>
                      <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#2d3748', display: 'block', marginBottom: '4px' }}>{issueTitle}</span>
                      <span style={{ fontSize: '12px', color: '#67748e', backgroundColor: '#edf2f7', padding: '2px 8px', borderRadius: '6px' }}>Category: {issueCategory}</span>
                    </div>
                    <Link to={`/issues/${issueId}`} style={{ fontSize: '12px', fontWeight: '600', color: '#344767', textDecoration: 'none', backgroundColor: '#fff', padding: '8px 14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                      View Details &rarr;
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