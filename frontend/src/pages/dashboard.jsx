import React, { useState, useEffect } from 'react';
import api from '../services/api';

export default function Dashboard() {
  const [stats, setStats] = useState({ projectsCount: 0, tasksCount: 0, completedCount: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        const [projectsRes, tasksRes] = await Promise.all([
          api.get('/projects', { headers: { 'X-User-Role': 'Super Admin' } }),
          api.get('/tasks', { headers: { 'X-User-Role': 'Super Admin' } })
        ]);
        
        const projects = projectsRes.data.projects || projectsRes.data || [];
        const tasks = tasksRes.data.tasks || tasksRes.data || [];
        
        setStats({
          projectsCount: projects.length,
          tasksCount: tasks.length,
          completedCount: tasks.filter(t => t.status === 'Completed' || t.status === 'Done').length
        });
      } catch (err) {
        console.error("Failed to load dashboard metrics", err);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  return (
    <div style={{ padding: '30px', fontFamily: 'Inter, sans-serif' }}>
      <h2 style={{ color: '#2B3674', marginBottom: '5px' }}>Dashboard Overview</h2>
      <p style={{ color: '#A3AED0', marginBottom: '25px' }}>Welcome back, afan!</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '25px' }}>
        <div style={{ background: '#fff', padding: '20px', borderRadius: '16px', boxShadow: '0px 10px 30px rgba(0,0,0,0.05)' }}>
          <p style={{ color: '#A3AED0', fontSize: '14px', margin: '0 0 8px 0' }}>Total Projects</p>
          <h3 style={{ color: '#2B3674', fontSize: '28px', margin: 0 }}>{loading ? '...' : stats.projectsCount}</h3>
        </div>
        <div style={{ background: '#fff', padding: '20px', borderRadius: '16px', boxShadow: '0px 10px 30px rgba(0,0,0,0.05)' }}>
          <p style={{ color: '#A3AED0', fontSize: '14px', margin: '0 0 8px 0' }}>Total Issues / Tasks</p>
          <h3 style={{ color: '#2B3674', fontSize: '28px', margin: 0 }}>{loading ? '...' : stats.tasksCount}</h3>
        </div>
        <div style={{ background: '#fff', padding: '20px', borderRadius: '16px', boxShadow: '0px 10px 30px rgba(0,0,0,0.05)' }}>
          <p style={{ color: '#A3AED0', fontSize: '14px', margin: '0 0 8px 0' }}>Completed Tasks</p>
          <h3 style={{ color: '#05CD99', fontSize: '28px', margin: 0 }}>{loading ? '...' : stats.completedCount}</h3>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
        <div style={{ background: '#fff', padding: '25px', borderRadius: '16px', boxShadow: '0px 10px 30px rgba(0,0,0,0.05)' }}>
          <h4 style={{ color: '#2B3674', margin: '0 0 15px 0' }}>System Status & Role</h4>
          <div style={{ display: 'flex', gap: '15px' }}>
            <div style={{ flex: 1, background: '#F4F7FE', padding: '15px', borderRadius: '12px' }}>
              <span style={{ color: '#A3AED0', fontSize: '12px' }}>Current Role</span>
              <p style={{ color: '#2B3674', fontWeight: 'bold', margin: '5px 0 0 0' }}>Super Admin</p>
            </div>
            <div style={{ flex: 1, background: '#F4F7FE', padding: '15px', borderRadius: '12px' }}>
              <span style={{ color: '#A3AED0', fontSize: '12px' }}>System Status</span>
              <p style={{ color: '#05CD99', fontWeight: 'bold', margin: '5px 0 0 0' }}>Active (PostgreSQL Connected)</p>
            </div>
          </div>
        </div>

        <div style={{ background: '#fff', padding: '25px', borderRadius: '16px', boxShadow: '0px 10px 30px rgba(0,0,0,0.05)' }}>
          <h4 style={{ color: '#2B3674', margin: '0 0 15px 0' }}>Quick Actions</h4>
          <p style={{ color: '#A3AED0', fontSize: '13px', margin: '0 0 15px 0' }}>Jump straight into managing projects and tracking issues.</p>
          <a href="/projects" style={{ display: 'block', background: '#0052FF', color: '#fff', textAlign: 'center', padding: '10px', borderRadius: '8px', textDecoration: 'none', fontWeight: '600' }}>Manage Projects</a>
        </div>
      </div>
    </div>
  );
}