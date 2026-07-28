// Home.jsx
import { useNavigate } from "react-router";
import request from "./request";
import "./home.css";

function Home() {
    const navigate = useNavigate();

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

    // 退出登录
    const handleLogout = () => {
        request.post("/api/auth/logout")
        .then(res => {
            navigate("/");
        })
        .catch(err => {
            console.log(err);
        });
    };

    // 麦克风点击（示例）
    const handleMicToggle = () => {
        console.log("麦克风切换");
    };

    return (
        <>
            <title>Home</title>
            <div className="home-container">
                <div className="home-card">
                    {/* 头部：标题 + 按钮 */}
                    <div className="home-header">
                        <h2>语音聊天</h2>
                        <div className="header-actions">
                            <button className="btn-mic" onClick={handleMicToggle}>
                                <svg width="20" height="20" aria-hidden="true">
                                    <use href="/mic.svg#icon" />
                                </svg>
                                <span>麦克风</span>
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
                            <span className="online-count">0 人</span>
                        </div>
                        <ul className="player-list">
                            {/* 这里动态渲染玩家列表，目前留空 */}
                            <li className="empty-message">暂无玩家在线</li>
                        </ul>
                    </div>
                </div>
            </div>
        </>
    );
}

export default Home;