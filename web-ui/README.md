# Web UI wrapper

该目录是官方 Docker 镜像之外的薄包装层，不修改 `src/`、登录逻辑、搜索逻辑或积分任务。

## 构建

```bash
docker build -t microsoft-rewards-script:official .
docker build -f web-ui/Dockerfile -t microsoft-rewards-script:gui .
docker compose -f compose.gui.yaml up -d
```

GUI 写入官方 `accounts.json`、启动或停止官方 `run_daily.sh`，并每 3 秒刷新官方日志。

本地校验：

```bash
node --check web-ui/server.js
node web-ui/test.js
```

## 数据

- `config/`：官方配置和账号文件
- `sessions/`：官方浏览器 Session
- `logs/`：官方运行日志

打开 `http://NAS_IP:39785/` 后直接使用，无需登录。
