import { useState, useEffect } from 'react';
import api from '../services/api';

export default function CreateTaskModal({ isOpen, onClose, onTaskCreated }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('new');
  const [priority, setPriority] = useState('Medium');
  const [assigneeId, setAssigneeId] = useState('');
  const [users, setUsers] = useState([]);

  useEffect(() => {
    if (isOpen) {
      async function fetchUsers() {
        try {
          const response = await api.get('/users');
          const userData = Array.isArray(response.data) ? response.data : response.data.users || [];
          setUsers(userData);
        } catch (err) {
          console.error('Failed to load users for assignment', err);
        }
      }
      fetchUsers();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        title,
        description,
        status,
        priority,
        assignee_id: assigneeId ? Number(assigneeId) : null
      };
      const response = await api.post('/tickets', payload);
      onTaskCreated(response.data.ticket || response.data);
      setTitle('');
      setDescription('');
      setStatus('new');
      setPriority('Medium');
      setAssigneeId('');
      onClose();
    } catch (err) {
      console.error('Failed to create task', err);
    }
  };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', padding: '30px', borderRadius: '16px', width: '420px', boxShadow: '0px 20px 40px rgba(0,0,0,0.1)' }}>
        <h3 style={{ color: '#2B3674', marginTop: 0, marginBottom: '20px' }}>Create New Task / Ticket</h3>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div>
            <label style={{ display: 'block', color: '#2B3674', fontSize: '13px', fontWeight: 'bold', marginBottom: '5px' }}>Title</label>
            <input 
              type="text" 
              value={title} 
              onChange={(e) => setTitle(e.target.value)} 
              placeholder="Enter task title..."
              required 
              style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #E0E5F2', background: '#fff', color: '#2B3674', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', color: '#2B3674', fontSize: '13px', fontWeight: 'bold', marginBottom: '5px' }}>Description</label>
            <textarea 
              value={description} 
              onChange={(e) => setDescription(e.target.value)} 
              placeholder="Enter task description..."
              rows="3"
              style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #E0E5F2', background: '#fff', color: '#2B3674', boxSizing: 'border-box', outline: 'none', resize: 'vertical' }}
            />
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', color: '#2B3674', fontSize: '13px', fontWeight: 'bold', marginBottom: '5px' }}>Initial Status</label>
              <select 
                value={status} 
                onChange={(e) => setStatus(e.target.value)}
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #E0E5F2', background: '#fff', color: '#2B3674', boxSizing: 'border-box', outline: 'none' }}
              >
                <option value="new">New</option>
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', color: '#2B3674', fontSize: '13px', fontWeight: 'bold', marginBottom: '5px' }}>Priority</label>
              <select 
                value={priority} 
                onChange={(e) => setPriority(e.target.value)}
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #E0E5F2', background: '#fff', color: '#2B3674', boxSizing: 'border-box', outline: 'none' }}
              >
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
                <option value="Urgent">Urgent</option>
              </select>
            </div>
          </div>
          <div>
            <label style={{ display: 'block', color: '#2B3674', fontSize: '13px', fontWeight: 'bold', marginBottom: '5px' }}>Assignee</label>
            <select 
              value={assigneeId} 
              onChange={(e) => setAssigneeId(e.target.value)}
              style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #E0E5F2', background: '#fff', color: '#2B3674', boxSizing: 'border-box', outline: 'none' }}
            >
              <option value="">Unassigned</option>
              {users.map(user => (
                <option key={user.ID || user.id} value={user.ID || user.id}>
                  {user.Name || user.name || user.Email || user.email}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
            <button type="button" onClick={onClose} style={{ padding: '10px 16px', background: '#f4f7fe', color: '#2B3674', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>Cancel</button>
            <button type="submit" style={{ padding: '10px 16px', background: '#0052FF', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>Create</button>
          </div>
        </form>
      </div>
    </div>
  );
}