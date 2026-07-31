// WebSocketSignalAdapter.js
export class WebSocketSignalAdapter {
    constructor(url) {
      this.url = url;
      this.ws = null;
      this.listeners = new Map(); // event -> Set<function>
      this.isConnected = false;
      this.pendingMessages = [];
      this.connect();
    }
  
    // 建立连接
    connect() {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => {
        this.isConnected = true;
        // 发送积压消息
        while (this.pendingMessages.length > 0) {
          this.ws.send(this.pendingMessages.shift());
        }
        this.dispatch('open');
      };
  
      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          // 根据消息中的 method 字段分发事件
          if (message.type) {
            this.dispatch(message.type, message);
          } else {
            this.dispatch('message', message);
          }
        } catch (e) {
          console.error('Invalid message format', e);
        }
      };
  
      this.ws.onclose = () => {
        this.isConnected = false;
        this.dispatch('close');
        // 可选自动重连（稍后实现）
      };
  
      this.ws.onerror = (err) => {
        this.dispatch('error', err);
      };
    }
  
    // 分发事件给所有注册的监听器
    dispatch(event, data) {
      const eventListeners = this.listeners.get(event);
      if (eventListeners) {
        eventListeners.forEach(cb => cb(data));
      }
    }
  
    // 注册监听
    on(event, listener) {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, new Set());
      }
      this.listeners.get(event).add(listener);
    }
  
    // 移除监听
    off(event, listener) {
      const eventListeners = this.listeners.get(event);
      if (eventListeners) {
        eventListeners.delete(listener);
      }
    }
  
    // 发送消息（JSON 格式）
    send(message) {
      const data = JSON.stringify(message);
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(data);
      } else {
        // 如果未连接，加入待发送队列
        this.pendingMessages.push(data);
      }
    }
  
    // 手动关闭
    close() {
      this.ws.close();
    }
  }