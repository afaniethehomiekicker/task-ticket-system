import { useState, useEffect } from 'react';
import api from '../services/api';
import CreateTaskModal from '../components/CreateTaskModal';

const COLUMNS = [
  { id: 'new', title: 'New', color: '#3b82f6' },
  { id: 'todo', title: 'To Do', color: '#6366f1' },
  { id: 'in_progress', title: 'In Progress', color: '#f59e0b' },
  { id: 'on_hold', title: 'On Hold', color: '#9ca3af' },
  { id: 'under_review', title: 'Under Review', color: '#8b5cf6' },
  { id: 'completed', title: 'Completed', color: '#10b981' },
  { id: 'closed', title: 'Closed', color: '#6b7280' },
];

export default function KanbanBoard() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    async function fetchTasks() {
      try {
        const response = await api.get('/tickets');
        const data = Array.isArray(response.data) ? response.data : response.data.tickets || [];
        setTasks(data);
      } catch (err) {
        console.error('Failed to load board tasks', err);
        setTasks([]);
      } finally {
        setLoading(false);
      }
    }
    fetchTasks();
  }, []);

  const handleStatusChange = async (taskId, newStatus) => {
    if (!taskId) {
      console.error('Cannot update status: Task ID is undefined');
      return;
    }
    try {
      setTasks(tasks.map(t => ((t.ID === taskId || t.id === taskId) ? { ...t, Status: newStatus, status: newStatus } : t)));
      await api.patch(`/tickets/${taskId}/status`, { status: newStatus });
    } catch (err) {
      console.error('Failed to update task status', err);
    }
  };

  const handleTaskCreated = (newTask) => {
    setTasks([...tasks, newTask]);
  };

  if (loading) return <div style={{ color: '#A3AED0' }}>Loading Kanban board...</div>;

  return (
    <div style={{ fontFamily: 'Inter, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <div>
          <h1 style={{ color: '#2B3674', fontSize: '26px', margin: '0 0 5px 0' }}>Kanban Board</h1>
          <p style={{ color: '#A3AED0', margin: 0 }}>Manage and transition workflow tasks across status columns.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          style={{ padding: '10px 20px', background: '#0052FF', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
        >
          + Add Task
        </button>
      </div>

      <div style={{ display: 'flex', gap: '20px', overflowX: 'auto', paddingBottom: '20px' }}>
        {COLUMNS.map(col => {
          const columnTasks = tasks.filter(t => (t.Status || t.status || 'new').toLowerCase() === col.id);

          return (
            <div key={col.id} style={{ minWidth: '280px', background: '#F4F7FE', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 'bold', color: '#2B3674', fontSize: '15px' }}>{col.title}</span>
                <span style={{ background: '#fff', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', color: '#A3AED0', fontWeight: 'bold' }}>
                  {columnTasks.length}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minHeight: '400px' }}>
                {columnTasks.map(task => (
                  <div key={task.ID || task.id} style={{ background: '#fff', padding: '16px', borderRadius: '12px', boxShadow: '0px 4px 12px rgba(112, 144, 176, 0.08)' }}>
                    <h4 style={{ color: '#2B3674', margin: '0 0 8px 0', fontSize: '14px' }}>{task.Title || task.title}</h4>
                    <p style={{ color: '#A3AED0', fontSize: '12px', margin: '0 0 12px 0' }}>{task.Description || task.description || 'No description'}</p>
                    
                    <select 
                      value={task.Status || task.status || 'new'} 
                      onChange={(e) => handleStatusChange(task.ID || task.id, e.target.value)}
                      style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid #E0E5F2', fontSize: '12px', background: '#fff', color: '#2B3674', cursor: 'pointer' }}
                    >
                      {COLUMNS.map(c => (
                        <option key={c.id} value={c.id}>{c.title}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <CreateTaskModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onTaskCreated={handleTaskCreated} 
      />
    </div>
  );
}