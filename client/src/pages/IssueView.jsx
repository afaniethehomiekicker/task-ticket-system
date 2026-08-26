import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import API from '../services/api';

export default function IssueView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [issue, setIssue] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // Comments and Solutions States
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [commentType, setCommentType] = useState('comment'); // 'comment' or 'solution'

  const fetchIssueDetails = async () => {
    try {
      const res = await API.get(`/issues/${id}`);
      setIssue(res.data.issue);
      // Agar backend se comments bhi sath aate hain toh yahan set kar sakte ho:
      // setComments(res.data.issue.comments || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIssueDetails();
  }, [id]);

  const handleCommentSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        content: newComment,
        isSolution: commentType === 'solution'
      };

      await API.post(`/issues/${id}/comments`, payload);
      setNewComment('');
      fetchIssueDetails(); // Refresh details/comments
    } catch (err) {
      console.error('Failed to post comment/solution', err);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#030712', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' }}>
        <p style={{ color: '#9ca3af', fontSize: '14px' }}>Loading issue details...</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#030712', color: '#f3f4f6', padding: '32px', display: 'flex', justifyContent: 'center', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: '768px', width: '100%', backgroundColor: '#111827', border: '1px solid #1f2937', borderRadius: '16px', padding: '32px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1f2937', paddingBottom: '16px' }}>
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#ffffff', margin: '0 0 4px 0', letterSpacing: '-0.025em' }}>Issue Details</h1>
            <p style={{ fontSize: '14px', color: '#9ca3af', margin: 0 }}>View bug info and troubleshooting details.</p>
          </div>
          <button 
            onClick={() => navigate('/issues')}
            style={{ backgroundColor: '#1f2937', color: '#ffffff', border: 'none', padding: '8px 16px', borderRadius: '8px', fontSize: '14px', fontWeight: '500', cursor: 'pointer', transition: 'background 0.2s' }}
            onMouseOver={(e) => e.target.style.backgroundColor = '#374151'}
            onMouseOut={(e) => e.target.style.backgroundColor = '#1f2937'}
          >
            Back to Feed
          </button>
        </div>

        {/* Title */}
        <div style={{ backgroundColor: '#030712', padding: '16px', borderRadius: '12px', border: '1px solid #1f2937' }}>
          <span style={{ fontSize: '11px', fontWeight: '600', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>Issue Title</span>
          <h2 style={{ fontSize: '18px', fontWeight: '600', color: '#ffffff', margin: 0 }}>{issue?.title}</h2>
        </div>

        {/* Meta info Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          <div style={{ backgroundColor: '#030712', padding: '16px', borderRadius: '12px', border: '1px solid #1f2937' }}>
            <span style={{ fontSize: '11px', fontWeight: '600', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>Category</span>
            <p style={{ fontSize: '14px', color: '#ffffff', margin: 0 }}>📂 {issue?.category || 'General'}</p>
          </div>
          <div style={{ backgroundColor: '#030712', padding: '16px', borderRadius: '12px', border: '1px solid #1f2937' }}>
            <span style={{ fontSize: '11px', fontWeight: '600', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>Priority</span>
            <p style={{ fontSize: '14px', color: '#ffffff', margin: 0 }}>⚡ {issue?.priority || 'Normal'}</p>
          </div>
        </div>

        {/* Description */}
        <div style={{ backgroundColor: '#030712', padding: '16px', borderRadius: '12px', border: '1px solid #1f2937' }}>
          <span style={{ fontSize: '11px', fontWeight: '600', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>Detailed Description</span>
          <p style={{ fontSize: '14px', color: '#d1d5db', whiteSpace: 'pre-wrap', lineHeight: '1.6', fontFamily: 'monospace', margin: 0 }}>{issue?.description}</p>
        </div>

        {/* --- Comments & Solutions Section --- */}
        <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: '#ffffff', borderBottom: '1px solid #1f2937', paddingBottom: '12px', margin: 0 }}>
            Solutions & Discussion
          </h2>

          {/* Submit Comment / Solution Form */}
          <form onSubmit={handleCommentSubmit} style={{ backgroundColor: '#030712', border: '1px solid #1f2937', borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '13px', fontWeight: '600', color: '#9ca3af', textTransform: 'uppercase' }}>
                Post a Solution or Comment
              </label>
              <select 
                value={commentType} 
                onChange={(e) => setCommentType(e.target.value)}
                style={{ backgroundColor: '#111827', color: '#ffffff', border: '1px solid #1f2937', padding: '6px 12px', borderRadius: '6px', fontSize: '13px', outline: 'none' }}
              >
                <option value="comment">Discussion Comment</option>
                <option value="solution">Technical Solution 💡</option>
              </select>
            </div>

            <textarea 
              rows="3"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Write your explanation, fix, or code example here..."
              required
              style={{ width: '100%', backgroundColor: '#111827', border: '1px solid #1f2937', borderRadius: '8px', padding: '12px', color: '#ffffff', fontSize: '14px', outline: 'none', boxSizing: 'border-box', resize: 'vertical' }}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button 
                type="submit"
                style={{ backgroundColor: '#2563eb', color: '#ffffff', border: 'none', padding: '10px 20px', borderRadius: '8px', fontWeight: '500', fontSize: '14px', cursor: 'pointer' }}
              >
                Post {commentType === 'solution' ? 'Solution' : 'Comment'}
              </button>
            </div>
          </form>

          {/* Comments & Solutions List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {comments && comments.length > 0 ? (
              comments.map((item, index) => (
                <div 
                  key={index} 
                  style={{ 
                    backgroundColor: '#030712', 
                    border: item.isSolution ? '1px solid #10b981' : '1px solid #1f2937', 
                    borderRadius: '12px', 
                    padding: '20px', 
                    display: 'flex', 
                    flexDirection: 'column', 
                    gap: '12px',
                    position: 'relative'
                  }}
                >
                  {item.isSolution && (
                    <span style={{ position: 'absolute', top: '16px', right: '16px', backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#34d399', border: '1px solid #10b981', padding: '2px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '600' }}>
                      Accepted Solution ✓
                    </span>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '14px', color: '#ffffff' }}>
                      {item.author ? item.author.charAt(0).toUpperCase() : 'U'}
                    </div>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: '600', color: '#ffffff' }}>{item.author || 'Developer'}</div>
                      <div style={{ fontSize: '12px', color: '#9ca3af' }}>{item.createdAt || 'Just now'}</div>
                    </div>
                  </div>

                  <p style={{ fontSize: '14px', color: '#e5e7eb', margin: 0, whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>
                    {item.content || item.body}
                  </p>
                </div>
              ))
            ) : (
              <div style={{ textAlign: 'center', padding: '24px', color: '#6b7280', fontSize: '14px', backgroundColor: '#030712', borderRadius: '12px', border: '1px solid #1f2937' }}>
                No comments or solutions yet. Be the first to help out!
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}