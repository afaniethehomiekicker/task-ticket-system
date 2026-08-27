import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import API from '../services/api';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await API.post('/api/auth/login', { email, password });
      localStorage.setItem('token', res.data.token);
      navigate('/dashboard');
    } catch (err) {
      setError('Invalid email or password.');
    }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8f9fa', fontFamily: 'Open Sans, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      
      <div style={{ backgroundColor: '#ffffff', borderRadius: '24px', padding: '40px', width: '100%', maxWidth: '420px', boxShadow: '0 20px 27px 0 rgba(0, 0, 0, 0.05)' }}>
        
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#2d3748', margin: '0 0 8px 0' }}>Welcome Back</h2>
          <p style={{ fontSize: '13px', color: '#67748e', margin: 0 }}>Enter your credentials to sign in</p>
        </div>

        {error && <div style={{ color: '#e53e3e', fontSize: '13px', marginBottom: '16px', backgroundColor: '#fff5f5', padding: '10px', borderRadius: '8px', textAlign: 'center' }}>{error}</div>}

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <label style={{ fontSize: '11px', fontWeight: '700', color: '#67748e', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>Email</label>
            <input 
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="name@example.com"
              style={{ width: '100%', padding: '12px 16px', border: '1px solid #e2e8f0', borderRadius: '12px', fontSize: '14px', outline: 'none', boxSizing: 'border-box', backgroundColor: '#f8f9fa', color: '#2d3748' }}
            />
          </div>

          <div>
            <label style={{ fontSize: '11px', fontWeight: '700', color: '#67748e', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>Password</label>
            <input 
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              style={{ width: '100%', padding: '12px 16px', border: '1px solid #e2e8f0', borderRadius: '12px', fontSize: '14px', outline: 'none', boxSizing: 'border-box', backgroundColor: '#f8f9fa', color: '#2d3748' }}
            />
          </div>

          <button 
            type="submit"
            style={{ backgroundColor: '#cb0c9f', color: '#fff', border: 'none', padding: '12px', borderRadius: '12px', fontWeight: '600', fontSize: '14px', cursor: 'pointer', boxShadow: '0 4px 7px -1px rgba(203, 12, 159, 0.4)', width: '100%', marginTop: '10px' }}
          >
            Sign In
          </button>
        </form>

        <p style={{ textAlign: 'center', fontSize: '13px', color: '#67748e', marginTop: '24px', marginBotto: 0 }}>
          Don't have an account? <Link to="/signup" style={{ color: '#cb0c9f', fontWeight: '600', textDecoration: 'none' }}>Sign up</Link>
        </p>

      </div>
    </div>
  );
}