import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../services/api';

export default function IssueList() {
  const [issues, setIssues] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    API.get('/api/issues')
      .then(res => setIssues(res.data.issues || res.data))
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  const filteredIssues = issues.filter(issue => 
    issue.title?.toLowerCase().includes(search.toLowerCase()) ||
    issue.category?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#030712', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' }}>
        <p style={{ color: '#9ca3af', fontSize: '14px' }}>Loading issues feed...</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#030712', color: '#f3f4f6', padding: '32px', display: 'flex', justifyContent: 'center', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: '800px', width: '100%', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1f2937', paddingBottom: '16px' }}>
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#ffffff', margin: '0 0 4px 0', letterSpacing: '-0.025em' }}>Technical Issues Feed</h1>
            <p style={{ fontSize: '14px', color: '#9ca3af', margin: 0 }}>Browse and search reported bugs, errors, and solutions.</p>
          </div>
          <button 
            onClick={() => navigate('/dashboard')}
            style={{ backgroundColor: '#1f2937', color: '#ffffff', border: 'none', padding: '8px 16px', borderRadius: '8px', fontSize: '14px', fontWeight: '500', cursor: 'pointer', transition: 'background 0.2s' }}
            onMouseOver={(e) => e.target.style.backgroundColor = '#374151'}
            onMouseOut={(e) => e.target.style.backgroundColor = '#1f2937'}
          >
            Dashboard
          </button>
        </div>

        {/* Search Bar */}
        <div>
          <input 
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search issues by title, category, or technology..."
            style={{ width: '100%', padding: '12px 16px', backgroundColor: '#111827', border: '1px solid #1f2937', borderRadius: '12px', color: '#ffffff', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>

        {/* Issues List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {filteredIssues.length === 0 ? (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: '40px 0' }}>No issues found.</p>
          ) : (
            filteredIssues.map((issue, index) => (
              <div 
                key={issue.ID || issue.id || issue._id || index}
                style={{ backgroundColor: '#111827', border: '1px solid #1f2937', borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2)' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <span style={{ fontSize: '11px', fontWeight: '600', color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>
                      📂 {issue.category || 'General'} &nbsp;|&nbsp; ⚡ {issue.priority || 'Normal'}
                    </span>
                    <h2 style={{ fontSize: '18px', fontWeight: '600', color: '#ffffff', margin: 0 }}>{issue.title}</h2>
                  </div>
                  <button 
                    onClick={() => navigate(`/issues/${issue.ID || issue.id || issue._id}`)}
                    style={{ backgroundColor: '#3b82f6', color: '#ffffff', border: 'none', padding: '6px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: '500', cursor: 'pointer', transition: 'background 0.2s' }}
                    onMouseOver={(e) => e.target.style.backgroundColor = '#2563eb'}
                    onMouseOut={(e) => e.target.style.backgroundColor = '#3b82f6'}
                  >
                    Open
                  </button>
                </div>
                <p style={{ fontSize: '14px', color: '#9ca3af', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                  {issue.description}
                </p>
              </div>
            ))
          )}
        </div>

      </div>
    </div>
  );
}