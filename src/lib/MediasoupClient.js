// MediasoupClient.js
import * as mediasoupClient from 'mediasoup-client';

export class MediasoupClient {
  constructor({ signaling, roomId }) {
    this.signaling = signaling;
    this.roomId = roomId;
    this.device = null;
    this.sendTransport = null;
    this.recvTransport = null;
    this.producers = new Map();              // kind -> Producer
    this.consumers = new Map();              // consumerId -> Consumer
    this.remoteParticipantStreams = new Map(); // participantId -> MediaStream
    this.producerParticipantMap = new Map();   // producerId -> participantId

    // 事件回调
    this._onRemoteTrack = null;
    this._onRemoteTrackEnded = null;
    this._onConnectionStateChange = null;

    // 绑定 this
    this.onNewProducer = this.onNewProducer.bind(this);
    this.onProducerClosed = this.onProducerClosed.bind(this);
  }

  // ----- 公开事件绑定 -----
  onRemoteTrack(handler) { this._onRemoteTrack = handler; }
  onRemoteTrackEnded(handler) { this._onRemoteTrackEnded = handler; }
  onConnectionStateChange(handler) { this._onConnectionStateChange = handler; }

  // ----- 核心生命周期 -----
  async join() {
    // 1. 获取 Router RTP 能力
    const rtpCapabilitiesMsg = await this.request('getRouterRtpCapabilities', 'routerRtpCapabilities');
    this.device = new mediasoupClient.Device();
    await this.device.load({ routerRtpCapabilities: rtpCapabilitiesMsg.data });

    // 2. 创建发送和接收 Transport
    this.sendTransport = await this.createTransport(true);
    this.recvTransport = await this.createTransport(false);

    // 3. 监听服务器推送
    this.signaling.on('newProducer', this.onNewProducer);
    this.signaling.on('producerClosed', this.onProducerClosed);
  }

  leave() {
    this.producers.forEach(p => p.close());
    this.producers.clear();
    this.consumers.forEach(c => c.close());
    this.consumers.clear();
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.signaling.off('newProducer', this.onNewProducer);
    this.signaling.off('producerClosed', this.onProducerClosed);
    this.remoteParticipantStreams.clear();
    this.producerParticipantMap.clear();
  }

  // ----- 发布本地流 -----
  async publishCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    return this.publishTrack(stream.getVideoTracks()[0], 'video');
  }

  async publishMic() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return this.publishTrack(stream.getAudioTracks()[0], 'audio');
  }

  async publishScreenShare() {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    return this.publishTrack(stream.getVideoTracks()[0], 'screen');
  }

  unpublish(kind) {
    const producer = this.producers.get(kind);
    if (producer) {
      producer.close();
      this.producers.delete(kind);
    }
  }

  // ----- 内部：请求-响应（适配新格式） -----
  request(method, callbackType, data = {}) {
    return new Promise((resolve, reject) => {
      this.signaling.send({ method, data });
      const handler = (message) => {
        if (message.type === callbackType) {
          this.signaling.off(callbackType, handler);
          resolve(message);
        }
      };
      this.signaling.on(callbackType, handler);
    });
  }

  async createTransport(isSend) {
    const method = isSend ? 'createProducerTransport' : 'createConsumerTransport';
    const callbackType = isSend ? 'producerTransportCreated' : 'consumerTransportCreated';
    const paramsMsg = await this.request(method, callbackType);
    const params = paramsMsg.data;

    const transport = isSend
      ? this.device.createSendTransport(params)
      : this.device.createRecvTransport(params);

    transport.on('connect', ({ dtlsParameters }, callback) => {
      // 等待服务器确认 transport 已连接
      this.request('connectTransport', 'transportConnected', {
        transportId: transport.id,
        dtlsParameters,
      }).then(() => callback());
    });

    if (isSend) {
      transport.on('produce', async ({ kind, rtpParameters }, callback) => {
        const response = await this.request('produce', 'produced', {
          transportId: transport.id,
          kind,
          rtpParameters,
        });
        callback({ id: response.id }); // { type: 'produced', id: xxx }
      });
    }

    transport.on('icestatechange', (state) => {
      this._onConnectionStateChange?.(state);
    });

    return transport;
  }

  async publishTrack(track, kind) {
    if (!this.sendTransport) throw new Error('Not joined');
    this.unpublish(kind);
    const producer = await this.sendTransport.produce({ track });
    this.producers.set(kind, producer);
    producer.on('transportclose', () => {
      this.producers.delete(kind);
    });
    return producer;
  }

  // ----- 远端生产者事件处理 -----
  onNewProducer = async (data) => {
    const { producerId, participantId, kind } = data; // 需要服务端广播时附带 participantId
    if (!this.device || !this.recvTransport) return;

    // 记录映射
    this.producerParticipantMap.set(producerId, participantId);

    const response = await this.request('consume', 'consumed', {
      transportId: this.recvTransport.id,
      producerId,
      rtpCapabilities: this.device.rtpCapabilities,
    });
    const consumerParams = response.data;

    const consumer = await this.recvTransport.consume(consumerParams);
    this.consumers.set(consumer.id, consumer);

    let stream = this.remoteParticipantStreams.get(participantId);
    if (!stream) {
      stream = new MediaStream();
      this.remoteParticipantStreams.set(participantId, stream);
    }
    stream.addTrack(consumer.track);
    this._onRemoteTrack?.(consumer.track, participantId);

    consumer.on('trackended', () => {
      stream?.removeTrack(consumer.track);
      this._onRemoteTrackEnded?.(participantId);
    });
  };

  onProducerClosed = (data) => {
    const { producerId } = data;
    const participantId = this.producerParticipantMap.get(producerId);
    if (!participantId) return;

    for (const [consumerId, consumer] of this.consumers) {
      if (consumer.producerId === producerId) {
        consumer.close();
        this.consumers.delete(consumerId);
        const stream = this.remoteParticipantStreams.get(participantId);
        if (stream) {
          stream.removeTrack(consumer.track);
          this._onRemoteTrackEnded?.(participantId);
        }
      }
    }
    this.producerParticipantMap.delete(producerId);
  };
}