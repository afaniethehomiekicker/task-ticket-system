import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import API from '../services/api';

export default function IssueDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [issue, setIssue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');

  useEffect(() => {
    const fetchIssueDetail = async () => {
      try {
        const res = await API.get(`/issues/${id}`);
        setIssue(res.data.issue);
        setComments(res.data.issue.Comments || []);
      } catch (err) {
        console.error('Failed to fetch issue details', err);
      } finally {
        setLoading(false);
      }
    };

    fetchIssueDetail();
  }, [id]);

  const handleAddComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;

    try {
      const res = await API.post(`/issues/${id}/comments`, { content: newComment });
      setComments([...comments, res.data.comment]);
      setNewComment('');
    } catch (err) {
      console.error('Failed to add comment', err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Loading issue details...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      {/* Sidebar matching your Dashboard */}
      <aside className="w-64 border-r border-gray-800 bg-gray-900/50 p-6 flex flex-col justify-between hidden md:flex">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white mb-8">Dashboard</h2>
          <nav className="space-y-2">
            <button
              onClick={() => navigate('/dashboard')}
              className="w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-white transition"
            >
              Dashboard
            </button>
            <button
              onClick={() => navigate('/issues')}
              className="w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium bg-gray-800 text-white transition"
            >
              Issues Feed
            </button>
          </nav>
        </div>
        <div className="border-t border-gray-800 pt-4 text-xs text-gray-500">
          DevIssues v1.0
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-3xl mx-auto">
          {/* Header */}
          <div className="flex justify-between items-center mb-8 border-b border-gray-800 pb-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-white">Issue Details</h1>
              <p className="text-sm text-gray-400 mt-1">View and manage reported bug or error.</p>
            </div>
            <button
              onClick={() => navigate('/issues')}
              className="bg-gray-800 hover:bg-gray-700 text-gray-200 px-4 py-2 rounded-lg text-sm font-medium transition"
            >
              Back to Feed
            </button>
          </div>

          {!issue ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-400">
              <p>Issue not found.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Title Card */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 shadow-sm">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Title</h3>
                <h2 className="text-lg font-semibold text-white">{issue.title}</h2>
              </div>

              {/* Status Card */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 shadow-sm">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Status</h3>
                <span className="inline-block bg-blue-500/10 text-blue-400 border border-blue-500/20 text-xs px-3 py-1 rounded-full font-medium">
                  {issue.status || 'Open'}
                </span>
              </div>

              {/* Category Card */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 shadow-sm">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Category</h3>
                <span className="inline-block bg-gray-800 text-gray-300 text-xs px-3 py-1.5 rounded-md">
                  📂 {issue.category || 'General'}
                </span>
              </div>

              {/* Technology Card */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 shadow-sm">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Technology</h3>
                <span className="inline-block bg-gray-800 text-gray-300 text-xs px-3 py-1.5 rounded-md">
                  ⚙️ {issue.technology || 'N/A'}
                </span>
              </div>

              {/* Priority Card */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 shadow-sm">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Priority</h3>
                <span className="inline-block bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs px-3 py-1.5 rounded-md">
                  ⚡ {issue.priority || 'Normal'}
                </span>
              </div>

              {/* Description Card */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 shadow-sm">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Description</h3>
                <p className="text-gray-200 whitespace-pre-wrap leading-relaxed text-sm bg-gray-950/50 p-4 rounded-lg border border-gray-800/60">
                  {issue.description}
                </p>
              </div>

              {/* Comments & Solutions Section */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 shadow-sm">
                <h3 className="text-sm font-semibold text-white mb-4">Discussion & Solutions</h3>

                {/* Comments List */}
                <div className="space-y-4 mb-6">
                  {comments.length === 0 ? (
                    <p className="text-gray-500 text-sm">No comments or solutions yet. Be the first to add one!</p>
                  ) : (
                    comments.map((comment) => (
                      <div key={comment.ID || comment.id} className="bg-gray-950/60 border border-gray-800/80 rounded-lg p-4">
                        <p className="text-gray-200 text-sm mb-2">{comment.content}</p>
                        <div className="text-xs text-gray-500 flex justify-between">
                          <span>By: {comment.User?.username || 'Developer'}</span>
                          <span>{new Date(comment.CreatedAt || comment.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Add Comment Form */}
                <form onSubmit={handleAddComment} className="space-y-3">
                  <textarea
                    rows="3"
                    placeholder="Write a solution or troubleshooting step..."
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    className="w-full bg-gray-950 border border-gray-800 rounded-lg p-3 text-sm text-white focus:outline-none focus:border-blue-500 transition"
                  />
                  <button
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
                  >
                    Post Solution / Comment
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}