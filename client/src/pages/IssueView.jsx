import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import API from '../services/api';

export default function IssueView() {
  const { id } = useParams();
  const [issue, setIssue] = useState(null);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [commentType, setCommentType] = useState('Discussion Comment');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchIssueDetails = async () => {
    try {
      const res = await API.get(`/api/issues/${id}`);
      const issueData = res.data.issue || res.data.data || res.data;
      setIssue(issueData);
      setComments(issueData.comments || issueData.Comments || []);
    } catch (err) {
      setError('Failed to load issue details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIssueDetails();
  }, [id]);

  const handleCommentSubmit = async (e) => {
    e.preventDefault();
    if (!commentText.trim()) return;

    try {
      await API.post(`/api/issues/${id}/comments`, { 
        content: commentText,
        type: commentType 
      });
      setCommentText('');
      fetchIssueDetails();
    } catch (err) {
      console.error('Failed to post comment/solution', err);
    }
  };

  if (loading) return <div style={{ padding: '40px', color: '#2d3748', textAlign: 'center', backgroundColor: '#f8f9fa', minHeight: '100vh', fontFamily: 'Open Sans, sans-serif' }}>Loading issue details...</div>;
  if (error) return <div style={{ padding: '40px', color: '#e53e3e', textAlign: 'center', backgroundColor: '#f8f9fa', minHeight: '100vh', fontFamily: 'Open Sans, sans-serif' }}>{error}</div>;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8f9fa', fontFamily: 'Open Sans, sans-serif', display: 'flex', width: '100vw', position: 'absolute', top: 0, left: 0, zIndex: 999 }}>
      
      {/* Soft UI Sidebar */}
      <aside style={{ width: '260px', backgroundColor: '#ffffff', borderRight: '1px solid rgba(0,0,0,0.05)', padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px', flexShrink: 0 }}>
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
          <Link to="/issues/new" style={{ textDecoration: 'none', color: '#67748e', padding: '12px 16px', borderRadius: '12px', fontSize: '14px', fontWeight: '600' }}>
            Create Issue
          </Link>
        </nav>
      </aside>

      {/* Main Content Area */}
      <main style={{ flex: 1, padding: '32px', boxSizing: 'border-box', overflowY: 'auto', backgroundColor: '#f8f9fa' }}>
        
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          
          {/* Header Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
            <div>
              <span style={{ fontSize: '12px', color: '#67748e', fontWeight: '600' }}>Pages / Issue Details</span>
              <h1 style={{ fontSize: '20px', fontWeight: 'bold', color: '#2d3748', margin: '4px 0 0 0' }}>Issue Overview</h1>
            </div>
            <Link to="/issues" style={{ backgroundColor: '#e2e8f0', color: '#4a5568', padding: '10px 20px', borderRadius: '12px', textDecoration: 'none', fontWeight: '600', fontSize: '13px' }}>
              &larr; Back to Issues
            </Link>
          </div>

          {issue && (
            <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '24px' }}>
              
              {/* Left Column */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                
                {/* Issue Title & Status Card */}
                <div style={{ backgroundColor: '#ffffff', borderRadius: '20px', padding: '24px', boxShadow: '0 20px 27px 0 rgba(0, 0, 0, 0.05)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                    <span style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '2px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: '700' }}>
                      {issue.status || issue.Status || 'Open'}
                    </span>
                    <h2 style={{ fontSize: '22px', fontWeight: 'bold', color: '#2d3748', margin: 0 }}>
                      {issue.title || issue.Title || 'Untitled Issue'}
                    </h2>
                    <span style={{ color: '#a0aec0', fontSize: '14px' }}>#{issue.id || id}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#67748e' }}>
                    Opened by <strong style={{ color: '#2d3748' }}>{issue.username || issue.Username || 'dev_user'}</strong>
                  </div>
                </div>

                {/* Description Card */}
                <div style={{ backgroundColor: '#ffffff', borderRadius: '20px', padding: '24px', boxShadow: '0 20px 27px 0 rgba(0, 0, 0, 0.05)' }}>
                  <h4 style={{ fontSize: '11px', fontWeight: '700', color: '#67748e', textTransform: 'uppercase', marginBottom: '12px', letterSpacing: '0.05em' }}>Description & Steps</h4>
                  <p style={{ fontSize: '14px', color: '#4a5568', lineHeight: '1.6', whiteSpace: 'pre-wrap', margin: 0 }}>
                    {issue.description || issue.Description || 'No description provided.'}
                  </p>
                </div>

                {/* Discussion Thread Card */}
                <div style={{ backgroundColor: '#ffffff', borderRadius: '20px', padding: '24px', boxShadow: '0 20px 27px 0 rgba(0, 0, 0, 0.05)' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: 'bold', color: '#2d3748', marginBottom: '16px' }}>Discussion Thread</h3>

                  {comments.length === 0 ? (
                    <p style={{ color: '#67748e', fontSize: '14px', marginBottom: '20px' }}>No comments or solutions yet.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
                      {comments.map((comment, index) => (
                        <div key={index} style={{ backgroundColor: '#f8f9fa', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px' }}>
                          <div style={{ fontSize: '12px', color: '#cb0c9f', fontWeight: '700', marginBottom: '4px' }}>{comment.type || comment.Type || 'Comment'}</div>
                          <p style={{ fontSize: '14px', color: '#2d3748', margin: 0 }}>{comment.content || comment.Content}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Comment Form */}
                  <form onSubmit={handleCommentSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px', borderTop: '1px solid #e2e8f0', paddingTop: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label style={{ fontSize: '11px', fontWeight: '700', color: '#67748e', textTransform: 'uppercase' }}>Post a Comment</label>
                      <select 
                        value={commentType}
                        onChange={(e) => setCommentType(e.target.value)}
                        style={{ backgroundColor: '#f8f9fa', border: '1px solid #e2e8f0', color: '#2d3748', padding: '6px 10px', borderRadius: '8px', fontSize: '12px', outline: 'none' }}
                      >
                        <option value="Discussion Comment">Discussion Comment</option>
                        <option value="Working Solution">Working Solution</option>
                      </select>
                    </div>

                    <textarea 
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      required
                      rows="3"
                      placeholder="Write your comment or solution here..."
                      style={{ width: '100%', padding: '12px', backgroundColor: '#f8f9fa', border: '1px solid #e2e8f0', borderRadius: '12px', color: '#2d3748', fontSize: '14px', outline: 'none', boxSizing: 'border-box', resize: 'vertical' }}
                    />
                    
                    <button 
                      type="submit"
                      style={{ alignSelf: 'flex-start', backgroundColor: '#cb0c9f', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '12px', fontWeight: '600', fontSize: '13px', cursor: 'pointer', boxShadow: '0 4px 7px -1px rgba(203, 12, 159, 0.4)' }}
                    >
                      Post Comment
                    </button>
                  </form>
                </div>

              </div>

              {/* Right Sidebar Metadata Card */}
              <aside style={{ backgroundColor: '#ffffff', borderRadius: '20px', padding: '24px', boxShadow: '0 20px 27px 0 rgba(0, 0, 0, 0.05)', height: 'fit-content', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div>
                  <span style={{ fontSize: '11px', fontWeight: '700', color: '#67748e', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>Category</span>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: '#2d3748', backgroundColor: '#f8f9fa', padding: '6px 12px', borderRadius: '8px', display: 'inline-block', border: '1px solid #e2e8f0' }}>
                    {issue.category || issue.Category || 'Backend'}
                  </span>
                </div>
                <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '700', color: '#67748e', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>Technology</span>
                  <span style={{ fontSize: '13px', fontFamily: 'monospace', fontWeight: '600', color: '#cb0c9f' }}>
                    {issue.technology || issue.Technology || 'N/A'}
                  </span>
                </div>
                <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '700', color: '#67748e', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>Priority</span>
                  <span style={{ fontSize: '13px', color: '#e53e3e', fontWeight: '700' }}>
                    {issue.priority || issue.Priority || 'Normal'}
                  </span>
                </div>
              </aside>

            </div>
          )}
        </div>

      </main>
    </div>
  );
}