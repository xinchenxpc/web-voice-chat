import "./login.css"

function Login() {
    //const [count, setCount] = useState(0)

    return (
        <>
            <title>Login</title>
            <dev className="container">
                <h2>登入</h2>
                <dev>
                    <input id="playerName" placeholder="玩家名称"></input>
                    <dev className="code">
                        <input id="bindcode" placeholder="验证码"></input>
                        <button id="sendBtn">发送验证码</button>
                    </dev>
                    <button id="loginBtn">登入</button>
                </dev>
            </dev>
        </>
    )
}

export default Login