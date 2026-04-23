# backup-kindle

单容器版本的 Kindle 看板服务，容器内会同时启动：

- `Python / Flask` 数据接口：`3643`
- `Node / Puppeteer` 截图接口：`3000`
- `1145` 静态渲染页：给 Puppeteer 截图用，也可以直接浏览器打开调样式

## 快速启动

1. 准备环境变量

```bash
cp .env.example .env
```

2. 按需填写 `.env`

```dotenv
TIANAPI_KEY=你的天行 key
QWEATHER_KEY=你的和风天气 key
QWEATHER_LOCATION=你的 location id
SENSOR_INNER_MAC=A4:C1:38:CF:B0:D6
SENSOR_OUTER_MAC=A4:C1:38:D5:05:79
TZ=Asia/Shanghai
```

3. 启动

```bash
docker compose up -d --build
```

## 访问方式

- 截图接口：`http://127.0.0.1:3000/?batt=78&charge=Charging`
- 渲染页：`http://127.0.0.1:1145/?batt=78&charge=Charging`
- Python API 健康检查：`http://127.0.0.1:3643/healthz`

## 这次顺手优化的点

- 把原本独立的 `1145` 网页服务收进同一个 Node 进程，不再需要额外容器
- 前端接口地址改成运行时注入，不再写死 `127.0.0.1:3643`
- 截图等待逻辑从固定 `sleep 5s` 改成等待页面渲染完成信号，截图更稳
- 截图临时文件改成按请求唯一命名，避免并发覆盖
- Python 的 key、位置、传感器 MAC、端口都改成环境变量
- 修复了 `/warning` 和 `/lunar` 路由名覆盖全局数据对象的问题

## 目录说明

- [Dockerfile](/home/sydneyowl/Desktop/backup-kindle/Dockerfile)
- [docker-compose.yml](/home/sydneyowl/Desktop/backup-kindle/docker-compose.yml)
- [docker/start.sh](/home/sydneyowl/Desktop/backup-kindle/docker/start.sh)
- [index.js](/home/sydneyowl/Desktop/backup-kindle/index.js)
- [fetch.py](/home/sydneyowl/Desktop/backup-kindle/fetch.py)

## License

            DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE
                    Version 2, December 2004

 Copyright (C) 2004 Sam Hocevar <sam@hocevar.net>

 Everyone is permitted to copy and distribute verbatim or modified
 copies of this license document, and changing it is allowed as long
 as the name is changed.

            DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE
   TERMS AND CONDITIONS FOR COPYING, DISTRIBUTION AND MODIFICATION

  0. You just DO WHAT THE FUCK YOU WANT TO.

