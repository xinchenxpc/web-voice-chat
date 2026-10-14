/**
 * WebSocketSignalAdapter —— 语音信令通道。
 *
 * 职责：
 *   1. 管理与后端的 WebSocket 连接（含断线自动重连）；
 *   2. 请求-响应配对：每条请求带唯一 id，服务端把 id 原样带回，
 *      超时或连接断开时 reject，**绝不会让调用方永远挂住**；
 *   3. 分发服务端的主动推送（welcome / newProducer / peerLeft ...）。
 *
 * 协议：
 *   客户端 → 服务端   { id, method, data }
 *   服务端 → 客户端   { id, type, data } | { id, type: 'error', error: { code, message } }
 *   服务端 → 客户端   { type, data }            // 主动推送，没有 id
 */
export class WebSocketSignalAdapter {
  constructor(url, options = {}) {
    this.url = url;
    this.requestTimeout = options.requestTimeout ?? 10000;
    this.autoReconnect = options.autoReconnect ?? true;
    this.minReconnectDelay = options.minReconnectDelay ?? 800;
    this.maxReconnectDelay = options.maxReconnectDelay ?? 8000;

    this.ws = null;
    this.isConnected = false;
    /** 用户主动 close() 之后不再重连 */
    this.closedByUser = false;

    this.listeners = new Map(); // event -> Set<handler>
    this.pending = new Map(); // id -> { resolve, reject, timer }
    this.seq = 0;

    this._reconnectAttempts = 0;
    this._reconnectTimer = null;
    /** 串行化 connect()，避免并发调用创建出多条连接 */
    this._connectPromise = null;
    /** 记录之前是否成功连接过，用于区分「首次连接」和「重连」 */
    this._everConnected = false;

    // 构造时就把连上。这里 catch 一下只是为了避免「没人 await 时的 unhandledrejection」，
    // 真正的错误仍然会通过 request()/whenOpen() 抛给调用方。
    this.connect().catch(() => {});
  }

  // ---------- 事件 ----------

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(handler);
    return this;
  }

  off(event, handler) {
    this.listeners.get(event)?.delete(handler);
    return this;
  }

  dispatch(event, payload) {
    const handlers = this.listeners.get(event);
    if (!handlers || handlers.size === 0) return;
    // 复制一份，避免回调里 off() 影响本次遍历
    for (const handler of [...handlers]) {
      try {
        handler(payload);
      } catch (error) {
        console.error(`[signaling] 处理 ${event} 事件时出错`, error);
      }
    }
  }

  // ---------- 连接管理 ----------

  connect() {
    if (this._connectPromise) return this._connectPromise;
    if (this.closedByUser) return Promise.reject(new Error('信令通道已关闭'));

    // 必须先建好 socket 再进 Promise：new WebSocket() 可能同步抛错，
    // 如果写在 executor 里，里面把 _connectPromise 置空会在外层赋值之后被覆盖掉。
    let socket;
    try {
      socket = new WebSocket(this.url);
    } catch (error) {
      return Promise.reject(error);
    }

    this.ws = socket;

    this._connectPromise = new Promise((resolve, reject) => {
      let settled = false;

      // 连接阶段的超时保护：地址写错 / 服务没起来时也要给出明确报错
      const openTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this._connectPromise = null;
        try { socket.close(); } catch {}
        reject(new Error('连接信令服务器超时'));
      }, this.requestTimeout);

      socket.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(openTimer);

        this.isConnected = true;
        this._reconnectAttempts = 0;
        this._connectPromise = null;

        const isReconnect = this._everConnected;
        this._everConnected = true;

        this.dispatch('open');
        if (isReconnect) this.dispatch('reopen');

        resolve();
      };

      socket.onmessage = (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch (error) {
          console.error('[signaling] 收到无法解析的消息', error, event.data);
          return;
        }

        if (message.id) {
          const entry = this.pending.get(message.id);
          if (!entry) return;
          this.pending.delete(message.id);
          clearTimeout(entry.timer);

          if (message.type === 'error') {
            const error = new Error(message.error?.message || '信令请求失败');
            error.code = message.error?.code;
            entry.reject(error);
          } else {
            entry.resolve(message.data);
          }
          return;
        }

        if (message.type) this.dispatch(message.type, message.data);
      };

      socket.onerror = () => {
        // 浏览器出于安全考虑不暴露细节，这里只保证连接阶段能及时失败
        if (settled) return;
        settled = true;
        clearTimeout(openTimer);
        this._connectPromise = null;
        reject(new Error('无法连接信令服务器，请确认后端已启动'));
      };

      socket.onclose = (event) => {
        this.isConnected = false;
        clearTimeout(openTimer);

        if (!settled) {
          settled = true;
          this._connectPromise = null;
          reject(new Error('信令连接被关闭'));
        }

        // 连接断了，所有在途请求必须立刻失败，否则调用方会一直等下去
        this._rejectAllPending(
          new Error(event?.code === 4001 ? '登录状态失效，请重新登录' : '信令连接已断开'),
        );

        this.dispatch('close', { code: event?.code, reason: event?.reason });

        if (!this.closedByUser) this._scheduleReconnect();
      };
    });

    return this._connectPromise;
  }

  _scheduleReconnect() {
    if (!this.autoReconnect || this.closedByUser || this._reconnectTimer) return;

    const delay = Math.min(
      this.minReconnectDelay * 2 ** this._reconnectAttempts,
      this.maxReconnectDelay,
    );
    this._reconnectAttempts += 1;

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (this.closedByUser) return;
      this.connect().catch((error) => {
        console.warn('[signaling] 重连失败，稍后继续重试：', error.message);
        this._scheduleReconnect();
      });
    }, delay);
  }

  /** 等连接就绪；未连接时先尝试连上 */
  async whenOpen() {
    if (this.isConnected) return;
    await this.connect();
  }

  /** 用户主动关闭：不再重连，并让所有在途请求失败 */
  close() {
    this.closedByUser = true;
    this.autoReconnect = false;

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    this._rejectAllPending(new Error('信令通道已关闭'));

    if (this.ws) {
      try {
        // 1000 = 正常关闭
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close(1000, 'client closed');
        }
      } catch {}
      this.ws = null;
    }
    this.isConnected = false;
  }

  _rejectAllPending(error) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  // ---------- 请求-响应 ----------

  /**
   * 发一条请求并等待配对响应。
   * @returns {Promise<any>} 响应里的 data
   */
  async request(method, data = {}, timeoutMs = this.requestTimeout) {
    await this.whenOpen();

    const id = `${Date.now().toString(36)}-${++this.seq}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error(`信令 ${method} 超时（${timeoutMs}ms 未收到响应）`);
        error.code = 'TIMEOUT';
        reject(error);
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      try {
        this.ws.send(JSON.stringify({ id, method, data }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
}

export default WebSocketSignalAdapter;
