// useMediasoup.js
import { useEffect, useRef, useState, useCallback } from 'react';
import { MediasoupClient } from './MediasoupClient';

export function useMediasoup({ signaling, roomId }) {
  const clientRef = useRef(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteParticipants, setRemoteParticipants] = useState([]);

  const join = useCallback(async () => {
    const client = new MediasoupClient({ signaling, roomId });
    clientRef.current = client;

    client.onRemoteTrack((track, participantId) => {
      setRemoteParticipants((prev) => {
        const existing = prev.find(p => p.id === participantId);
        if (existing) {
          return [...prev];
        }
        const stream = new MediaStream([track]);
        return [...prev, { id: participantId, stream }];
      });
    });

    client.onRemoteTrackEnded((participantId) => {
      setRemoteParticipants(prev => prev.filter(p => p.id !== participantId));
    });

    await client.join();

    // 自动打开摄麦克风
    //await client.publishCamera();
    await client.publishMic();
    // 构建本地流对象
    const stream = new MediaStream();
    client.producers.forEach(producer => stream.addTrack(producer.track));
    setLocalStream(stream);
  }, [signaling, roomId]);

  const leave = useCallback(() => {
    clientRef.current?.leave();
    clientRef.current = null;
    setLocalStream(null);
    setRemoteParticipants([]);
  }, []);

  const toggleMic = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    const hasAudio = client.producers.has('audio');
    if (hasAudio) {
      client.unpublish('audio');
    } else {
      await client.publishMic();
    }
  }, []);

  const toggleCamera = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    const hasVideo = client.producers.has('video');
    if (hasVideo) {
      client.unpublish('video');
    } else {
      await client.publishCamera();
    }
  }, []);

  const shareScreen = useCallback(async () => {
    await clientRef.current?.publishScreenShare();
  }, []);

  // 组件卸载时离开房间
  useEffect(() => {
    return () => {
      clientRef.current?.leave();
    };
  }, []);

  return {
    localStream,
    remoteParticipants,
    join,
    leave,
    toggleMic,
    toggleCamera,
    shareScreen,
  };
}