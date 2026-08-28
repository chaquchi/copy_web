# PX4 / Gazebo 局域网实时日志平台

一个只读的终端日志查看器。仿真与 Gazebo 图形界面继续运行在仿真电脑上，控制电脑通过浏览器实时查看、筛选和复制 PX4/Gazebo 输出。

## 已实现

- PX4、Gazebo 和混合日志视图
- WebSocket 实时刷新
- 用户向上滚动时自动暂停跟随，并提示新日志数量
- 回到底部后自动恢复跟随
- ERROR、WARN、INFO、DEBUG 分色
- 鼠标选择复制，以及一键复制当前筛选结果
- 来源、等级和关键字筛选
- 1/2/5/10 秒退避重连
- 按日志序号补发断线期间的信息
- 每个来源默认保留最近 10,000 行内存日志
- 不写入磁盘，服务重启后自动清空

## 环境要求

- 仿真电脑：Linux、Node.js 18+、npm、curl
- 两台电脑在同一个局域网，并允许访问仿真电脑的服务端口

## 安装与启动

在仿真电脑上执行：

```bash
npm install
npm start
```

默认监听所有网卡的 `8080` 端口。查看仿真电脑 IP：

```bash
hostname -I
```

假设 IP 为 `192.168.1.120`，控制电脑访问：

```text
http://192.168.1.120:8080
```

如果启用了防火墙：

```bash
sudo ufw allow 8080/tcp
```

## 采集终端日志

首先赋予辅助脚本执行权限：

```bash
chmod +x scripts/stream-log.sh
```

### 采集 PX4

用辅助脚本包裹原来的启动命令：

```bash
./scripts/stream-log.sh px4 bash -lc 'cd ~/PX4-Autopilot && make px4_sitl gz_x500'
```

### 采集独立 Gazebo 命令

```bash
./scripts/stream-log.sh gazebo bash -lc '你的 Gazebo 启动命令'
```

辅助脚本通过 `tee` 保留仿真电脑本地终端输出，同时发送一份到网页。stdout 与 stderr 分开采集；没有等级标识的 stderr 默认显示为 ERROR。

如果日志服务不在本机，可指定地址：

```bash
LOG_SERVER_URL=http://192.168.1.120:8080 \
  ./scripts/stream-log.sh px4 bash -lc '你的 PX4 命令'
```

> 如果 `make px4_sitl gz_x500` 同时启动 PX4 和 Gazebo，它们的合并输出会被归入 PX4 标签。只有使用两个独立命令启动和采集时，网页才能严格区分两个来源。

## 另一种方式：由服务端启动命令

也可以通过环境变量让日志服务直接启动并捕获命令：

```bash
PX4_COMMAND='cd ~/PX4-Autopilot && make px4_sitl gz_x500' npm start
```

独立启动两个进程：

```bash
PX4_COMMAND='你的 PX4 命令' \
GAZEBO_COMMAND='你的 Gazebo 命令' \
npm start
```

这种方式适合无人值守运行，但命令随日志服务一起结束。通常更推荐使用 `scripts/stream-log.sh`，便于在仿真电脑上直接控制进程。

## 配置

```bash
HOST=0.0.0.0 \
PORT=8080 \
MAX_LINES_PER_SOURCE=10000 \
npm start
```

| 环境变量 | 默认值 | 说明 |
|---|---:|---|
| `HOST` | `0.0.0.0` | 监听地址 |
| `PORT` | `8080` | Web 服务端口 |
| `MAX_LINES_PER_SOURCE` | `10000` | 每个来源的内存日志行数上限 |
| `PX4_COMMAND` | 空 | 可选，由服务端启动的 PX4 命令 |
| `GAZEBO_COMMAND` | 空 | 可选，由服务端启动的 Gazebo 命令 |

## 接口

- `GET /`：日志页面
- `GET /ws`：WebSocket 日志流
- `GET /api/status`：服务状态
- `POST /api/ingest/px4?streaming=1`：流式接收 PX4 文本
- `POST /api/ingest/gazebo?streaming=1`：流式接收 Gazebo 文本

## 当前日志策略

当前版本只采用有上限的服务端内存环形缓冲：

- 不建立数据库
- 不生成永久日志文件
- 页面刷新时可重新获取服务端仍保留的日志
- 网络重连时按序号补发日志
- 超出缓冲范围时，页面明确提示无法恢复的数量
- 服务进程或仿真电脑重启后，历史终端日志清空

PX4 自身产生的 `.ulg` 飞行日志不属于本模块的终端日志，不会被修改或管理。
