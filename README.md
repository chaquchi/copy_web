# PX4 / Gazebo 仿真日志平台 2.0

基于 Vue 3、Element Plus、Node.js 和 tmux 的局域网实时日志平台。后端自动连接已有 tmux 窗格，不再要求用户手工维护 `curl`、`capture-pane` 或 `pipe-pane` 命令。

## 功能

- Vue 3 + Element Plus 浅色界面
- 自动发现所有 tmux 会话、窗口和窗格
- 在网页选择窗格并开始采集
- 自动导入指定数量的 tmux 历史日志
- 自动采集后续实时输出
- 采集进程断开后自动恢复
- PX4、Gazebo、PX4/Gazebo 混合来源
- ERROR、WARN、INFO、DEBUG 分色
- 智能自动滚动；向上查看历史时暂停跟随
- 搜索、来源筛选、等级筛选和复制
- 虚拟列表，避免大量日志造成页面卡顿
- 标准 `ws` WebSocket、心跳和浏览器断线续传
- 每个来源默认保留最近 10,000 行内存日志
- 日志不写入磁盘；服务重启后清空
- 只保存 tmux 目标配置，以便服务重启后自动恢复采集

## 环境

- Ubuntu/Linux
- Node.js 18 或更高版本（推荐使用当前 LTS）
- tmux

检查：

```bash
node -v
npm -v
tmux -V
```

## 安装和启动

```bash
cd ~/web/copy_web
npm install
npm start
```

`npm start` 会先构建 Vue 页面，再启动 Node 服务。

启动成功：

```text
PX4/Gazebo 日志平台：http://0.0.0.0:8080
日志仅保存在内存中，每个来源最多 10000 行。
```

控制电脑访问：

```text
http://仿真电脑局域网IP:8080
```

查看 IP：

```bash
hostname -I
```

如有防火墙：

```bash
sudo ufw allow 8080/tcp
```

## 使用

1. 保持 PX4/Gazebo 在 tmux 中正常运行。
2. 打开 Web 页面。
3. 点击右上角“连接终端”。
4. 选择日志来源：
   - 如果 `make px4_sitl gz_x500` 在同一窗格中运行，选择“PX4 / Gazebo 混合”。
   - 独立 PX4 窗格选择“PX4”。
   - 独立 Gazebo 窗格选择“Gazebo”。
5. 选择例如 `px4:0.0` 的 tmux 窗格。
6. 设置首次导入历史行数，点击“连接并开始采集”。

平台会自动清除该窗格遗留的旧 `pipe-pane`，然后由后端统一管理实时采集。不会停止或重启仿真。

## 配置

```bash
HOST=0.0.0.0 PORT=8080 MAX_LINES_PER_SOURCE=10000 npm start
```

| 变量 | 默认值 | 说明 |
|---|---:|---|
| `HOST` | `0.0.0.0` | 监听地址 |
| `PORT` | `8080` | 服务端口 |
| `MAX_LINES_PER_SOURCE` | `10000` | 每个来源内存行数上限 |
| `CONFIG_PATH` | `data/config.json` | tmux 采集目标配置文件 |

`data/config.json` 只保存采集目标和历史行数，不保存终端日志。

## 开发模式

终端一：

```bash
npm run serve
```

终端二：

```bash
npm run dev
```

开发页面：

```text
http://127.0.0.1:5173
```

## 当前边界

如果 PX4 与 Gazebo 输出来自同一个 tmux pane，平台无法从操作系统层面可靠判断每一行的真实进程来源，因此应使用“PX4 / Gazebo 混合终端”。等级仍会根据日志内容自动识别。

PX4 自己生成的 `.ulg` 飞行日志不属于本平台的终端日志，不会被修改或管理。
