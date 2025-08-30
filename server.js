const express = require('express');
const https = require('https');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { on } = require('events');
const { setInterval } = require('timers');

const DEBUG = false;

const configPath = path.join(__dirname, 'config.json');
const certPath = path.join(__dirname, 'pem/cert.pem');
const keyPath = path.join(__dirname, 'pem/key.pem');
const turnServerPath = path.join(__dirname, 'turn_server/server.exe');

// 读取配置文件
const configFile = JSON.parse(fs.readFileSync(configPath, 'utf8'));

let child = null;
if (configFile.enableDefaultICEServer) {
    child = exec(`${turnServerPath} -public-ip 127.0.0.1 -port ${configFile.defaultICEServer.port} -users ${configFile.defaultICEServer.username}=${configFile.defaultICEServer.credential},foo=bar`, (error, _stdout, _stderr) => {
        if (error) {
            console.error(`执行命令时出错: ${error.message}`);
            return;
        }
    });
    infoLog('已启动默认TURN服务器');
}

const credentials = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
};

const app = express();
const server = https.createServer(credentials, app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static(path.join(__dirname, 'public')));

// 添加TURN配置接口
app.get('/turn-config', (req, res) => {
    let turnConfig = {};
    if (configFile.enableDefaultICEServer) {
        turnConfig = {
            iceServers: [
                {
                    urls: `stun:localhost:${configFile.defaultICEServer.port}`
                },
                {
                    urls: `turn:localhost:${configFile.defaultICEServer.port}`,
                    username: configFile.defaultICEServer.username,
                    credential: configFile.defaultICEServer.credential
                }
            ]
        };
    } else {
        configFile.iceServers.forEach(server => {
            if (server.type === "stun") {
                turnConfig.iceServers.push({
                    urls: `stun:${server.urls}:${server.port}`
                });
            }
            if (server.type === "turn") {
                turnConfig.iceServers.push({
                    urls: `turn:${server.urls}:${server.port}`,
                    username: server.username,
                    credential: server.credential
                });
            }
        });
    }
    res.json(turnConfig);
});

const rooms = {};

let playerCode = {};
let onlinePlayer = [];
let playerPosition = {};

if (DEBUG) {
    playerCode = {
        a: "a",
        b: "b"
    };

    onlinePlayer = [
        {
            realName: "a",
            blockPos: {
                x: 0,
                y: 0,
                z: 0,
                dimid: 0
            }
        },
        {
            realName: "b",
            blockPos: {
                x: 0,
                y: 0,
                z: 0,
                dimid: 0
            }
        }
    ];
}

try {
    mc.listen("onJoin", player => {
        let code = randomNumber().toString();
        playerCode[code] = player.realName;
        onlinePlayer.push(player);
        player.tell("服务器已启用语音聊天，你的绑定码是：" + code);
    });

    mc.listen("onLeft", player => {
        Object.keys(playerCode).forEach(key => {
            if (playerCode[key] === player.realName) {
                delete playerCode[key];
            }
        });
        onlinePlayer = onlinePlayer.filter(obj => obj.realName !== player.realName);
    });

    if (configFile.enableSoundAttenuation) {
        setInterval(() => {
            onlinePlayer.forEach(player => {
                playerPosition[player.realName] = player.blockPos;
            }, 1000);
        });
    }

    ll.onUnload(() => {
        exec(`taskkill /pid ${child.pid} /T /F`);
    })

} catch (error) {
    console.error('Failed to use LSE API:', error);
}

io.on('connection', (socket) => {
    debugLog(`New client connected: ${socket.id}`);

    // 处理绑定码验证请求
    socket.on('validate-bindcode', (bindcode, callback) => {
        debugLog(`Received bindcode validation request: ${bindcode}`);

        if (playerCode[bindcode]) {
            debugLog(`Bindcode validated successfully: ${bindcode}`);
            // 验证成功，返回成功响应
            callback({ success: true, name: playerCode[bindcode] });
        } else {
            debugLog(`Bindcode validation failed: ${bindcode}`);
            // 验证失败，返回失败响应
            callback({ success: false, name: "" });
        }
    });

    // 加入房间
    socket.on('join-room', (roomId, userId) => {
        socket.join(roomId);
        socket.roomId = roomId;
        socket.userId = userId;

        if (!rooms[roomId]) {
            rooms[roomId] = new Set();
        }

        rooms[roomId].add(userId);

        // 通知房间内其他用户
        socket.to(roomId).emit('user-connected', userId);

        // 广播给房间内所有用户（包括新用户）
        const users = Array.from(rooms[roomId]);
        io.to(roomId).emit('room-users', users);

        //音量处理
        if (configFile.enableSoundAttenuation) {
            setInterval(() => {
                let playerVolume = {};
                onlinePlayer.forEach(player => {
                    // log(playerPosition);
                    const userPosition = playerPosition[userId];
                    const otherPosition = playerPosition[player.realName];
                    if (userPosition.dimid === otherPosition.dimid) {
                        let volume = 1 - configFile.soundAttenuationFactor * lineardistance(userPosition.x, userPosition.y, userPosition.z, otherPosition.x, otherPosition.y, otherPosition.z);
                        if (volume < 0) {
                            volume = 0;
                        }
                        playerVolume[player.realName] = volume;
                    }
                    else {
                        playerVolume[player.realName] = 0;
                    }
                });
                debugLog('正在发送 player-volume 事件，数据:', playerVolume);
                socket.emit('player-volume', playerVolume);
            }, 1000);
        }
        debugLog(`User ${userId} joined room ${roomId}`);
    });

    // 转发WebRTC信令
    socket.on('signal', (data) => {
        const { to, type, signal } = data;
        debugLog(`Forwarding signal from ${socket.userId} to ${to} [type: ${type}]`);

        // 检查目标用户是否在同一个房间
        const targetSocket = Array.from(io.sockets.sockets.values())
            .find(s => s.userId === to && s.roomId === socket.roomId);

        if (targetSocket) {
            targetSocket.emit('signal', {
                from: socket.userId,
                type: type,
                signal: signal
            });
        } else {
            debugLog(`Target user ${to} not found in room ${socket.roomId}`);
        }
    });

    // 断开连接
    socket.on("disconnecting", (reason) => {
        disconnect(socket);
        debugLog(`Client disconnected: ${socket.id}, reason: ${reason}`);
    });
});

function disconnect(socket) {
    if (socket.roomId && socket.userId) {
        const roomId = socket.roomId;
        const userId = socket.userId;

        // 从房间中移除用户
        if (rooms[roomId]) {
            rooms[roomId].delete(userId);

            // 如果房间为空，删除房间
            if (rooms[roomId].size === 0) {
                delete rooms[roomId];
            }
        }

        // 广播更新后的用户列表
        if (rooms[roomId]) {
            const users = Array.from(rooms[roomId]);
            io.to(roomId).emit('room-users', users);
        }

        socket.to(roomId).emit('user-disconnected', userId);
        debugLog(`User ${userId} left room ${roomId}`);
    }
}

function randomNumber() {
    // 生成1000到9999之间的随机数
    return Math.floor(Math.random() * 9000) + 1000;
}

// 计算两点之间的距离
function lineardistance(x1, y1, z1, x2, y2, z2) {
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2 + (z2 - z1) ** 2);
}

function debugLog(...args) {
    if (DEBUG) {
        console.log('[DEBUG]', ...args);
    }
}

function infoLog(...args) {
    try {
        log(...args);
    } catch {
        console.log(...args);
    }
}

server.listen(configFile.webPort, () => {
    infoLog(`Server running on port ${configFile.webPort}`);
    configFile.enableDefaultICEServer ?
        infoLog(`TURN server running on port ${configFile.defaultICEServer.port}`) :
        infoLog(`Default TURN server disabled`);
});