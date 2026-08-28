export const commandCategories = [
  { label: '全部', value: 'all' },
  { label: '基础帮助', value: 'help' },
  { label: '状态检查', value: 'status' },
  { label: '飞行控制', value: 'flight' },
  { label: '参数管理', value: 'param' },
  { label: 'uORB 数据', value: 'uorb' },
  { label: 'MAVLink', value: 'mavlink' },
  { label: '估计器与传感器', value: 'estimator' },
  { label: '日志与诊断', value: 'diagnostic' },
  { label: '启动与 tmux', value: 'host' }
];

export const simulationCommands = [
  { category: 'help', title: '列出 PX4 命令', command: 'help', description: '列出当前 PX4 Shell 中可用的模块和命令。', context: 'px4', safe: true, keywords: '帮助 命令列表 pxh nsh' },
  { category: 'help', title: '查看详细帮助', command: 'help -v', description: '显示带说明的完整 PX4 命令列表。', context: 'px4', safe: true, keywords: '详细帮助 verbose' },
  { category: 'help', title: '查看模块帮助', command: '<模块名> help', example: 'commander help', description: '查看指定模块支持的子命令和参数。请将模块名替换为 commander、param、listener 等。', context: 'px4', safe: true, template: true, keywords: '模块 用法 参数' },

  { category: 'status', title: 'PX4 版本与构建信息', command: 'ver all', description: '查看 PX4 版本、Git 版本、系统和构建信息。', context: 'px4', safe: true, keywords: '版本 git build 系统' },
  { category: 'status', title: '飞行与解锁状态', command: 'commander status', description: '查看解锁状态、导航状态、故障保护和飞行模式。', context: 'px4', safe: true, keywords: '状态 模式 arm failsafe nav' },
  { category: 'status', title: '任务与进程状态', command: 'top', description: '查看 PX4 任务、CPU 占用和栈使用情况；按 Q 退出。', context: 'px4', safe: true, keywords: 'CPU 进程 任务 性能' },
  { category: 'status', title: '工作队列状态', command: 'work_queue status', description: '查看 PX4 工作队列及任务调度状态。', context: 'px4', safe: true, keywords: 'work queue 调度' },
  { category: 'status', title: '系统消息缓冲', command: 'dmesg', description: '显示 PX4 系统消息，有助于查看启动错误和驱动异常。', context: 'px4', safe: true, keywords: '系统消息 启动 错误 驱动' },

  { category: 'flight', title: '解锁', command: 'commander arm', description: '解锁飞行器。仿真状态满足解锁条件时才会成功。', context: 'px4', danger: true, keywords: 'arm 解锁' },
  { category: 'flight', title: '上锁', command: 'commander disarm', description: '为飞行器上锁。飞行中执行可能被拒绝或造成风险。', context: 'px4', danger: true, keywords: 'disarm 上锁' },
  { category: 'flight', title: '起飞', command: 'commander takeoff', description: '请求自动起飞，需要已解锁且状态允许。', context: 'px4', danger: true, keywords: 'takeoff 起飞' },
  { category: 'flight', title: '降落', command: 'commander land', description: '切换到自动降落。', context: 'px4', danger: true, keywords: 'land 降落' },
  { category: 'flight', title: '切换悬停模式', command: 'commander mode posctl', description: '请求切换到位置控制模式。需要有效的位置估计。', context: 'px4', danger: true, keywords: 'position mode posctl 位置模式' },
  { category: 'flight', title: '切换任务模式', command: 'commander mode auto:mission', description: '请求进入自动任务模式，需要已上传有效任务。', context: 'px4', danger: true, keywords: 'mission auto 任务模式' },
  { category: 'flight', title: '切换 Offboard', command: 'commander mode offboard', description: '请求进入 Offboard。必须先持续收到有效的 Offboard 控制数据。', context: 'px4', danger: true, keywords: 'offboard 外部控制' },

  { category: 'param', title: '查看指定参数', command: 'param show <参数名>', example: 'param show SYS_AUTOSTART', description: '显示参数当前值。支持使用通配符，例如 param show EKF2_*。', context: 'px4', safe: true, template: true, keywords: '参数 查询 show' },
  { category: 'param', title: '搜索 EKF2 参数', command: 'param show EKF2_*', description: '列出全部 EKF2 相关参数。输出内容可能较多。', context: 'px4', safe: true, keywords: '参数 EKF2 搜索' },
  { category: 'param', title: '修改参数', command: 'param set <参数名> <数值>', example: 'param set COM_ARM_WO_GPS 1', description: '修改参数值。修改前建议先使用 param show 记录原值。', context: 'px4', danger: true, template: true, keywords: '参数 修改 set' },
  { category: 'param', title: '保存参数', command: 'param save', description: '将当前参数保存到默认参数存储。', context: 'px4', danger: true, keywords: '参数 保存 save' },
  { category: 'param', title: '重置单个参数', command: 'param reset <参数名>', example: 'param reset COM_ARM_WO_GPS', description: '将指定参数恢复默认值。', context: 'px4', danger: true, template: true, keywords: '参数 重置 reset' },

  { category: 'uorb', title: '查看飞行器状态主题', command: 'listener vehicle_status', description: '输出一次 vehicle_status 主题内容。', context: 'px4', safe: true, keywords: 'uorb vehicle status 状态主题' },
  { category: 'uorb', title: '持续查看本地位置', command: 'listener vehicle_local_position 10', description: '以默认间隔输出 10 次本地位置数据。', context: 'px4', safe: true, keywords: 'uorb local position xyz 位置' },
  { category: 'uorb', title: '查看姿态', command: 'listener vehicle_attitude 5', description: '输出 5 次飞行器四元数姿态。', context: 'px4', safe: true, keywords: 'uorb attitude quaternion 姿态' },
  { category: 'uorb', title: '查看 GPS', command: 'listener sensor_gps 5', description: '输出 5 次 GPS 传感器主题。部分版本主题名可能为 vehicle_gps_position。', context: 'px4', safe: true, keywords: 'uorb gps 卫星' },
  { category: 'uorb', title: 'uORB 主题统计', command: 'uorb top', description: '实时查看 uORB 主题更新率；使用 Ctrl+C 退出。', context: 'px4', safe: true, keywords: 'uorb top rate 频率' },
  { category: 'uorb', title: '列出 uORB 主题', command: 'uorb status', description: '列出当前已发布的 uORB 主题和实例。', context: 'px4', safe: true, keywords: 'uorb status topic 列表' },

  { category: 'mavlink', title: 'MAVLink 实例状态', command: 'mavlink status', description: '查看各 MAVLink 实例、端口、速率和丢包情况。', context: 'px4', safe: true, keywords: 'mavlink udp 端口 丢包 速率' },
  { category: 'mavlink', title: 'MAVLink 流列表', command: 'mavlink stream', description: '查看 mavlink stream 的使用说明。不同 PX4 版本参数可能不同。', context: 'px4', safe: true, keywords: 'mavlink stream 消息流' },

  { category: 'estimator', title: 'EKF2 状态', command: 'ekf2 status', description: '查看 EKF2 实例、融合状态和故障信息。', context: 'px4', safe: true, keywords: 'ekf estimator 估计器 融合' },
  { category: 'estimator', title: '传感器模块状态', command: 'sensors status', description: '查看传感器投票、校准和选择状态。', context: 'px4', safe: true, keywords: 'sensor imu gyro accel 传感器' },
  { category: 'estimator', title: 'IMU 状态', command: 'imu_status', description: '查看 IMU、陀螺仪和加速度计状态；若版本不支持，请使用 sensors status。', context: 'px4', safe: true, keywords: 'imu gyro accel 状态' },
  { category: 'estimator', title: '传感器综合数据', command: 'listener sensor_combined 5', description: '输出 5 次组合传感器数据。', context: 'px4', safe: true, keywords: 'sensor combined imu 数据' },

  { category: 'diagnostic', title: '性能计数器', command: 'perf', description: '显示性能计数器帮助；可继续使用 perf print 等子命令。', context: 'px4', safe: true, keywords: 'performance 性能 counter' },
  { category: 'diagnostic', title: '日志模块状态', command: 'logger status', description: '查看 ULog logger 状态、后端和当前日志文件。', context: 'px4', safe: true, keywords: 'logger ulg 日志 状态' },
  { category: 'diagnostic', title: '开始 ULog 记录', command: 'logger on', description: '手动开始记录 ULog。', context: 'px4', danger: true, keywords: 'logger ulg 开始' },
  { category: 'diagnostic', title: '停止 ULog 记录', command: 'logger off', description: '停止当前 ULog 记录。', context: 'px4', danger: true, keywords: 'logger ulg 停止' },
  { category: 'diagnostic', title: '数据管理器状态', command: 'dataman status', description: '查看任务、地理围栏等持久化数据管理状态。', context: 'px4', safe: true, keywords: 'dataman mission fence 状态' },

  { category: 'host', title: '启动 x500 仿真', command: 'cd ~/PX4-Autopilot && make px4_sitl gz_x500', description: '在 Ubuntu Shell 中构建并启动 PX4 SITL + Gazebo x500。不能在正在运行的 PX4 Shell 中执行。', context: 'host', referenceOnly: true, keywords: '启动 gazebo x500 make sitl' },
  { category: 'host', title: '启动无界面仿真', command: 'cd ~/PX4-Autopilot && HEADLESS=1 make px4_sitl gz_x500', description: '在 Ubuntu Shell 中启动无 Gazebo 客户端界面的仿真。', context: 'host', referenceOnly: true, keywords: 'headless 无界面 gazebo' },
  { category: 'host', title: '查看 tmux 窗格', command: "tmux list-panes -a -F '#S:#I.#P command=#{pane_current_command} pid=#{pane_pid}'", description: '在 Ubuntu Shell 中查看所有 tmux 窗格。', context: 'host', referenceOnly: true, keywords: 'tmux pane 窗格' },
  { category: 'host', title: '进入 PX4 tmux', command: 'tmux attach -t px4', description: '在 Ubuntu Shell 中进入 px4 会话。使用 Ctrl+B，然后按 D，可安全退出显示而不停止仿真。', context: 'host', referenceOnly: true, keywords: 'tmux attach 进入 会话' },
  { category: 'host', title: '查看仿真电脑 IP', command: 'hostname -I', description: '在 Ubuntu Shell 中查看局域网 IP。', context: 'host', referenceOnly: true, keywords: 'ip 网络 地址' }
];
