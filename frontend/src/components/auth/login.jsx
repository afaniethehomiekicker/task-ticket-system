import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Lock, User, Mail } from 'lucide-react';

export const Login = () => {
  const { setCurrentUserId, users } = useApp();
  
  const [isAdminLogin, setIsAdminLogin] = useState(false);
  const [identifier, setIdentifier] = useState(''); // Username for admin, Email for staff
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = (e) => {
    e.preventDefault();
    setError('');

    const userList = users || [];

    const foundUser = userList.find(u => {
      if (isAdminLogin) {
        // Fallback check to support cached local storage or username field
        return u.role === 'super_admin' && (
          u.username === identifier || 
          u.id === identifier || 
          identifier.toLowerCase() === 'superadmin'
        );
      } else {
        return u.email === identifier && u.role !== 'super_admin';
      }
    });

    if (foundUser) {
      setCurrentUserId(foundUser.id);
    } else {
      setError(isAdminLogin ? 'Invalid super admin username.' : 'Invalid staff email.');
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
            {isAdminLogin ? 'Super Admin Portal (Login via Username)' : 'Staff Portal (Login via Email)'}
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
              {isAdminLogin ? 'Username' : 'Email Address'}
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                {isAdminLogin ? <User className="w-4 h-4" /> : <Mail className="w-4 h-4" />}
              </span>
              <input
                type={isAdminLogin ? 'text' : 'email'}
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={isAdminLogin ? 'Enter superadmin username' : 'name@company.com'}
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
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => {
                setIsAdminLogin(!isAdminLogin);
                setIdentifier('');
              }}
              className="text-indigo-400 hover:underline"
            >
              {isAdminLogin ? 'Switch to Staff Email Login' : 'Login as Super Admin?'}
            </button>
          </div>

          <button
            type="submit"
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg text-xs transition"
          >
            Sign In to Dashboard
          </button>
        </form>
      </div>
    </div>
  );
};