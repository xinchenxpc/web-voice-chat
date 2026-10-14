# web-voice-chat

语音通话前端：React 19 + Vite + mediasoup-client，通过 WebSocket 与
[`../voice-chat-server`](../voice-chat-server) 交换信令。

---

## 快速开始

先把后端跑起来（见 [后端 README](../voice-chat-server/README.md)），然后：

```bash
cd web-voice-chat
npm install
npm run dev          # http://localhost:5173
```

打开两个浏览器窗口（或用另一台设备访问 `http://<你的局域网IP>:5173`），
用不同的玩家名登录，就能互相通话。

> 用局域网 IP 访问时后端要设 `COOKIE_SECURE=false`，否则浏览器不会保存登录 Cookie。

### 环境变量

| 文件 | 变量 | 说明 |
| --- | --- | --- |
| `.env.development` | `VITE_API_URL` | 后端地址，默认 `http://localhost:3000` |
| `.env.production` | `VITE_API_URL` | 上线时改成真实域名（HTTPS 下信令会自动用 `wss://`） |

信令地址由 `VITE_API_URL` 推导：`http(s)://host` → `ws(s)://host/api/signaling/ws`。

---

## 目录结构

```
src/
  App.jsx                     路由：/ 登录页，/home 通话页
  login.jsx                   玩家名 + 验证码登录
  home.jsx                    通话界面：在线名单、静音按钮、远端音频播放
  lib/
    request.js                axios 实例（带 Cookie）
    WebSocketSignalAdapter.js 信令通道：重连、请求-响应配对、推送分发
    MediasoupClient.js        语音会话：发布/订阅、名单、静音
    useMediasoup.js           把会话接进 React 的 hook
  home.css / login.css
```

---

## 三层职责

```
home.jsx                 只关心「显示什么、点了之后调什么」
  └─ useMediasoup.js     只关心「React 状态与生命周期的同步」
       ├─ MediasoupClient.js        只关心「音频怎么发、怎么收」
       └─ WebSocketSignalAdapter.js 只关心「消息怎么可靠地送达并配对」
```

---

## 之前修掉的问题

**1. 一直卡在「正在连接」——`getRouterRtpCapabilities` 收不到回包。**
根因在后端：`socket.on('message')` 是在 `await roomManager.getOrCreateRoom()`
之后才注册的，而 `@fastify/websocket` 不会缓冲这段时间到达的消息，
客户端连上后立刻发出的第一条请求就被丢掉了。现在后端同步注册监听器。

**2. 切换麦克风没反应。**
两个原因：
- 上一条导致会话根本没建起来；
- 后端缓存了 `transportId:kind -> producerId`，客户端重新发布时拿到的是
  已经失效的旧 id。

现在后端不再缓存，前端也改成用 `pause`/`resume` 切换静音——Producer id 保持不变，
别人的订阅关系不用重建，也不会重新弹一次权限框。

**3. 在线名单里全是 `null`。**
`newProducer` 推送里没有 `participantId`/`participantName`，前端拿到的是
`undefined`，于是所有远端用户挤在同一个 key 上。现在推送里带上了这两个字段。

**4. 后进房的人听不到已经在房间里的人。**
早期只在「有人新发布」时才广播，新加入者不会去订阅已有的 Producer。
现在进房后会主动拉一次 `getProducers` 补齐订阅，`welcome` 推送里也带着名单。

**5. 退出/刷新后服务端残留资源。**
原来 `leave()` 不关 WebSocket，StrictMode 下还会多开一条「幽灵连接」。
现在信令连接的生命周期由 `useMediasoup` 管理，卸载时一定会关闭。

**6. 任何一步出错都会永远挂住。**
原来的 `request()` 没有超时、也没有 reject 路径。现在每条请求都有超时、
连接断开时会立刻失败并带上可读的错误码。

**7. 断开后无法恢复。**
现在信令断开会自动重连（指数退避），重连成功后自动重建 Transport 并重新发布麦克风。

---

## 行为说明

- **进房即自动开麦**：`/home` 挂载后自动加入房间并请求麦克风权限。
  用户拒绝授权时仍然会留在房间里听别人说话，页面顶部给出提示。
- **远端音频自动播放**：如果被浏览器的自动播放策略拦下，页面会提示点一下页面。
- **重连**：网络抖动导致信令断开时会自动重连并重建媒体通道；
  如果重连后仍拿不到媒体，会提示后重试。

---

## 脚本

```bash
npm run dev      # 开发服务器
npm run build    # 生产构建
npm run lint     # oxlint
npm run preview  # 预览构建产物
```

## 测试

信令通道（`WebSocketSignalAdapter`）有不需要浏览器的测试，直接复用本目录的源码、
跑在真实后端上：见 [`../voice-chat-server/scripts/adapter-test.mjs`](../voice-chat-server/scripts/adapter-test.mjs)，
用 `npm run test:adapter` 执行。

覆盖：构造后立刻发请求不丢包、并发请求不串号、服务端错误带 code 返回、
超时与 `close()` 都会让在途请求失败、断线自动重连并派发 `reopen`、连不上时快速失败。

浏览器里的 `getUserMedia` / ICE / DTLS 这一层没法用脚本覆盖，需要真的开两个窗口验证。
