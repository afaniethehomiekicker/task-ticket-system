import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { ShieldAlert, KeyRound } from 'lucide-react';

// Dedicated Super Admin portal — a genuinely separate entry point from
// the regular Login component, not a reskinned version of it. "Username"
// here is the account's email under the hood (labeled Username per the
// stakeholder's literal request), and this hits a different backend
// endpoint (/api/auth/admin-login) that rejects any account that isn't
// super_admin — with the SAME generic error a wrong password would give,
// so this portal never reveals who holds that role to anyone probing it.
export const AdminLogin = () => {
  const { setCurrentUserId, setAuthToken, allUsers } = useApp();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Same reasoning as login.jsx's resolveLocalUserId — match the
  // backend's returned user against the frontend's already-loaded
  // allUsers by email, rather than trusting a bare id.
  const resolveLocalUserId = (backendUser) => {
    const email = (backendUser.email || '').toLowerCase().trim();
    const match = (allUsers || []).find(u => (u.email || '').toLowerCase().trim() === email);
    return match ? match.id : backendUser.id;
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');

    const cleanUsername = username.trim().toLowerCase();
    if (!cleanUsername || !password) {
      setError('Please enter both a username and password.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/admin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The backend field is still "email" — "Username" is a frontend
        // label only, per the stakeholder's request, not a separate
        // schema field.
        body: JSON.stringify({ email: cleanUsername, password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.user) {
        setError(data.error || 'Invalid username or password.');
        return;
      }

      setAuthToken(data.token);
      setCurrentUserId(resolveLocalUserId(data.user));

      // Land back on the main app after a successful admin login, rather
      // than staying on /admin-login — a full navigation (not just SPA
      // state) so the URL bar and app state can't disagree with each
      // other, and so a bookmark of /admin-login always re-shows this
      // portal rather than whatever the SPA happened to be showing last.
      window.location.href = '/';
    } catch (err) {
      setError('Could not reach the server. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-4">
      <div className="max-w-md w-full bg-zinc-900 border border-purple-900/50 rounded-2xl p-8 shadow-xl shadow-purple-950/20">
        <div className="text-center mb-6">
          <div className="inline-flex p-3 bg-purple-600/20 text-purple-400 rounded-xl mb-3">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-white">Super Admin Portal</h2>
          <p className="text-xs text-zinc-400 mt-1">
            Restricted access. Super Admin credentials only.
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-lg">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Username
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-500">
                <ShieldAlert className="w-4 h-4" />
              </span>
              <input
                type="text"
                required
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username"
                className="w-full pl-9 pr-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-xs text-white focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Password</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-500">
                <KeyRound className="w-4 h-4" />
              </span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-9 pr-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-xs text-white focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-lg text-xs transition"
          >
            {isSubmitting ? 'Verifying...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
};
