import { useNavigate } from "react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import request from "./lib/request";
import { useMediasoup } from "./lib/useMediasoup";
import "./home.css";

/** 把远端音轨挂到 <audio> 上；浏览器的自动播放策略可能会拦下来，拦下就提示用户 */
function RemoteAudio({ stream, onBlocked }) {
  const audioRef = useRef(null);

  // 只在 stream 这个对象本身变化时重绑。往已有的 MediaStream 里 addTrack
  // 浏览器会自动播出来，所以不需要跟着名单变化反复重设 srcObject——
  // 那样每有人进出房间都会把正在播放的音频打断一次。
  useEffect(() => {
    const element = audioRef.current;
    if (!element) return undefined;

    element.srcObject = stream || null;
    if (!stream) return undefined;

    const tryPlay = () => {
      element.play().catch(() => onBlocked?.());
    };

    tryPlay();
    // 音轨可能晚于元素创建，补一次播放
    stream.onaddtrack = tryPlay;

    return () => {
      stream.onaddtrack = null;
      element.srcObject = null;
    };
  }, [stream, onBlocked]);

  return <audio ref={audioRef} autoPlay playsInline />;
}

const STATUS_TEXT = {
  idle: "未连接",
  connecting: "正在连接语音服务器…",
  connected: "已连接",
  reconnecting: "网络中断，正在重连…",
  error: "连接失败",
};

function Home() {
  const navigate = useNavigate();

  const [me, setMe] = useState(() => localStorage.getItem("name") || "");
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  const {
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
  } = useMediasoup({ roomId: "main" });

  // 拿不到当前用户（含 401）就退回登录页
  useEffect(() => {
    request
      .get("/api/users/me")
      .then((res) => setMe(res.username || localStorage.getItem("name") || ""))
      .catch(() => navigate("/"));
  }, [navigate]);

  const handleLogout = useCallback(async () => {
    try {
      await request.post("/api/auth/logout");
    } catch (err) {
      console.warn("登出请求失败，仍然离开房间", err);
    } finally {
      leave();
      localStorage.removeItem("name");
      navigate("/");
    }
  }, [leave, navigate]);

  const handleMicToggle = useCallback(async () => {
    setAutoplayBlocked(false);
    await toggleMic();
  }, [toggleMic]);

  const handleAutoplayBlocked = useCallback(() => setAutoplayBlocked(true), []);

  const others = participants.filter((participant) => !participant.isSelf);
  const onlineCount = participants.length;
  const micButtonDisabled = status !== "connected";

  return (
    <>
      <title>语音聊天</title>
      <div className="home-container">
        <div className="home-card">
          <div className="home-header">
            <div className="home-title">
              <h2>语音聊天</h2>
              <span className={`status-badge status-${status}`}>
                {STATUS_TEXT[status] || status}
              </span>
            </div>
            <div className="header-actions">
              <button
                type="button"
                className={`btn-mic ${micEnabled ? "" : "muted"}`}
                onClick={handleMicToggle}
                disabled={micButtonDisabled}
                title={micEnabled ? "点击静音" : "点击取消静音"}
              >
                <svg width="20" height="20" aria-hidden="true">
                  <use href={micEnabled ? "/mic.svg#icon" : "/mic-off.svg#icon"} />
                </svg>
                <span>{micEnabled ? "麦克风" : "已静音"}</span>
              </button>
              <button type="button" className="btn-logout" onClick={handleLogout}>
                <svg width="20" height="20" aria-hidden="true">
                  <use href="/logout.svg#icon" />
                </svg>
                <span>退出</span>
              </button>
            </div>
          </div>

          {status === "error" && (
            <div className="alert alert-error">
              <span>加入语音房间失败：{error?.message || "未知错误"}</span>
              <button type="button" className="btn-retry" onClick={join}>
                重试
              </button>
            </div>
          )}

          {status !== "error" && connectionState === "failed" && (
            <div className="alert alert-error">
              媒体连接失败，请检查网络或防火墙是否放行了 UDP/TCP 40000-40100 端口。
            </div>
          )}

          {micError && (
            <div className="alert alert-warn">
              无法使用麦克风（{micError.name === "NotAllowedError" ? "你拒绝了麦克风权限" : micError.message}）。
              你仍然可以听到其他人的声音。
            </div>
          )}

          {autoplayBlocked && (
            <div className="alert alert-warn">
              浏览器拦截了自动播放，请点击页面任意位置后再试。
            </div>
          )}

          <div className="online-list">
            <div className="list-header">
              <span>在线玩家</span>
              <span className="online-count">{onlineCount} 人</span>
            </div>

            <ul className="player-list">
              {participants.length === 0 ? (
                <li className="empty-message">
                  {status === "connecting" ? "正在进入房间…" : "暂无玩家在线"}
                </li>
              ) : (
                participants.map((participant) => (
                  <li
                    key={participant.id}
                    className={`player-item${participant.isSelf ? " local" : ""}${participant.muted ? " muted" : ""
                      }`}
                  >
                    <span className="player-name">
                      {participant.isSelf ? `${participant.name}（我）` : participant.name}
                    </span>
                    <span className="mic-status" title={participant.muted ? "已静音" : "正在说话"}>
                      <svg width="16" height="16" aria-hidden="true">
                        <use href={participant.muted ? "/mic-off.svg#icon" : "/mic.svg#icon"} />
                      </svg>
                    </span>

                    {/* 远程音频：不进列表视觉，只负责播放 */}
                    {!participant.isSelf && (
                      <RemoteAudio
                        stream={getStream(participant.id)}
                        onBlocked={handleAutoplayBlocked}
                      />
                    )}
                  </li>
                ))
              )}
            </ul>
          </div>

          <p className="home-footer">
            {
              others.length === 0
                ? "把链接发给朋友，或者用另一台设备登录同一个房间就能互相说话了。"
                : others.length <= 3
                ? `正在与 ${others.map((p) => p.name).join("、")} 通话中`
                : `正在与另外 ${others.length} 位玩家通话中`
            }
            {me ? ` · 当前账号 ${me}` : ""}
          </p>
        </div>
      </div>
    </>
  );
}

export default Home;
