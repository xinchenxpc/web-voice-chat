import { useCallback, useEffect, useRef, useState } from 'react';
import { MediasoupClient } from './MediasoupClient';
import { WebSocketSignalAdapter } from './WebSocketSignalAdapter';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function toSignalingUrl(httpBase) {
  return `${httpBase.replace(/^http/, 'ws')}/api/signaling/ws`;
}

/**
 * 把语音会话接进 React。
 *
 * 这个 hook 自己持有信令连接的生命周期，而不是让组件用 useRef 手工创建，
 * 原因有两个：
 *   - StrictMode 下组件会渲染两次，写在外面的连接会泄漏出一条僵尸连接；
 *   - 卸载时才能真正把 WebSocket 关掉，否则服务端会一直留着一个「幽灵用户」。
 *
 * @param {{ roomId?: string, autoJoin?: boolean }} options
 */
export function useMediasoup({ roomId = 'main', autoJoin = true } = {}) {
  const sessionRef = useRef(null);
  /** 每次 join 自增；异步回调用它判断自己是不是已经过期的那个会话 */
  const generationRef = useRef(0);

  const [status, setStatus] = useState('idle'); // idle | connecting | connected | reconnecting | error
  const [error, setError] = useState(null);
  const [micError, setMicError] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [micEnabled, setMicEnabled] = useState(false);
  const [connectionState, setConnectionState] = useState('new');

  const closeSession = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    try { session.client.leave(); } catch {}
    try { session.signaling.close(); } catch {}
  }, []);

  const leave = useCallback(() => {
    generationRef.current += 1; // 让所有在途回调失效
    closeSession();
    setStatus('idle');
    setParticipants([]);
    setMicEnabled(false);
    setConnectionState('new');
  }, [closeSession]);

  const join = useCallback(async () => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;

    closeSession();

    setStatus('connecting');
    setError(null);
    setMicError(null);

    const signaling = new WebSocketSignalAdapter(toSignalingUrl(API_BASE));
    const client = new MediasoupClient({ signaling, roomId });
    sessionRef.current = { generation, signaling, client };

    const isCurrent = () => generationRef.current === generation;

    client.on('change', () => {
      if (!isCurrent()) return;
      setParticipants(client.getParticipants());
      setMicEnabled(client.micEnabled);
    });

    client.on('error', ({ error: clientError }) => {
      if (!isCurrent()) return;
      setError(clientError);
    });

    client.on('connectionstatechange', (state) => {
      if (!isCurrent()) return;
      setConnectionState(state);
    });

    // 信令断线重连成功：服务端的 Transport 已经没了，整体重建一遍
    signaling.on('reopen', async () => {
      if (!isCurrent()) return;
      setStatus('reconnecting');
      try {
        await client.rejoin();
        if (!isCurrent()) return;
        await client.publishMic().catch((micErr) => {
          if (isCurrent()) setMicError(micErr);
        });
        if (!isCurrent()) return;
        setParticipants(client.getParticipants());
        setMicEnabled(client.micEnabled);
        setStatus('connected');
      } catch (rejoinError) {
        if (!isCurrent()) return;
        console.error('[mediasoup] 重连后重新入房失败', rejoinError);
        setError(rejoinError);
        setStatus('error');
      }
    });

    try {
      await client.join();
      if (!isCurrent()) return;

      setParticipants(client.getParticipants());
      setStatus('connected');

      // 进房成功后自动开麦。开不了也不影响听别人说话，
      // 所以失败只记在 micError 上，不把整个会话判为失败。
      try {
        await client.publishMic();
        if (!isCurrent()) return;
        setMicEnabled(client.micEnabled);
      } catch (micErr) {
        if (!isCurrent()) return;
        console.warn('[mediasoup] 打开麦克风失败', micErr);
        setMicError(micErr);
      }
    } catch (joinError) {
      if (!isCurrent()) return;
      console.error('[mediasoup] 加入房间失败', joinError);
      setError(joinError);
      setStatus('error');
    }
  }, [closeSession, roomId]);

  const toggleMic = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    try {
      const next = await session.client.toggleMic();
      setMicEnabled(next);
      setMicError(null);
    } catch (micErr) {
      console.error('[mediasoup] 切换麦克风失败', micErr);
      setMicError(micErr);
    }
  }, []);

  const getStream = useCallback((participantId) => {
    return sessionRef.current?.client.getStream(participantId) || null;
  }, []);

  useEffect(() => {
    if (!autoJoin) return undefined;
    join();
    return () => leave();
    // join / leave 都是稳定引用；只在 roomId 变化时重新入房
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, autoJoin]);

  return {
    status,
    error,
    micError,
    connectionState,
    participants,
    micEnabled,
    join,
    leave,
    toggleMic,
    getStream,
  };
}

export default useMediasoup;
