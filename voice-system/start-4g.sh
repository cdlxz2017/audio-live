#!/bin/bash
export PYTHONPATH=/home/ai/.local/lib/python3.12/site-packages
exec sg dialout -c "python3 /home/ai/.openclaw/workspace/scripts/4g-combined-listener.py"
