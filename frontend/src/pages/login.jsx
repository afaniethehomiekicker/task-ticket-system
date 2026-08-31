import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const response = await api.post('/auth/login', { email, password });
      // Save your token or user session as needed
      localStorage.setItem('token', response.data.token);
      navigate('/projects'); // Redirect to your main app dashboard
    } catch (err) {
      setError('Invalid email or password');
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#F4F7FE', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ background: '#fff', padding: '40px', borderRadius: '20px', width: '100%', maxWidth: '400px', boxShadow: '0px 20px 40px rgba(112, 144, 176, 0.12)' }}>
        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <h2 style={{ color: '#2B3674', fontSize: '26px', fontWeight: 'bold', margin: '0 0 8px 0' }}>Welcome Back</h2>
          <p style={{ color: '#A3AED0', fontSize: '14px', margin: 0 }}>Enter your email and password to sign in</p>
        </div>

        {error && (
          <div style={{ background: '#FFEAEA', color: '#EE5D50', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '20px', textAlign: 'center', fontWeight: '500' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <label style={{ display: 'block', color: '#2B3674', fontSize: '13px', fontWeight: 'bold', marginBottom: '8px' }}>Email</label>
            <input 
              type="email5" 
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              placeholder="name@example.com"
              required 
              style={{ width: '100%', padding: '12px 16px', borderRadius: '10px', border: '1px solid #E0E5F2', background: '#fff', color: '#2B3674', boxSizing: 'border-box', outline: 'none', fontSize: '14px' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', color: '#2B3674', fontSize: '13px', fontWeight: 'bold', marginBottom: '8px' }}>Password</label>
            <input 
              type="password" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
              placeholder="At least 8 characters"
              required 
              style={{ width: '100%', padding: '12px 16px', borderRadius: '10px', border: '1px solid #E0E5F2', background: '#fff', color: '#2B3674', boxSizing: 'border-box', outline: 'none', fontSize: '14px' }}
            />
          </div>

          <button 
            type="submit" 
            style={{ width: '100%', padding: '14px', background: '#4318FF', color: '#fff', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px', marginTop: '10px', transition: 'background 0.2s' }}
          >
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
}