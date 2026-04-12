#!/bin/bash
# 以 dialout 组运行（解决 PM2 进程组信息丢失问题）
exec sg dialout -c "python3 $*"
