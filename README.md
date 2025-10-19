# WebVoiceChat

## 介绍
使用网页进行语音聊天的BDS插件，通过后端调用LSE的API实现了声音随距离的增加而衰减，无需客户端安装任何addon或软件，上手简单，包含了配置文件调整关键功能。

## 警告
由于该插件需要在服务器开放额外的端口，因此多数面板服无法使用该插件

## 安装
1. 将压缩包中的文件解压至服务器的plugins文件夹调整配置文件
2. 开放您服务器的端口以使网页可以被其他人访问，您需要根据您配置的内容开放ICE服务器的端口以及网页服务器端口
3. 启动服务器

## 使用
1. 访问您的域名，**注意，您应该使用`https://xxx.xxx:3000`的方式访问网站，其中*xxx.xxx*是您服务器的IP或域名，*3000*应替换为您设置的端口**
2. 进入服务器，在网站上输入自动分配的绑定绑定码

## 配置
默认的配置文件应该是这样的：
```json
{
    "iceServers": [
        {
            "type": "stun",
            "urls": "localhost",
            "port": 3478
        },
        {
            "type": "turn",
            "urls": "localhost",
            "port": 3478,
            "username": "self",
            "credential": "self"
        }
    ],
    "enableDefaultICEServer": true,
    "defaultICEServer": {
        "port": 3478,
        "username": "self",
        "credential": "self"
    },
    "webPort": 3000,
    "enableSoundAttenuation": true,
    "soundAttenuationFactor": 0.02
}
```
接下来将对每个配置项进行解释

### **iceServers**​
**ICE服务器配置**​

内容为STUN服务器的域名与端口，和TURN服务器的域名，端口，用户名，密码。如果你想要添加ICE服务器，需要按照原配置格式添加。当`type`为`stun`时只需要`url`和`port`，`type`为`turn`时需要再添加`sername`和`credential`项。该配置用于需要远程ICE服务器的情况下。如果`urls`的值为`localhost`将自动使用本地服务器的IP​

### **enableDefaultICEServer​**
**启用默认ICE服务器​**

为`ture`时将使用默认ICE服务器配置，此时`iceServers`的内容将不会被使用，而是使用`defaultICEServer`中的内容​

### **defaultICEServer​**
**默认ICE服务器配置​**

默认服务器是集成在插件中的，应此它在本地工作。`port`为默认ICE服务器的端口，该端口需要能被外网访问。`username`与`credential`为网站在使用TURN服务器时的用户名与密码​

### **webPort​**
**网站所在端口​**

访问聊天网站时要使用该端口，因此，该端口需要能被外网访问​

### **enableSoundAttenuation​**
**启用声音衰减​**

为`ture`时，`soundAttenuationFactor`将会生效，聊天中的声音大小将会随玩家间的距离越来越远而减小​

### **soundAttenuationFactor​**
**声音的音量衰减系数​**

设声音的大小默认为1，将满足关系：`1 - 玩家直线距离（格） * 衰减系数`。当玩家之间距离足够大或不在同一个维度时，声音将无法传递​

## 计划
- [ ] 实现立体声音
- [ ] 保持玩家绑定状态，无需总是输入绑定码
- [ ] 添加更多配置项

## 参考图片
![01.png](https://img.remit.ee/api/file/BQACAgUAAyEGAASHRsPbAALqnmiy0xLEmIfzVffr1pFkgIujyAO5AAI4FwACnJuYVS1KeoN8nuL_NgQ.png)
![02.png](https://img.remit.ee/api/file/BQACAgUAAyEGAASHRsPbAALqn2iy0yIf3jGz_0aAQqTGReU-zOreAAI5FwACnJuYVeeIPmH1pBFaNgQ.png)

## 已知问题
- 在手机上使用via浏览器访问时，网站可能无法正常工作，原因不明

## 更多
- **SSL证书**：您可能已经注意到，在访问聊天网站时，会提示SSL证书问题。在插件的`pem`目录下，有`cert.pem`（证书）和`key.pem`（私钥）文件，您可以替换其中的内容以解决该问题
- **server.exe**：您可以在插件的`turn_server`目录下找到此程序，该程序是插件默认ICE服务器的软件，由[Pion TURN的示例程序代码](https://github.com/pion/turn/tree/master/examples/turn-server/simple)直接编译而来