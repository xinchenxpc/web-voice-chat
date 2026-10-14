import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router";
import { useToast } from "./components/ToastContext";
import request from "./lib/request";
import "./login.css";

function Login() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [playerName, setPlayerName] = useState("");
  const [bindcode, setBindcode] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const wrapperRef = useRef(null);

  const [playerList, setPlayerList] = useState([]);

  const [countdown, setCountdown] = useState(0);
  const [sending, setSending] = useState(false);

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

  const filterPlayers = (input) => {
    if (!input.trim()) return [];
    const lower = input.toLowerCase();
    return playerList
      .filter((name) => name.toLowerCase().includes(lower))
      .slice(0, 10);
  };

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

  const handleSendCode = async () => {
    if (!playerName.trim()) {
      showToast("请先输入玩家名称", "warning");
      return;
    }
    if (countdown > 0) return;

    setSending(true);
    try {
      const res = await request.post("/api/auth/captcha", { name: playerName });

      // 还没接短信/邮件网关，开发环境后端会把验证码直接返回，这里顺手填上，
      // 省得每次都去翻服务器日志。生产环境后端不会返回 devCode。
      if (res?.devCode) {
        setBindcode(res.devCode);
        showToast(`开发模式验证码：${res.devCode}`, "success");
      } else {
        showToast("验证码已发送至您的绑定方式", "success");
      }

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
    } finally {
      setSending(false);
    }
  };

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
      navigate("/home");
    } catch (error) {
      showToast("登录失败", "error");
      console.error("登录失败", error);
    }
  };

  return (
    <>
      <title>Login</title>
      <div className="container">
        <h2>登入</h2>
        <div>
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

          <button id="loginBtn" onClick={handleLogin}>
            登入
          </button>
        </div>
      </div>
    </>
  );
}

export default Login;