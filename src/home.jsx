import { useNavigate } from "react-router";
import { useRef, useEffect, useState, useMemo } from 'react';
import request from "./lib/request";
import { WebSocketSignalAdapter } from "./lib/WebSocketSignalAdapter";
import { useMediasoup } from './lib/useMediasoup';
import "./home.css";

function Home() {
    const navigate = useNavigate();

    // 1. 信令适配器（单例）
    const signalingRef = useRef(null);
    if (!signalingRef.current) {
        const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
        const wsUrl = baseUrl.replace(/^http/, 'ws') + '/api/signaling/ws';
        signalingRef.current = new WebSocketSignalAdapter(wsUrl);
    }

    const {
        localStream,
        remoteParticipants,
        join,
        leave,
        toggleMic,
        toggleCamera,
        shareScreen,
    } = useMediasoup({ signaling: signalingRef.current, roomId: 'main' });

    // 2. 本地麦克风状态（默认为开启，因为 join 时自动 publishMic）
    const [micEnabled, setMicEnabled] = useState(true);

    // 加入房间（组件挂载时），卸载时离开
    useEffect(() => {
        join();
        return () => leave();
    }, []);

    // 3. 获取当前用户信息（已有逻辑保持不变）
    useEffect(() => {
        const getMe = () => {
            request.get("/api/users/me")
                .then(res => {
                    console.log(res.username);
                })
                .catch(err => {
                    console.log(err);
                    navigate("/");
                });
        };
        getMe();
    }, []);

    // 4. 退出登录（同时离开房间）
    const handleLogout = async () => {
        try {
            await request.post("/api/auth/logout");
        } catch (err) {
            console.log(err);
        } finally {
            leave(); // 手动离开房间
            navigate("/");
        }
    };

    // 5. 麦克风切换
    const handleMicToggle = async () => {
        try {
            await toggleMic();        // 内部会根据当前状态 publish/unpublish
            setMicEnabled(prev => !prev); // 翻转 UI 状态
        } catch (e) {
            console.error("麦克风切换失败", e);
        }
    };

    // 6. 在线人数（包括自己）
    const onlineCount = remoteParticipants.length + 1;

    return (
        <>
            <title>Home</title>
            <div className="home-container">
                <div className="home-card">
                    {/* 头部 */}
                    <div className="home-header">
                        <h2>语音聊天</h2>
                        <div className="header-actions">
                            {/* 麦克风按钮，样式根据是否开启变化 */}
                            <button
                                className={`btn-mic ${micEnabled ? '' : 'muted'}`}
                                onClick={handleMicToggle}
                            >
                                <svg width="20" height="20" aria-hidden="true">
                                    <use href={micEnabled ? "/mic.svg#icon" : "/mic-off.svg#icon"} />
                                </svg>
                                <span>{micEnabled ? '麦克风' : '已静音'}</span>
                            </button>
                            <button className="btn-logout" onClick={handleLogout}>
                                <svg width="20" height="20" aria-hidden="true">
                                    <use href="/logout.svg#icon" />
                                </svg>
                                <span>退出</span>
                            </button>
                        </div>
                    </div>

                    {/* 在线列表 */}
                    <div className="online-list">
                        <div className="list-header">
                            <span>在线玩家</span>
                            <span className="online-count">{onlineCount} 人</span>
                        </div>
                        <ul className="player-list">
                            {/* 自己（本地）始终在第一位 */}
                            <li className="player-item local">
                                <span className="player-name">我</span>
                                <span className="mic-status">
                                    <svg width="16" height="16" aria-hidden="true">
                                        <use href={micEnabled ? "/mic.svg#icon" : "/mic-off.svg#icon"} />
                                    </svg>
                                </span>
                            </li>

                            {/* 远程参与者 */}
                            {remoteParticipants.length === 0 ? (
                                <li className="empty-message">暂无其他玩家在线</li>
                            ) : (
                                remoteParticipants.map(p => (
                                    <li key={p.id} className="player-item">
                                        <span className="player-name">{p.id}</span>
                                        {/* 远程音频自动播放 */}
                                        <audio ref={el => { if (el) el.srcObject = p.stream; }} autoPlay />
                                    </li>
                                ))
                            )}
                        </ul>
                    </div>
                </div>
            </div>
        </>
    );
}

export default Home;