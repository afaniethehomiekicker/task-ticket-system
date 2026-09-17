import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Lock, Mail } from 'lucide-react';

export const Login = () => {
  const { setCurrentUserId, setAuthToken, allUsers } = useApp();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Resolves the backend's returned user (email + role) against the
  // frontend's already-loaded allUsers list, the same way every other
  // part of the app matches a backend record to a local one — by email,
  // not by trusting a bare id the backend happens to send back. Falls
  // back to the raw backend id only if no local match exists yet (e.g.
  // fetchInitialData hasn't merged this particular user in yet).
  const resolveLocalUserId = (backendUser) => {
    const email = (backendUser.email || '').toLowerCase().trim();
    const match = (allUsers || []).find(u => (u.email || '').toLowerCase().trim() === email);
    return match ? match.id : backendUser.id;
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      setError('Please enter both your email and password.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, password }),
      });

      const data = await res.json().catch(() => ({}));

      // The backend is the ONLY source of truth on whether these
      // credentials are valid. A non-2xx response — 401 for wrong/empty
      // password, 400 for a malformed request, anything else — means
      // login failed, full stop. There is no local fallback check: the
      // previous version of this component looked a user up by email
      // alone and never verified the password against anything, which is
      // exactly the vulnerability this rewrite closes.
      if (!res.ok || !data.user) {
        setError(data.error || 'Invalid email or password.');
        return;
      }

      // Store the token BEFORE switching currentUserId, so that if any
      // effect reacts to currentUserId changing and immediately makes an
      // authenticated request, the token is already in place.
      setAuthToken(data.token);
      setCurrentUserId(resolveLocalUserId(data.user));
    } catch (err) {
      setError('Could not reach the server. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 px-4">
      <div className="max-w-md w-full bg-slate-800 border border-slate-700 rounded-2xl p-8 shadow-xl">
        <div className="text-center mb-6">
          <div className="inline-flex p-3 bg-indigo-600/20 text-indigo-400 rounded-xl mb-3">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-white">Ticket System Login</h2>
          <p className="text-xs text-slate-400 mt-1">
            Staff Portal (Login via Email)
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-lg">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Email Address
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Mail className="w-4 h-4" />
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Password</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Lock className="w-4 h-4" />
              </span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Navigates to the dedicated Super Admin portal (/admin-login)
              — a real page navigation, not SPA state, since that portal
              is a genuinely separate entry point with its own backend
              gate (see AdminLogin in auth.go). */}
          <button
            type="button"
            onClick={() => { window.location.href = '/admin-login'; }}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition cursor-pointer"
          >
            Login as Super Admin?
          </button>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-lg text-xs transition"
          >
            {isSubmitting ? 'Signing in...' : 'Sign In to Dashboard'}
          </button>
        </form>
      </div>
    </div>
  );
};
