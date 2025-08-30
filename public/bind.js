const input = document.getElementById('bindcode');
const button = document.getElementById('bind');

// 初始化socket连接
const socket = io();

button.addEventListener('click', () => {
    const code = input.value;
    if (code) {
        localStorage.setItem('bindCode', code);
        window.location.href = 'chat.html';
    } else {
        alert("请输入绑定码");
    }
});