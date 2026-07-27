// src/api/request.js
import axios from 'axios';

const request = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8080',
  timeout: 10000,
});

// 请求拦截器（自动携带 token）
request.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截器（统一处理错误）
request.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      // token 过期，跳转登录页
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default request;