import * as mediasoupClient from 'mediasoup-client';

/**
 * 把一个房间里的语音会话封装成一个对象。
 *
 * 它只跟 WebSocketSignalAdapter 打交道，负责：
 *   - 用 Router 的 RTP 能力 load 设备、建好收发两条 Transport；
 *   - 发布本地麦克风（produce），订阅别人的音轨（consume）；
 *   - 维护「谁在线、谁在说话、谁静音了」这份名单；
 *   - 把每个人的音轨聚合成一个 MediaStream，方便 <audio> 直接播放。
 *
 * 事件（用 on(event, handler) 注册）：
 *   change                名单 / 音轨 / 静音状态有任何变化
 *   error                 { error } 非致命的运行时错误，供 UI 提示
 *   connectionstatechange 底层 Transport 的连接状态
 */
export class MediasoupClient {
  constructor({ signaling, roomId }) {
    this.signaling = signaling;
    this.roomId = roomId;

    this.device = null;
    this.sendTransport = null;
    this.recvTransport = null;
    this.joined = false;
    /** 正在进行的 join()，用于串行化 join/rejoin */
    this._joinPromise = null;

    /** 本地的生产者：kind -> Producer（当前只有 audio） */
    this.localProducers = new Map();
    /** 本地的麦克风音轨，静音时只是停用而不是关掉，避免再次弹权限框 */
    this.localStream = null;

    /** consumerId -> Consumer */
    this.consumers = new Map();
    /** producerId -> consumerId，避免重复订阅 */
    this.consumerByProducer = new Map();
    /** 收到 newProducer 时接收 Transport 还没建好，先存这里 */
    this.pendingConsume = new Set();
    /** 正在订阅中的 producerId，避免并发重复订阅 */
    this.consuming = new Set();

    /** participantId -> { id, name, producers: Map<producerId, {id, kind, paused}> } */
    this.participants = new Map();
    /** participantId -> MediaStream */
    this.streams = new Map();

    this.selfId = null;
    this.selfName = null;
    /** 连接状态，供 UI 显示 */
    this.connectionState = 'new';

    this.listeners = new Map();
    this._changeScheduled = false;

    // 服务端推送的处理函数要先绑定好，join() 之前可能就有 welcome 到达
    this._onWelcome = this._onWelcome.bind(this);
    this._onPeerJoined = this._onPeerJoined.bind(this);
    this._onPeerLeft = this._onPeerLeft.bind(this);
    this._onNewProducer = this._onNewProducer.bind(this);
    this._onProducerClosed = this._onProducerClosed.bind(this);
    this._onProducerPaused = this._onProducerPaused.bind(this);
    this._onProducerResumed = this._onProducerResumed.bind(this);

    this.signaling.on('welcome', this._onWelcome);
    this.signaling.on('peerJoined', this._onPeerJoined);
    this.signaling.on('peerLeft', this._onPeerLeft);
    this.signaling.on('newProducer', this._onNewProducer);
    this.signaling.on('producerClosed', this._onProducerClosed);
    this.signaling.on('producerPaused', this._onProducerPaused);
    this.signaling.on('producerResumed', this._onProducerResumed);
  }

  // ---------- 事件工具 ----------

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(handler);
    return this;
  }

  off(event, handler) {
    this.listeners.get(event)?.delete(handler);
    return this;
  }

  _emit(event, payload) {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const handler of [...handlers]) {
      try {
        handler(payload);
      } catch (error) {
        console.error(`[mediasoup] 处理 ${event} 事件时出错`, error);
      }
    }
  }

  /**
   * 状态变化统一走这里，并用微任务合并同一轮里的多次变更，
   * 避免一进房间就触发十几次 React 重渲染。
   */
  _emitChange() {
    if (this._changeScheduled) return;
    this._changeScheduled = true;
    queueMicrotask(() => {
      this._changeScheduled = false;
      this._emit('change');
    });
  }

  // ---------- 生命周期 ----------

  /**
   * 进入房间。
   *
   * 用 _joinPromise 串行化：重连（rejoin）如果撞上一次还没跑完的 join，
   * 会先把旧的 join 等结束再重建，否则会在 device 被置空之后继续用，
   * 直接抛 TypeError。
   */
  join() {
    if (this._joinPromise) return this._joinPromise;
    this._joinPromise = this._doJoin().finally(() => {
      this._joinPromise = null;
    });
    return this._joinPromise;
  }

  async _doJoin() {
    if (this.joined) return;

    try {
      // 1. 先拿名单：这样即使 welcome 推送在监听器注册前就到了也不会漏
      const roster = await this.signaling.request('getParticipants');
      this.selfId = roster.participantId;
      this.selfName = roster.name;
      for (const peer of roster.participants || []) {
        this.participants.set(peer.participantId, {
          id: peer.participantId,
          name: peer.name,
          producers: new Map(
            (peer.producers || []).map((p) => [p.producerId, { id: p.producerId, kind: p.kind, paused: p.paused }]),
          ),
        });
      }

      // 2. 加载设备
      const routerRtpCapabilities = await this.signaling.request('getRouterRtpCapabilities');
      this.device = new mediasoupClient.Device();
      await this.device.load({ routerRtpCapabilities });

      // 3. 建收发两条 Transport
      this.sendTransport = await this._createTransport('producer');
      this.recvTransport = await this._createTransport('consumer');

      this.joined = true;
      this._emitChange();

      // 4. 订阅房间里已经存在的音轨
      const { producers } = await this.signaling.request('getProducers');
      for (const producer of producers || []) {
        await this._onNewProducer(producer);
      }

      // 5. 处理在步骤 3 期间到达、被暂存的 newProducer
      const queued = [...this.pendingConsume];
      this.pendingConsume.clear();
      for (const producer of queued) {
        await this._consumeProducer(producer.producerId, producer.participantId).catch((error) => {
          console.warn('[mediasoup] 订阅暂存的音轨失败', error);
        });
      }
    } catch (error) {
      // 中途失败就回滚，避免留下半截 Transport
      this._teardownMedia();
      throw error;
    }
  }

  leave() {
    this.signaling.off('welcome', this._onWelcome);
    this.signaling.off('peerJoined', this._onPeerJoined);
    this.signaling.off('peerLeft', this._onPeerLeft);
    this.signaling.off('newProducer', this._onNewProducer);
    this.signaling.off('producerClosed', this._onProducerClosed);
    this.signaling.off('producerPaused', this._onProducerPaused);
    this.signaling.off('producerResumed', this._onProducerResumed);

    this._teardownMedia();
    this.connectionState = 'closed';
  }

  /**
   * 信令断线重连后调用：Transport / Device 都已经失效，但麦克风音轨还是好的，
   * 所以保留 localStream，只把服务端相关的东西全部重建。
   */
  async rejoin() {
    // 等上一次 join 收尾（成功或失败都行），再整体重建
    try {
      await this._joinPromise;
    } catch { /* 上一次 join 失败无所谓，下面会重新来一遍 */ }

    this._teardownMedia({ keepLocalStream: true });
    await this.join();
  }

  _teardownMedia({ keepLocalStream = false } = {}) {
    this.joined = false;

    // 先关本地麦克风，别再往外送声音
    for (const producer of this.localProducers.values()) {
      try { producer.close(); } catch { /* 已经关了 */ }
    }
    this.localProducers.clear();

    if (!keepLocalStream && this.localStream) {
      for (const track of this.localStream.getTracks()) track.stop();
      this.localStream = null;
    }

    for (const consumer of this.consumers.values()) {
      try { consumer.close(); } catch { /* 已经关了 */ }
    }
    this.consumers.clear();
    this.consumerByProducer.clear();
    this.pendingConsume.clear();
    this.consuming.clear();

    for (const stream of this.streams.values()) {
      for (const track of stream.getTracks()) track.stop();
    }
    this.streams.clear();
    this.participants.clear();

    try { this.sendTransport?.close(); } catch { /* 已经关了 */ }
    try { this.recvTransport?.close(); } catch { /* 已经关了 */ }
    this.sendTransport = null;
    this.recvTransport = null;
    this.device = null;
    this.selfId = null;
    this.connectionState = 'new';
  }

  async _createTransport(direction) {
    const isProducer = direction === 'producer';
    const params = await this.signaling.request(
      isProducer ? 'createProducerTransport' : 'createConsumerTransport',
    );

    const transport = isProducer
      ? this.device.createSendTransport(params)
      : this.device.createRecvTransport(params);

    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
      this.signaling
        .request('connectTransport', { transportId: transport.id, dtlsParameters })
        .then(() => callback())
        .catch(errback);
    });

    transport.on('connectionstatechange', (state) => {
      this.connectionState = state;
      this._emit('connectionstatechange', state);
      if (state === 'failed') {
        this._emit('error', { error: new Error('媒体连接失败，可能是网络或防火墙拦截了 UDP/TCP') });
      }
    });

    if (isProducer) {
      transport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
        this.signaling
          .request('produce', { transportId: transport.id, kind, rtpParameters, appData })
          .then(({ id }) => callback({ id }))
          .catch(errback);
      });
    }

    return transport;
  }

  // ---------- 本地麦克风 ----------

  /** 打开麦克风并发布；重复调用会复用已有的音轨 */
  async publishMic() {
    if (!this.joined) throw new Error('还没有加入房间');
    if (this.localProducers.has('audio')) return this.localProducers.get('audio');

    // 重连后会保留上一次的 MediaStream；如果音轨已经失效（设备被拔掉等），
    // 这里要重新申请一次，否则会发布一条不会再产生声音的轨道。
    const existingTrack = this.localStream?.getAudioTracks()[0];
    if (!existingTrack || existingTrack.readyState === 'ended') {
      if (this.localStream) {
        for (const track of this.localStream.getTracks()) track.stop();
      }
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    }

    const track = this.localStream.getAudioTracks()[0];
    if (!track) throw new Error('没有找到可用的麦克风设备');

    const producer = await this.sendTransport.produce({ track });

    producer.on('trackended', () => {
      this.localProducers.delete('audio');
      this._emit('error', { error: new Error('麦克风已被拔出或停止') });
      this._emitChange();
    });

    this.localProducers.set('audio', producer);
    this._emitChange();
    return producer;
  }

  get micEnabled() {
    const producer = this.localProducers.get('audio');
    if (!producer) return false;
    return !producer.paused && producer.track?.enabled !== false;
  }

  /**
   * 开/关麦克风。
   *
   * 用 pause/resume 而不是关掉再重建：Producer 的 id 保持不变，
   * 别人的订阅关系不用重建，也不会重新弹一次麦克风权限框。
   */
  async setMicEnabled(enabled) {
    let producer = this.localProducers.get('audio');

    if (enabled && !producer) {
      producer = await this.publishMic();
    }
    if (!producer) return false;

    if (enabled) {
      // 先打开音轨再通知服务端，避免出现「服务端已放行但本地还没声音」
      if (producer.track) producer.track.enabled = true;
      if (producer.paused) producer.resume();
      await this.signaling.request('resumeProducer', { producerId: producer.id });
    } else {
      // 先掐掉本地音轨再通知服务端，保证静音是立刻生效的
      if (producer.track) producer.track.enabled = false;
      if (!producer.paused) producer.pause();
      await this.signaling.request('pauseProducer', { producerId: producer.id });
    }

    this._emitChange();
    return enabled;
  }

  async toggleMic() {
    return this.setMicEnabled(!this.micEnabled);
  }

  // ---------- 远端音轨 ----------

  _getOrCreateStream(participantId) {
    let stream = this.streams.get(participantId);
    if (!stream) {
      stream = new MediaStream();
      this.streams.set(participantId, stream);
    }
    return stream;
  }

  async _consumeProducer(producerId, participantId) {
    if (!this.recvTransport) {
      this.pendingConsume.add({ producerId, participantId });
      return;
    }
    // 同一个 Producer 可能同时从 getProducers 和 newProducer 推送两条路进来，
    // 用 consuming 挡住并发，否则会对同一个 consumer id 调用两次 consume() 而报错。
    if (this.consumerByProducer.has(producerId) || this.consuming.has(producerId)) return;

    this.consuming.add(producerId);
    try {
      const params = await this.signaling.request('consume', {
        transportId: this.recvTransport.id,
        producerId,
        rtpCapabilities: this.device.rtpCapabilities,
      });

      const consumer = await this.recvTransport.consume({
        id: params.id,
        producerId: params.producerId,
        kind: params.kind,
        rtpParameters: params.rtpParameters,
      });

      this.consumers.set(consumer.id, consumer);
      this.consumerByProducer.set(producerId, consumer.id);

      const ownerId = params.participantId || participantId;
      const stream = this._getOrCreateStream(ownerId);
      stream.addTrack(consumer.track);

      consumer.on('trackended', () => {
        this._removeConsumer(consumer.id);
      });

      // 服务端是 paused 建的，这里告诉它可以开始推流了
      await this.signaling.request('resumeConsumer', { consumerId: consumer.id });
    } finally {
      this.consuming.delete(producerId);
    }

    this._emitChange();
  }

  _removeConsumer(consumerId) {
    const consumer = this.consumers.get(consumerId);
    if (!consumer) return;

    this.consumers.delete(consumerId);
    if (this.consumerByProducer.get(consumer.producerId) === consumerId) {
      this.consumerByProducer.delete(consumer.producerId);
    }

    for (const [participantId, stream] of this.streams) {
      if (stream.getTracks().includes(consumer.track)) {
        stream.removeTrack(consumer.track);
        if (stream.getTracks().length === 0) this.streams.delete(participantId);
        break;
      }
    }

    try { consumer.close(); } catch { /* 已经关了 */ }
    this._emitChange();
  }

  _addProducer(producerId, participantId, participantName, kind, paused) {
    if (!participantId) return null;

    let participant = this.participants.get(participantId);
    if (!participant) {
      participant = { id: participantId, name: participantName || '未知用户', producers: new Map() };
      this.participants.set(participantId, participant);
    } else if (participantName) {
      participant.name = participantName;
    }

    participant.producers.set(producerId, { id: producerId, kind, paused: Boolean(paused) });
    this._emitChange();
    return participant;
  }

  _removeProducerById(producerId) {
    const consumerId = this.consumerByProducer.get(producerId);
    if (consumerId) this._removeConsumer(consumerId);

    for (const participant of this.participants.values()) {
      if (participant.producers.delete(producerId)) {
        this._emitChange();
        return;
      }
    }
  }

  _setProducerPaused(producerId, paused) {
    for (const participant of this.participants.values()) {
      const producer = participant.producers.get(producerId);
      if (producer) {
        producer.paused = paused;
        this._emitChange();
        return;
      }
    }
  }

  // ---------- 服务端推送的处理 ----------

  _onWelcome(data) {
    this.selfId = data.participantId;
    this.selfName = data.name;
    for (const peer of data.participants || []) {
      if (this.participants.has(peer.participantId)) continue;
      this.participants.set(peer.participantId, {
        id: peer.participantId,
        name: peer.name,
        producers: new Map(
          (peer.producers || []).map((p) => [p.producerId, { id: p.producerId, kind: p.kind, paused: p.paused }]),
        ),
      });
    }
    this._emitChange();
  }

  _onPeerJoined(data) {
    if (!this.participants.has(data.participantId)) {
      this.participants.set(data.participantId, {
        id: data.participantId,
        name: data.name,
        producers: new Map(),
      });
    }
    this._emitChange();
  }

  _onPeerLeft(data) {
    const participant = this.participants.get(data.participantId);
    if (!participant) return;

    // 这个人名下的音轨可能还在，一并收掉
    for (const producerId of participant.producers.keys()) {
      const consumerId = this.consumerByProducer.get(producerId);
      if (consumerId) this._removeConsumer(consumerId);
    }
    this.participants.delete(data.participantId);

    const stream = this.streams.get(data.participantId);
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      this.streams.delete(data.participantId);
    }

    this._emitChange();
  }

  async _onNewProducer(data) {
    this._addProducer(data.producerId, data.participantId, data.participantName, data.kind, data.paused);
    try {
      await this._consumeProducer(data.producerId, data.participantId);
    } catch (error) {
      console.warn('[mediasoup] 订阅新音轨失败', error);
      this._emit('error', { error });
    }
  }

  _onProducerClosed(data) {
    // 这条推送可能来自广播，也可能来自 consumer 的 producerclose，做成幂等
    this._removeProducerById(data.producerId);
  }

  _onProducerPaused(data) {
    this._setProducerPaused(data.producerId, true);
  }

  _onProducerResumed(data) {
    this._setProducerPaused(data.producerId, false);
  }

  // ---------- 给 UI 用的只读接口 ----------

  /** 当前房间的人员名单快照（自己固定排在第一个） */
  getParticipants() {
    const others = [...this.participants.values()].map((participant) => ({
      id: participant.id,
      name: participant.name,
      isSelf: false,
      muted: participant.producers.size === 0
        || [...participant.producers.values()].every((producer) => producer.paused),
      producers: [...participant.producers.values()],
    }));

    if (!this.selfId) return others;

    const selfProducers = [...this.localProducers.values()].map((producer) => ({
      id: producer.id,
      kind: producer.kind,
      paused: producer.paused,
    }));

    return [
      {
        id: this.selfId,
        name: this.selfName || '我',
        isSelf: true,
        muted: selfProducers.length === 0 || selfProducers.every((producer) => producer.paused),
        producers: selfProducers,
      },
      ...others,
    ];
  }

  /** 某个人的音轨集合；没有就返回 null */
  getStream(participantId) {
    return this.streams.get(participantId) || null;
  }
}

export default MediasoupClient;
