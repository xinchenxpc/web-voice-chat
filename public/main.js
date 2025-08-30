// 初始化变量
const socket = io();
let localStream;
let peerConnections = {};
let offered = false;
let bindCode = null;

// DOM元素
const playerList = document.getElementById('playerList');
const leaveBtn = document.getElementById('leaveBtn');
const muteBtn = document.getElementById('muteBtn');

// 配置信息将从服务器获取
let config = null;

const constraints = {
    video: false,
    audio: true,
};

// 状态变量
let isMuted = false; // 是否静音
const currentRoomId = "default";
let currentUserId = null;

// 页面加载
window.addEventListener('load', () => {
    // 获取绑定码
    bindCode = localStorage.getItem('bindCode');
    if (!bindCode) {
        // 如果没有绑定码，重定向到首页
        window.location.href = 'index.html';
        alert('请填写绑定码');
        return;
    }

    // 获取TURN配置
    fetch('/turn-config')
        .then(response => response.json())
        .then(turnConfig => {
            // 将turnConfig.iceServers中的localhost替换为document.domain
            if (turnConfig.iceServers) {
                turnConfig.iceServers.forEach((server, i) => {
                    if (server.urls) {
                        if (typeof server.urls === 'string') {
                            turnConfig.iceServers[i].urls = server.urls.replace(/localhost/g, document.domain);
                        } else if (Array.isArray(server.urls)) {
                            turnConfig.iceServers[i].urls = server.urls.map(url => url.replace(/localhost/g, document.domain));
                        }
                    }
                });
            }
            config = turnConfig;
            // 验证绑定码
            socket.emit('validate-bindcode', bindCode, (response) => {
                if (!response.success) {
                    // 验证失败，清除存储并重定向到首页
                    alert("您的绑定码无效，请重新输入！");
                    localStorage.removeItem('bindCode');
                    window.location.href = 'index.html';
                    return;
                }
                currentUserId = response.name;
                joinRoom();
            });
        })
        .catch(error => {
            console.error('获取TURN配置失败:', error);
            alert('无法获取连接配置，请刷新页面重试');
        });
});

// 页面关闭
window.addEventListener('beforeunload', () => {
    localStorage.removeItem('bindCode');
    socket.disconnect();
});

muteBtn.addEventListener('click', () => {
    isMuted = !isMuted;

    if (localStream) {
        // 获取音频轨道并设置启用状态
        localStream.getAudioTracks().forEach(track => {
            track.enabled = !isMuted;
        });
    }

    // 更新按钮文本和样式
    if (isMuted) {
        muteBtn.textContent = '取消静音';
        muteBtn.classList.add('muted');
    } else {
        muteBtn.textContent = '静音';
        muteBtn.classList.remove('muted');
    }
});

leaveBtn.addEventListener('click', () => {
    // 断开所有对等连接
    Object.keys(peerConnections).forEach(userId => {
        if (peerConnections[userId]) {
            peerConnections[userId].close();
            delete peerConnections[userId];
        }
    });

    // 停止本地媒体流
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    // 通知服务器用户断开连接
    socket.emit('user-disconnect');

    // 跳转回主页
    window.location.href = 'index.html';
});

async function joinRoom() {

    if (!navigator.mediaDevices.getUserMedia) {
        alert('Your browser does not support getUserMedia API');
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        localStream = stream;
    } catch (error) {
        errorHandler(error);
    }

    socket.emit('join-room', currentRoomId, currentUserId);
}

function errorHandler(error) {
    console.log(error);
}

function createPeerConnection(user) {
    const peerConnection = new RTCPeerConnection(config);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('signal', {
                to: user,
                type: 'candidate',
                signal: event.candidate

            });
        }
        console.log('ice candidate' + event.candidate);
    };

    peerConnection.ontrack = (event) => {
        console.log(`Received remote stream from ${user}`);
        const audioElement = document.getElementById(`audio-${user}`);
        if (!audioElement) {
            const audio = document.createElement('audio');
            audio.id = `audio-${user}`;
            audio.autoplay = true;
            audio.controls = false;
            audio.srcObject = event.streams[0];
            document.body.appendChild(audio);
        } else {
            audioElement.srcObject = event.streams[0];
        }
    };

    for (const track of localStream.getTracks()) {
        peerConnection.addTrack(track, localStream);
    }

    return peerConnection;
}

function sendOffer(user, peerConnection) {
    peerConnection.createOffer()
        .then(description => peerConnection.setLocalDescription(description))
        .then(() => {
            // 确保localDescription已经正确设置
            if (peerConnection.localDescription) {
                socket.emit('signal', {
                    to: user,
                    type: 'offer',
                    signal: peerConnection.localDescription
                });
            } else {
                console.error('Failed to create offer: localDescription is null');
            }
        })
        .catch(errorHandler);
}

function sendAnswer(user, peerConnection) {
    peerConnection.createAnswer()
        .then(description => peerConnection.setLocalDescription(description))
        .then(() => {
            // 确保localDescription已经正确设置
            if (peerConnection.localDescription) {
                socket.emit('signal', {
                    to: user,
                    type: 'answer',
                    signal: peerConnection.localDescription
                });
            } else {
                console.error('Failed to create answer: localDescription is null');
            }
        })
        .catch(errorHandler);
}

// event callbacks
socket.on('room-users', (users) => {

    // 更新玩家列表显示
    playerList.innerHTML = '';
    users.forEach(user => {
        const li = document.createElement('li');
        li.textContent = user === currentUserId ? `${user} (你)` : user;
        playerList.appendChild(li);
    });

    //当加入房间后有除自己以外的人时才进行操作  仅当自己加入时才对房间内的用户offer
    if (users.length > 1 && !offered) {
        users.forEach(user => {

            if (!peerConnections[user] && user !== currentUserId) {
                peerConnections[user] = createPeerConnection(user);
                sendOffer(user, peerConnections[user]);
                offered = true;
            }
        });
    }
    else {
        offered = true;
    }
});

socket.on('signal', data => {
    const { from, type, signal } = data;

    if (type === 'offer') {
        peerConnections[from] = createPeerConnection(from);
        peerConnections[from].setRemoteDescription(new RTCSessionDescription(signal));
        sendAnswer(from, peerConnections[from]);
    }
    else if (type === 'answer') {
        peerConnections[from].setRemoteDescription(new RTCSessionDescription(signal));
    }
    else if (type === 'candidate') {
        peerConnections[from].addIceCandidate(new RTCIceCandidate(signal));
    }
});

socket.on('player-volume', (data) => {
    for (const userId in data) {
        const volume = data[userId];
        const audioElement = document.getElementById(`audio-${userId}`);
        if (audioElement) {
            audioElement.volume = volume;
        }
    }
});

// 注册Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('SW registered: ', registration);
            })
            .catch(registrationError => {
                console.log('SW registration failed: ', registrationError);
            });
    });
}