## 现有问题
1. 切换麦克风状态没反应，初步推断是[MediasoupClient.js](./src//lib/MediasoupClient.js)中`const rtpCapabilitiesMsg = await this.request('getRouterRtpCapabilities', 'routerRtpCapabilities')`无法返回，具体原因未知