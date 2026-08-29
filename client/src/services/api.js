import axios from 'axios';

const API = axios.create({
  baseURL: 'http://localhost:8080', // Adjust if your Go backend runs on a different port
  headers: {
    'Content-Type': 'application/json',
  },
});

// Automatically inject JWT token into requests if available
API.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}, (error) => {
  return Promise.reject(error);
});

export default API;