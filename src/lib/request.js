// src/api/request.js
import axios from 'axios';

const request = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8080',
  timeout: 10000,
  withCredentials: true, // 允许跨域请求携带 Cookie
});


// 响应拦截器（统一处理错误）
request.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      // token 过期或无效，跳转登录页
      // 可在此处清空本地用户状态（若有）
      //window.location.href = '/';
    }
    return Promise.reject(error);
  }
);

export default request;