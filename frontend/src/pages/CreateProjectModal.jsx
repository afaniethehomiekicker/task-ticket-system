import React, { useState } from 'react';
import api from '../services/api';

export default function CreateProjectModal({ isOpen, onClose, onProjectCreated }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('Active');
  const [deadline, setDeadline] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
  e.preventDefault();
  setLoading(true);
  setError('');

  try {
    // Ensure the date is sent in YYYY-MM-DD format or ISO string
    let formattedDeadline = deadline;
    if (deadline) {
      const dateObj = new Date(deadline);
      if (!isNaN(dateObj.getTime())) {
        formattedDeadline = dateObj.toISOString().split('T')[0]; // Sends "YYYY-MM-DD"
      }
    }

    const response = await api.post('/projects', 
      { 
        title, 
        description, 
        status, 
        deadline: formattedDeadline 
      },
      { headers: { 'x-user-role': 'Super Admin' } }
    );
    
    if (onProjectCreated) {
      onProjectCreated(response.data);
    }
    onClose();
  } catch (err) {
    console.error("Failed to create project", err);
    setError('Failed to create project. Please check your inputs.');
  } finally {
    setLoading(false);
  }
};

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1000,
      fontFamily: 'Inter, sans-serif'
    }}>
      <div style={{
        background: '#ffffff',
        padding: '32px',
        borderRadius: '16px',
        width: '450px',
        boxShadow: '0px 20px 40px rgba(0, 0, 0, 0.1)',
        boxSizing: 'border-box'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ margin: 0, color: '#2B3674', fontSize: '20px', fontWeight: '700' }}>Create New Project</h3>
          <button 
            onClick={onClose} 
            style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#A3AED0' }}
          >
            ✕
          </button>
        </div>

        {error && (
          <div style={{ marginBottom: '15px', padding: '10px', background: '#FFF5F5', color: '#E53E3E', borderRadius: '8px', fontSize: '13px' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#2B3674', marginBottom: '6px' }}>Project Title</label>
            <input 
              type="text" 
              placeholder="e.g. Core System Migration" 
              value={title} 
              onChange={(e) => setTitle(e.target.value)} 
              required
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: '8px',
                border: '1px solid #E2E8F0',
                fontSize: '14px',
                boxSizing: 'border-box',
                outline: 'none',
                color: '#2B3674',
                backgroundColor: '#F8FAFC'
              }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#2B3674', marginBottom: '6px' }}>Description</label>
            <textarea 
              placeholder="Enter brief project overview..." 
              value={description} 
              onChange={(e) => setDescription(e.target.value)} 
              rows={3}
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: '8px',
                border: '1px solid #E2E8F0',
                fontSize: '14px',
                boxSizing: 'border-box',
                outline: 'none',
                color: '#2B3674',
                backgroundColor: '#F8FAFC',
                resize: 'none'
              }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#2B3674', marginBottom: '6px' }}>Status</label>
            <select 
              value={status} 
              onChange={(e) => setStatus(e.target.value)}
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: '8px',
                border: '1px solid #E2E8F0',
                fontSize: '14px',
                boxSizing: 'border-box',
                outline: 'none',
                color: '#2B3674',
                backgroundColor: '#F8FAFC'
              }}
            >
              <option value="Active">Active</option>
              <option value="In Progress">In Progress</option>
              <option value="Completed">Completed</option>
            </select>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#2B3674', marginBottom: '6px' }}>Deadline</label>
            <input 
              type="date" 
              value={deadline} 
              onChange={(e) => setDeadline(e.target.value)} 
              required
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: '8px',
                border: '1px solid #E2E8F0',
                fontSize: '14px',
                boxSizing: 'border-box',
                outline: 'none',
                color: '#2B3674',
                backgroundColor: '#F8FAFC'
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button 
              type="button" 
              onClick={onClose}
              style={{
                padding: '10px 18px',
                borderRadius: '8px',
                border: '1px solid #E2E8F0',
                background: '#fff',
                color: '#718096',
                fontWeight: '600',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              disabled={loading}
              style={{
                padding: '10px 20px',
                borderRadius: '8px',
                border: 'none',
                background: '#0052FF',
                color: '#fff',
                fontWeight: '600',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              {loading ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}