// Home.jsx
import { useNavigate } from "react-router";
import request from "./request";
import "./home.css";

function Home() {
    const navigate = useNavigate();

    const getMe = () => {
        request.get("/api/users/me")
        .then(res => {
            console.log(res.data);
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
                                {/* 麦克风 SVG 图标 */}
                                <svg
                                    width="20"
                                    height="20"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    xmlns="http://www.w3.org/2000/svg"
                                >
                                    <path
                                        d="M12 16C14.2091 16 16 14.2091 16 12V6C16 3.79086 14.2091 2 12 2C9.79086 2 8 3.79086 8 6V12C8 14.2091 9.79086 16 12 16Z"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                    <path
                                        d="M5 12C5 15.866 8.13401 19 12 19C15.866 19 19 15.866 19 12"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                    <path
                                        d="M12 19V22"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                                <span>麦克风</span>
                            </button>
                            <button className="btn-logout" onClick={handleLogout}>
                                {/* 退出 SVG 图标 */}
                                <svg
                                    width="20"
                                    height="20"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    xmlns="http://www.w3.org/2000/svg"
                                >
                                    <path
                                        d="M9 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H9"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                    <path
                                        d="M16 17L21 12L16 7"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                    <path
                                        d="M21 12H9"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
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