#!/usr/bin/env bash
set -uo pipefail

SOURCE="${1:-}"
if [[ "$SOURCE" != "px4" && "$SOURCE" != "gazebo" ]]; then
  echo "用法: $0 <px4|gazebo> <命令> [参数...]" >&2
  exit 2
fi
shift

if [[ $# -eq 0 ]]; then
  echo "错误：没有提供需要执行的命令" >&2
  exit 2
fi

LOG_SERVER_URL="${LOG_SERVER_URL:-http://127.0.0.1:8080}"
INGEST_URL="${LOG_SERVER_URL%/}/api/ingest/${SOURCE}?streaming=1"

post_stream() {
  local stream="$1"
  curl --silent --show-error --no-buffer \
    -X POST -H 'Content-Type: text/plain; charset=utf-8' \
    --data-binary @- "${INGEST_URL}&stream=${stream}" >/dev/null
}

# tee 保证日志在仿真电脑本地终端正常显示，同时向 Web 平台传输。
"$@" \
  > >(tee >(post_stream stdout)) \
  2> >(tee /dev/stderr >(post_stream stderr) >/dev/null)
