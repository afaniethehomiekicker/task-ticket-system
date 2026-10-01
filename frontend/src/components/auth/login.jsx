import React, { useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { CaptchaWidget } from './CaptchaWidget';
import { Lock, Mail, Eye, EyeOff } from 'lucide-react';

// The single login page for every role. The old separate Super Admin portal
// (/admin-login) now shows this same page — see Adminlogin.jsx.
export const Login = () => {
  const { setCurrentUserId, setAuthToken } = useApp();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Security check (see CaptchaWidget). When the server has captcha turned
  // off, the widget reports 'off' and login works without a token.
  const captchaRef = useRef(null);
  const [captchaToken, setCaptchaToken] = useState(null);
  const [captchaStatus, setCaptchaStatus] = useState('loading');
  const captchaRequired = captchaStatus !== 'off';

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      setError('Please enter both your email and password.');
      return;
    }

    if (captchaRequired && !captchaToken) {
      setError('Please complete the security check.');
      return;
    }

    setIsSubmitting(true);
    let loggedIn = false;
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(captchaToken ? { 'X-Captcha-Token': captchaToken } : {}),
        },
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
      //
      // data.user.id ?? data.user.ID — both casings checked deliberately.
      // Go's gorm.Model has no explicit json tag on its ID field, so the
      // raw backend response key is "ID" (capital), not "id". Reading
      // data.user.id alone silently returned undefined here, which then
      // flowed into setCurrentUserId — whose own null/undefined guard
      // calls setAuthToken(null), deleting the token this function had
      // just stored one line above, before anything downstream (like the
      // redirect on AdminLogin's equivalent flow) even ran. Every other
      // consumer of backend user data already handles this via
      // normalizeUser's raw.id ?? raw.ID; this was the one place still
      // reading the raw response directly instead.
      loggedIn = true;
      setAuthToken(data.token);
      setCurrentUserId(data.user.id ?? data.user.ID);
    } catch (err) {
      setError('Could not reach the server. Please try again.');
    } finally {
      // A captcha token works only once, so every failed attempt needs a
      // fresh check before the next try.
      if (!loggedIn) captchaRef.current?.reset();
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
          <h2 className="text-xl font-bold text-white">Sign In</h2>
          <p className="text-xs text-slate-400 mt-1">
            Sign in with your email and password
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
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-9 pr-9 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <CaptchaWidget
            ref={captchaRef}
            onToken={setCaptchaToken}
            onStatus={setCaptchaStatus}
            theme="dark"
          />

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