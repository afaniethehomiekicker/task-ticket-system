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
      // Handle both direct object or wrapped response data
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

  if (loading) return <div style={{ padding: '24px', color: '#fff', textAlign: 'center' }}>Loading issue details...</div>;
  if (error) return <div style={{ padding: '24px', color: '#f87171', textAlign: 'center' }}>{error}</div>;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#030712', color: '#f3f4f6', padding: '32px', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <Link to="/dashboard" style={{ backgroundColor: '#1f2937', color: '#ffffff', padding: '8px 16px', borderRadius: '8px', fontSize: '13px', textDecoration: 'none', fontWeight: '600' }}>
            &larr; Back to Dashboard
          </Link>
        </div>

        {issue && (
          <div style={{ backgroundColor: '#111827', border: '1px solid #1f2937', borderRadius: '16px', padding: '28px', marginBottom: '24px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
              <h1 style={{ fontSize: '22px', fontWeight: 'bold', color: '#ffffff', margin: 0 }}>
                {issue.title || issue.Title || 'Untitled Issue'}
              </h1>
              <span style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#60a5fa', border: '1px solid rgba(59, 130, 246, 0.2)', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '600' }}>
                {issue.category || issue.Category || 'Backend'}
              </span>
            </div>

            <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '16px' }}>
              Technology: <strong style={{ color: '#e5e7eb' }}>{issue.technology || issue.Technology || issue.technologies || 'N/A'}</strong> | Priority: <strong style={{ color: '#e5e7eb' }}>{issue.priority || issue.Priority || 'Normal'}</strong>
            </div>

            <div style={{ borderTop: '1px solid #1f2937', paddingTop: '16px', marginTop: '16px' }}>
              <h4 style={{ fontSize: '12px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Detailed Description & Steps to Reproduce:</h4>
              <p style={{ fontSize: '14px', color: '#d1d5db', lineHeight: '1.6', whiteSpace: 'pre-wrap', margin: 0 }}>
                {issue.description || issue.Description || 'No description provided.'}
              </p>
            </div>
          </div>
        )}

        {/* Solutions & Discussion Section */}
        <div style={{ backgroundColor: '#111827', border: '1px solid #1f2937', borderRadius: '16px', padding: '28px', marginBottom: '24px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#ffffff', marginBottom: '20px' }}>Solutions & Discussion</h3>

          {comments.length === 0 ? (
            <p style={{ color: '#9ca3af', fontSize: '14px', marginBottom: '24px' }}>No comments or solutions yet. Be the first to help out!</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
              {comments.map((comment, index) => (
                <div key={index} style={{ backgroundColor: '#030712', border: '1px solid #1f2937', borderRadius: '10px', padding: '16px' }}>
                  <div style={{ fontSize: '12px', color: '#60a5fa', fontWeight: '600', marginBottom: '4px' }}>{comment.type || comment.Type || 'Comment'}</div>
                  <p style={{ fontSize: '14px', color: '#e5e7eb', margin: 0 }}>{comment.content || comment.Content}</p>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleCommentSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px', borderTop: '1px solid #1f2937', paddingTop: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '12px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Post a Solution or Comment</label>
              <select 
                value={commentType}
                onChange={(e) => setCommentType(e.target.value)}
                style={{ backgroundColor: '#030712', border: '1px solid #1f2937', color: '#fff', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', outline: 'none' }}
              >
                <option value="Discussion Comment">Discussion Comment</option>
                <option value="Working Solution">Working Solution</option>
              </select>
            </div>

            <textarea 
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              required
              rows="4"
              placeholder="Write your comment or solution here..."
              style={{ width: '100%', padding: '12px 16px', backgroundColor: '#030712', border: '1px solid #1f2937', borderRadius: '8px', color: '#fff', fontSize: '14px', outline: 'none', boxSizing: 'border-box', resize: 'vertical' }}
            />
            
            <button 
              type="submit"
              style={{ alignSelf: 'flex-end', backgroundColor: '#3b82f6', color: '#fff', border: 'none', padding: '10px 24px', borderRadius: '8px', fontWeight: '600', fontSize: '14px', cursor: 'pointer', transition: 'background 0.2s' }}
            >
              Post Comment
            </button>
          </form>
        </div>

      </div>
    </div>
  );
}