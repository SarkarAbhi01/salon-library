import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api',
  timeout: 15000,
});

api.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(r => r, error => {
  const url: string = error.config?.url || '';
  const isLogin = url.includes('/login') || url.includes('/register');
  if (error.response?.status === 401 && !isLogin) {
    const student = JSON.parse(localStorage.getItem('user') || '{}').role === 'STUDENT';
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    const target = student ? '/student/login' : '/login';
    if (window.location.pathname !== target) window.location.assign(target);
  }
  return Promise.reject(error);
});
