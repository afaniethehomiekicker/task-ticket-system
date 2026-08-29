import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import API from '../services/api';

export default function CreateIssue() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Backend');
  const [technology, setTechnology] = useState('Go');
  const [priority, setPriority] = useState('Normal');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await API.post('/api/issues', {
        title,
        description,
        category,
        technology,
        priority
      });
      navigate('/dashboard');
    } catch (err) {
      setError('Failed to create issue. Please check your inputs.');
    }
  };

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
          <Link to="/issues" style={{ textDecoration: 'none', color: '#67748e', padding: '12px 16px', borderRadius: '12px', fontSize: '14px', fontWeight: '600' }}>
            Issues List
          </Link>
          <Link to="/issues/new" style={{ textDecoration: 'none', color: '#fff', backgroundColor: '#344767', padding: '12px 16px', borderRadius: '12px', fontSize: '14px', fontWeight: '600', boxShadow: '0 20px 27px 0 rgba(0, 0, 0, 0.05)' }}>
            Create Issue
          </Link>
        </nav>
      </aside>

      {/* Main Content Area */}
      <main style={{ flex: 1, padding: '32px', boxSizing: 'border-box', overflowY: 'auto' }}>
        
        {/* Header Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
          <div>
            <span style={{ fontSize: '12px', color: '#67748e', fontWeight: '600' }}>Pages / New Issue</span>
            <h1 style={{ fontSize: '20px', fontWeight: 'bold', color: '#2d3748', margin: '4px 0 0 0' }}>Report a Development Issue</h1>
          </div>
          <Link to="/dashboard" style={{ backgroundColor: '#e2e8f0', color: '#4a5568', padding: '10px 20px', borderRadius: '12px', textDecoration: 'none', fontWeight: '600', fontSize: '13px' }}>
            &larr; Back
          </Link>
        </div>

        {/* Form Card Container */}
        <div style={{ backgroundColor: '#ffffff', borderRadius: '20px', padding: '32px', boxShadow: '0 20px 27px 0 rgba(0, 0, 0, 0.05)', maxWidth: '700px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 'bold', color: '#2d3748', marginBottom: '20px' }}>Issue Details</h3>

          {error && <div style={{ color: '#e53e3e', fontSize: '13px', marginBottom: '16px', backgroundColor: '#fff5f5', padding: '10px', borderRadius: '8px' }}>{error}</div>}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            <div>
              <label style={{ fontSize: '12px', fontWeight: '700', color: '#67748e', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>Issue Title</label>
              <input 
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                placeholder="e.g., GORM Auto-Migration Fails"
                style={{ width: '100%', padding: '12px 16px', border: '1px solid #e2e8f0', borderRadius: '12px', fontSize: '14px', outline: 'none', boxSizing: 'border-box', backgroundColor: '#f8f9fa', color: '#2d3748' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '700', color: '#67748e', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>Category</label>
                <select 
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  style={{ width: '100%', padding: '12px', border: '1px solid #e2e8f0', borderRadius: '12px', fontSize: '14px', outline: 'none', backgroundColor: '#f8f9fa', color: '#2d3748' }}
                >
                  <option value="Backend">Backend</option>
                  <option value="Frontend">Frontend</option>
                  <option value="Database">Database</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: '700', color: '#67748e', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>Technology</label>
                <input 
                  type="text"
                  value={technology}
                  onChange={(e) => setTechnology(e.target.value)}
                  style={{ width: '100%', padding: '12px 16px', border: '1px solid #e2e8f0', borderRadius: '12px', fontSize: '14px', outline: 'none', boxSizing: 'border-box', backgroundColor: '#f8f9fa', color: '#2d3748' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: '700', color: '#67748e', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>Priority</label>
                <select 
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  style={{ width: '100%', padding: '12px', border: '1px solid #e2e8f0', borderRadius: '12px', fontSize: '14px', outline: 'none', backgroundColor: '#f8f9fa', color: '#2d3748' }}
                >
                  <option value="Normal">Normal</option>
                  <option value="High">High</option>
                  <option value="Critical">Critical</option>
                </select>
              </div>
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: '700', color: '#67748e', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>Description & Steps</label>
              <textarea 
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                rows="5"
                placeholder="Describe the error or bug in detail..."
                style={{ width: '100%', padding: '12px 16px', border: '1px solid #e2e8f0', borderRadius: '12px', fontSize: '14px', outline: 'none', boxSizing: 'border-box', resize: 'vertical', backgroundColor: '#f8f9fa', color: '#2d3748' }}
              />
            </div>

            <button 
              type="submit"
              style={{ backgroundColor: '#cb0c9f', color: '#fff', border: 'none', padding: '12px 24px', borderRadius: '12px', fontWeight: '600', fontSize: '14px', cursor: 'pointer', boxShadow: '0 4px 7px -1px rgba(203, 12, 159, 0.4)', alignSelf: 'flex-start' }}
            >
              Submit Issue
            </button>

          </form>
        </div>

      </main>
    </div>
  );
}