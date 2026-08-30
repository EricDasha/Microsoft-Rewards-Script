# Web UI wrapper

该目录是官方 Docker 镜像之外的薄包装层，不修改 `src/`、登录逻辑、搜索逻辑或积分任务。

## 构建

```bash
docker build -t microsoft-rewards-script:official .
docker build -f web-ui/Dockerfile -t microsoft-rewards-script:gui .
docker compose -f compose.gui.yaml up -d
```

GUI 写入官方 `accounts.json`、启动或停止官方 `run_daily.sh`，并每 3 秒刷新官方日志。

## 自动调度

GUI 内置调度器（不修改官方 cron / `run_daily.sh` / 主脚本），可在页面上配置：

- **默认关闭**，需在「自动调度」区手动开启。
- 两种互斥模式二选一：
  - **固定时间**：每天 `HH:mm` 执行一次（如 `07:00`）。
  - **间隔执行**：每隔 N 分钟 / 小时 / 天执行一次。
- 配置持久化到 `config/schedule.json`（容器重启不丢）。
- 到点触发与「立即运行」同一入口（`run_daily.sh`），复用其锁与随机延迟；若任务已在进行，本轮自动跳过。
- 顶部 Schedule 指标实时显示当前调度与下次运行时刻。

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
