import React, { useState, useEffect } from 'react';
import api from '../services/api';
import CreateProjectModal from './CreateProjectModal';

export default function Projects() {
  const [projects, setProjects] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const fetchProjects = async () => {
    try {
      const response = await api.get('/projects', { headers: { 'x-user-role': 'Super Admin' } });
      setProjects(response.data.projects || response.data || []);
    } catch (err) {
      console.error("Failed to fetch projects", err);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  return (
    <div className="projects-container" style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2 style={{ color: '#2B3674', margin: '0 0 5px 0' }}>Project List</h2>
          <p style={{ color: '#A3AED0', margin: 0 }}>Manage and track all active projects and team workflows.</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          style={{ 
            background: '#0052FF', 
            color: '#fff', 
            border: 'none', 
            padding: '10px 16px', 
            borderRadius: '8px', 
            cursor: 'pointer', 
            fontWeight: '600',
            fontSize: '14px'
          }}
        >
          + Create Project
        </button>
      </div>

      <div style={{ display: 'grid', gap: '15px' }}>
        {projects.length === 0 ? (
          <p style={{ color: '#A3AED0', textAlign: 'center', padding: '40px' }}>No projects found. Create your first project above!</p>
        ) : (
          projects.map((project) => (
            <div key={project.ID || project.id || project._id} style={{ background: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0px 4px 12px rgba(0,0,0,0.03)', border: '1px solid #E2E8F0' }}>
              <h3 style={{ margin: '0 0 8px 0', color: '#2B3674', fontSize: '18px' }}>{project.title}</h3>
              <p style={{ margin: '0 0 12px 0', color: '#718096', fontSize: '14px' }}>{project.description}</p>
              <div style={{ display: 'flex', gap: '15px', fontSize: '12px', color: '#A3AED0' }}>
                <span style={{ background: '#F4F7FE', padding: '4px 10px', borderRadius: '6px', color: '#0052FF', fontWeight: '600' }}>
                  {project.status}
                </span>
                <span>Deadline: {project.deadline ? project.deadline.split('T')[0] : 'N/A'}</span>
              </div>
            </div>
          ))
        )}
      </div>

      <CreateProjectModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onProjectCreated={() => {
          fetchProjects();
        }}
      />
    </div>
  );
}