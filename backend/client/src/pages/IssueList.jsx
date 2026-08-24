import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../services/api';

export default function IssueList() {
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const fetchIssues = async () => {
      try {
        const res = await API.get('/issues');
        setIssues(res.data.issues || []);
      } catch (err) {
        console.error('Failed to fetch issues', err);
      } finally {
        setLoading(false);
      }
    };

    fetchIssues();
  }, []);

  const filteredIssues = issues.filter(
    (issue) =>
      issue.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      issue.category?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      issue.technology?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-8 border-b border-gray-800 pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Technical Issues Feed</h1>
          <p className="text-sm text-gray-400 mt-1">Browse and search reported bugs, errors, and solutions.</p>
        </div>
        <div className="flex gap-4">
          <button
            onClick={() => navigate('/dashboard')}
            className="bg-gray-800 hover:bg-gray-700 text-gray-200 px-4 py-2 rounded-lg text-sm font-medium transition"
          >
            Dashboard
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="mb-6">
        <input
          type="text"
          placeholder="Search issues by title, category, or technology..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition shadow-sm"
        />
      </div>

      {/* Issue Feed Grid / List */}
      {loading ? (
        <p className="text-gray-400 text-sm">Loading issues...</p>
      ) : filteredIssues.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-400">
          <p>No issues found matching your search.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredIssues.map((issue) => (
            <div
              key={issue.ID || issue.id}
              onClick={() => navigate(`/issues/${issue.ID || issue.id}`)}
              className="bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl p-6 transition shadow-sm cursor-pointer"
            >
              <div className="flex justify-between items-start mb-2">
                <h2 className="text-lg font-semibold text-white">{issue.title}</h2>
                <span className="bg-blue-500/10 text-blue-400 border border-blue-500/20 text-xs px-2.5 py-1 rounded-full font-medium">
                  {issue.status || 'Open'}
                </span>
              </div>
              <p className="text-sm text-gray-400 mb-4 line-clamp-2">{issue.description}</p>
              <div className="flex flex-wrap gap-2 text-xs">
                {issue.category && (
                  <span className="bg-gray-800 text-gray-300 px-2.5 py-1 rounded-md">
                    📂 {issue.category}
                  </span>
                )}
                {issue.technology && (
                  <span className="bg-gray-800 text-gray-300 px-2.5 py-1 rounded-md">
                    ⚙️ {issue.technology}
                  </span>
                )}
                {issue.priority && (
                  <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2.5 py-1 rounded-md">
                    ⚡ {issue.priority}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}