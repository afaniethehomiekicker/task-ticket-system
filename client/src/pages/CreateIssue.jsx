import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../services/api';

export default function CreateIssue() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Backend');
  const [technology, setTechnology] = useState('');
  const [priority, setPriority] = useState('Normal');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await API.post('/api/issues', {
        title,
        description,
        category,
        technology,
        priority,
        status: 'Open',
      });
      navigate('/dashboard');
    } catch (err) {
      console.error('Failed to create issue', err);
      setError('Failed to create issue. Please check your inputs and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#030712', color: '#f3f4f6', padding: '32px' }}>
      <div style={{ maxWidth: '672px', margin: '0 auto', backgroundColor: '#111827', border: '1px solid #1f2937', borderRadius: '16px', padding: '32px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)' }}>
        
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', borderBottom: '1px solid #1f2937', paddingBottom: '16px' }}>
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#ffffff', margin: 0 }}>Report New Technical Issue</h1>
            <p style={{ fontSize: '14px', color: '#9ca3af', marginTop: '4px' }}>Provide details, error info, and environment notes.</p>
          </div>
          <button
            onClick={() => navigate('/dashboard')}
            style={{ backgroundColor: '#1f2937', color: '#e5e7eb', border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '500' }}
          >
            Back to Dashboard
          </button>
        </div>

        {error && (
          <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '8px', color: '#f87171', fontSize: '14px', textAlign: 'center' }}>
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '500', color: '#9ca3af', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Issue Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="e.g. GORM Preload not loading nested relationship"
              style={{ width: '100%', backgroundColor: '#030712', border: '1px solid #1f2937', borderRadius: '8px', padding: '10px 16px', fontSize: '14px', color: '#ffffff', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '500', color: '#9ca3af', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                style={{ width: '100%', backgroundColor: '#030712', border: '1px solid #1f2937', borderRadius: '8px', padding: '10px 16px', fontSize: '14px', color: '#ffffff', outline: 'none', boxSizing: 'border-box' }}
              >
                <option value="Backend">Backend</option>
                <option value="Frontend">Frontend</option>
                <option value="Database">Database</option>
                <option value="DevOps">DevOps</option>
                <option value="Security">Security</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '500', color: '#9ca3af', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                style={{ width: '100%', backgroundColor: '#030712', border: '1px solid #1f2937', borderRadius: '8px', padding: '10px 16px', fontSize: '14px', color: '#ffffff', outline: 'none', boxSizing: 'border-box' }}
              >
                <option value="Low">Low</option>
                <option value="Normal">Normal</option>
                <option value="High">High</option>
                <option value="Urgent">Urgent</option>
                <option value="Critical">Critical</option>
              </select>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '500', color: '#9ca3af', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Technology / Stack
            </label>
            <input
              type="text"
              value={technology}
              onChange={(e) => setTechnology(e.target.value)}
              placeholder="e.g. Go / Gin / GORM / PostgreSQL"
              style={{ width: '100%', backgroundColor: '#030712', border: '1px solid #1f2937', borderRadius: '8px', padding: '10px 16px', fontSize: '14px', color: '#ffffff', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '500', color: '#9ca3af', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Detailed Description & Steps to Reproduce
            </label>
            <textarea
              rows="5"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              placeholder="Describe the expected vs actual behavior, error message, or logs..."
              style={{ width: '100%', backgroundColor: '#030712', border: '1px solid #1f2937', borderRadius: '8px', padding: '16px', fontSize: '14px', color: '#ffffff', outline: 'none', boxSizing: 'border-box', resize: 'vertical' }}
            ></textarea>
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{ width: '100%', backgroundColor: '#2563eb', color: '#ffffff', fontWeight: '500', padding: '12px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '14px', opacity: loading ? 0.5 : 1, transition: 'background-color 0.2s' }}
          >
            {loading ? 'Publishing Issue...' : 'Publish Issue'}
          </button>
        </form>
      </div>
    </div>
  );
}