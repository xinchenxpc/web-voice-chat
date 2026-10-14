import axios from 'axios';

// 默认端口与后端保持一致（见 .env.development 里的 VITE_API_URL）
const request = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000',
  timeout: 10000,
  withCredentials: true, // 跨域请求需要携带登录 Cookie
});

// 成功时直接返回 data；401 由调用方决定是否跳回登录页
request.interceptors.response.use(
  (response) => response.data,
  (error) => Promise.reject(error),
);

export default request;
