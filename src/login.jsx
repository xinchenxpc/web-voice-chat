import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router";
import { useToast } from "./components/ToastContext";
import request from "./request";
import "./login.css";

function Login() {
  const navigate = useNavigate(); // 获取导航函数
  const { showToast } = useToast();

  // ---------- 状态 ----------
  const [playerName, setPlayerName] = useState("");
  const [bindcode, setBindcode] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const wrapperRef = useRef(null);

  // 玩家列表（用于下拉建议）
  const [playerList, setPlayerList] = useState([]);

  // 验证码冷却
  const [countdown, setCountdown] = useState(0);
  const [sending, setSending] = useState(false);

  // ---------- 获取玩家列表 ----------
  useEffect(() => {
    const fetchPlayerList = async () => {
      try {
        const res = await request.get("/api/public/list");
        setPlayerList(res.list || []);
      } catch (error) {
        console.error("获取玩家列表失败", error);
      }
    };
    fetchPlayerList();
  }, []);

  // ---------- 过滤匹配的玩家名称 ----------
  const filterPlayers = (input) => {
    if (!input.trim()) return [];
    const lower = input.toLowerCase();
    return playerList
      .filter((name) => name.toLowerCase().includes(lower))
      .slice(0, 10);
  };

  // ---------- 输入框事件 ----------
  const handleInputChange = (e) => {
    const value = e.target.value;
    setPlayerName(value);
    const matched = filterPlayers(value);
    setSuggestions(matched);
    setShowDropdown(matched.length > 0);
  };

  const handleSelectSuggestion = (name) => {
    setPlayerName(name);
    setSuggestions([]);
    setShowDropdown(false);
  };

  // 点击外部关闭下拉
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // ---------- 发送验证码 ----------
  const handleSendCode = async () => {
    if (!playerName.trim()) {
      showToast("请先输入玩家名称", "warning");
      return;
    }
    if (countdown > 0) return; // 冷却中

    setSending(true);
    try {
      await request.post("/api/auth/captcha", { name: playerName });
      //showToast("验证码已发送至您的绑定方式");

      // 启动 60 秒倒计时
      setCountdown(60);
      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (error) {
      console.error("发送验证码失败", error);
      // 错误已在拦截器中提示，这里无需重复 showToast
    } finally {
      setSending(false);
    }
  };

  // ---------- 登录 ----------
  const handleLogin = async () => {
    if (!playerName.trim()) {
      showToast("请输入玩家名称", "warning");
      return;
    }
    if (!bindcode.trim()) {
      showToast("请输入验证码", "warning");
      return;
    }

    try {
      const data = await request.post("/api/auth/login", {
        name: playerName,
        captcha: bindcode,
      });
      
      localStorage.setItem("name", data.name || playerName);
      showToast("登录成功！", "success");
      // 跳转到首页或其他页面
      navigate("/home");
    } catch (error) {
      showToast("登录失败", "error");
      console.error("登录失败", error);
      // 错误已在拦截器中处理
    }
  };

  // ---------- 渲染 ----------
  return (
    <>
      <title>Login</title>
      <div className="container">
        <h2>登入</h2>
        <div>
          {/* 玩家名称输入框 + 下拉菜单 */}
          <div className="input-wrapper" ref={wrapperRef}>
            <input
              id="playerName"
              type="text"
              placeholder="玩家名称"
              value={playerName}
              onChange={handleInputChange}
              onFocus={() => {
                const matched = filterPlayers(playerName);
                if (matched.length > 0) {
                  setSuggestions(matched);
                  setShowDropdown(true);
                }
              }}
            />
            {showDropdown && (
              <ul className="suggestions-list">
                {suggestions.map((name) => (
                  <li
                    key={name}
                    onClick={() => handleSelectSuggestion(name)}
                    className="suggestion-item"
                  >
                    {name}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 验证码输入 + 发送按钮 */}
          <div className="code">
            <input
              id="bindcode"
              placeholder="验证码"
              value={bindcode}
              onChange={(e) => setBindcode(e.target.value)}
            />
            <button
              id="sendBtn"
              onClick={handleSendCode}
              disabled={countdown > 0 || sending}
            >
              {countdown > 0 ? `${countdown}s 后重试` : "发送验证码"}
            </button>
          </div>

          {/* 登录按钮 */}
          <button id="loginBtn" onClick={handleLogin}>
            登入
          </button>
        </div>
      </div>
    </>
  );
}

export default Login;