#!/usr/bin/env python3
# custom-skills/graphify-manager/collection_layer.py
# Graphify 代码采集层 - 增量文件监控 + Redis Stream 事件发布
#
# 增强版 (v2): 添加目录排除、代码聚焦、改进的去重机制
import asyncio
import json
import sys
from pathlib import Path
from datetime import datetime
import subprocess
import hashlib
import threading
import queue
import time

try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
    import redis.asyncio as redis
    WATCHDOG_AVAILABLE = True
except ImportError:
    WATCHDOG_AVAILABLE = False
    print("⚠️  watchdog 或 redis 未安装，采集层将使用轮询模式")

# ============================================================
# 高价值扫描路径配置 (取代全 workspace 扫描)
# ============================================================
SCAN_TARGETS = [
    # 天道系统核心代码
    '/home/ai/projects/tiandao-system',
    # 项目代码
    '/home/ai/.openclaw/workspace/projects/lingyi-cms',
    '/home/ai/.openclaw/workspace/projects/tiandao-system',
    '/home/ai/.openclaw/workspace/projects/OpenClaw-Admin',
    '/home/ai/.openclaw/workspace/projects/audio-stream',
    '/home/ai/.openclaw/workspace/projects/camera-recorder',
    '/home/ai/.openclaw/workspace/projects/send-email',
    '/home/ai/.openclaw/workspace/projects/task-router',
    '/home/ai/.openclaw/workspace/projects/tech-knowledge',
    # 自定义 skills
    '/home/ai/.openclaw/workspace/custom-skills',
    # 系统脚本
    '/home/ai/.openclaw/workspace/scripts',
    # OpenClaw 核心代码
    '/home/ai/.openclaw/workspace/core',
    '/home/ai/.openclaw/workspace/memory-system',
]

# 需要排除的目录模式 (即使在 SCAN_TARGETS 内)
EXCLUDE_DIRS = [
    'node_modules',
    '.git',
    '__pycache__',
    '.pytest_cache',
    'dist',
    'build',
    '.next',
    '.nuxt',
    'coverage',
    '.cache',
    '.tmp',
    '.temp',
    'chrome-extensions',
    '.vscode',
    '.idea',
    'types',
    'definitely-typed',
]

# 代码文件扩展名 (高价值)
CODE_EXTS = {'.py', '.js', '.ts', '.jsx', '.tsx', '.go', '.rs', '.java', '.cpp', '.c', '.h', '.hpp', '.cs', '.rb', '.php'}
# 文档文件扩展名
DOC_EXTS = {'.md', '.txt', '.rst', '.pdf', '.docx', '.xlsx', '.json', '.yaml', '.yml', '.toml', '.ini', '.conf', '.cfg', '.env'}
# 忽略的文件扩展名
IGNORE_EXTS = {'.log', '.tmp', '.swp', '.pyc', '.pyo', '.so', '.dll', '.exe', '.bin', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp', '.mp3', '.mp4', '.wav', '.zip', '.tar', '.gz', '.rar', '.7z', '.lock', '.map'}


def should_process_file(file_path: Path) -> tuple:
    """判断文件是否应该被处理，返回 (should_process, file_type, priority)"""
    name = file_path.name
    
    # 忽略隐藏文件和临时文件
    if name.startswith('.') or name.startswith('~') or name.endswith('~'):
        return False, None, None
    
    # 忽略特定扩展名
    ext = file_path.suffix.lower()
    if ext in IGNORE_EXTS:
        return False, None, None
    
    # 检查路径是否在排除目录内
    parts = file_path.parts
    for exclude in EXCLUDE_DIRS:
        if exclude in parts:
            return False, None, None
    
    # 判断文件类型和优先级
    if ext in CODE_EXTS:
        return True, 'code', 'high'
    elif ext in DOC_EXTS:
        return True, 'doc', 'normal'
    else:
        return True, 'other', 'low'


def compute_file_hash(file_path: Path) -> str:
    """计算文件 SHA256 哈希"""
    try:
        with open(file_path, 'rb') as f:
            return hashlib.sha256(f.read()).hexdigest()
    except Exception:
        return None

class GraphifyFileHandler(FileSystemEventHandler):
    def __init__(self, redis_client, event_stream, loop):
        self.redis_client = redis_client
        self.event_stream = event_stream
        self.file_hashes = {}
        self.recent_events = {}  # 去重：file_path -> last emit timestamp
        self.loop = loop  # 保存主线程的 event loop 引用
        
    def get_file_hash(self, file_path):
        try:
            with open(file_path, 'rb') as f:
                return hashlib.sha256(f.read()).hexdigest()
        except:
            return None
    
    def _emit(self, coro):
        """线程安全地将协程放入事件循环"""
        try:
            self.loop.call_soon_threadsafe(lambda: asyncio.create_task(coro))
        except Exception as e:
            print(f"[collection] 调度事件失败: {e}")
    
    def on_modified(self, event):
        if not event.is_directory:
            self._emit(self.process_file_change(event.src_path, 'modified'))
    
    def on_created(self, event):
        if not event.is_directory:
            self._emit(self.process_file_change(event.src_path, 'created'))
    
    def _is_excluded_path(self, file_path: Path) -> bool:
        """检查文件路径是否在排除目录内"""
        parts = file_path.parts
        for exclude in EXCLUDE_DIRS:
            if exclude in parts:
                return True
        return False

    async def process_file_change(self, file_path, change_type):
        try:
            file_path = Path(file_path)
            
            # 增强判断：是否应该处理
            should_process, file_type, priority = should_process_file(file_path)
            if not should_process:
                return
            
            # 排除目录二次检查
            if self._is_excluded_path(file_path):
                return
            
            current_hash = self.get_file_hash(file_path)
            if not current_hash:
                return
                
            previous_hash = self.file_hashes.get(str(file_path))
            if previous_hash == current_hash and change_type == 'modified':
                return  # 内容没变，跳过
                
            self.file_hashes[str(file_path)] = current_hash
            file_ext = file_path.suffix.lower()
            
            event_data = {
                'type': 'file_change',
                'file_path': str(file_path),
                'change_type': change_type,
                'file_ext': file_ext,
                'file_type': file_type,
                'priority': priority,
                'timestamp': datetime.now().isoformat(),
                'content_hash': current_hash
            }
            
            # 改进去重：10秒滑动窗口内同一文件只发一条
            last_time = self.recent_events.get(str(file_path), 0)
            if time.time() - last_time < 10:
                return  # 跳过重复事件
            
            if self.redis_client:
                self.recent_events[str(file_path)] = time.time()
                await self.redis_client.xadd(self.event_stream, {str(k): str(v) for k, v in event_data.items()})
                print(f"[collection] 记录事件: {file_path.name} ({change_type}, {file_type})")
            else:
                print(f"[collection] 无 Redis，跳过事件: {file_path}")
                
        except Exception as e:
            print(f"[collection] 处理文件变更失败: {e}")

class CollectionLayer:
    def __init__(self, watch_paths, redis_url, event_stream):
        self.watch_paths = [Path(p) for p in watch_paths]
        self.redis_url = redis_url
        self.event_stream = event_stream
        self.redis_client = None
        self.observer = None
        self.running = False
        self.main_loop = None  # 主线程事件循环引用
        
    async def connect_redis(self):
        try:
            if not self.redis_url:
                print("⚠️  未配置 Redis URL")
                return
            self.redis_client = await redis.from_url(self.redis_url)
            await self.redis_client.ping()
            print("[collection] ✅ Redis 连接成功")
        except Exception as e:
            print(f"[collection] ❌ Redis 连接失败: {e}")
            self.redis_client = None
    
    def start_file_watching(self):
        if not WATCHDOG_AVAILABLE:
            print("[collection] ⚠️  watchdog 不可用，使用轮询模式")
            asyncio.create_task(self.polling_mode())
            return
            
        try:
            self.observer = Observer()
            # 传入主线程的 event loop 给 handler
            handler = GraphifyFileHandler(
                self.redis_client, 
                self.event_stream,
                self.main_loop
            )
            
            for path in self.watch_paths:
                if path.exists():
                    self.observer.schedule(handler, str(path), recursive=True)
                    print(f"[collection] 👁️  监控: {path}")
                else:
                    print(f"[collection] ⚠️  路径不存在: {path}")
            
            self.observer.start()
            print("[collection] ✅ 文件监控已启动")
            
        except Exception as e:
            print(f"[collection] ❌ 启动文件监控失败: {e}")
            asyncio.create_task(self.polling_mode())
    
    async def polling_mode(self):
        print("[collection] 🔄 进入轮询模式，每30秒检查一次")
        known_files = {}
        
        while self.running:
            try:
                for watch_path in self.watch_paths:
                    if not watch_path.exists():
                        continue
                    for file_path in watch_path.rglob('*'):
                        if file_path.is_file():
                            # 使用增强的 should_process_file 判断
                            should_process, file_type, priority = should_process_file(file_path)
                            if not should_process:
                                continue
                            str_path = str(file_path)
                            current_mtime = file_path.stat().st_mtime
                            if str_path not in known_files:
                                known_files[str_path] = current_mtime
                                await self.process_polling_event(str_path, 'created', file_type, priority)
                            elif known_files[str_path] != current_mtime:
                                known_files[str_path] = current_mtime
                                await self.process_polling_event(str_path, 'modified', file_type, priority)
                
                await asyncio.sleep(30)
            except Exception as e:
                print(f"[collection] 轮询错误: {e}")
                await asyncio.sleep(60)
    
    async def process_polling_event(self, file_path, change_type, file_type='other', priority='low'):
        try:
            file_ext = Path(file_path).suffix.lower()
            event_data = {
                'type': 'file_change',
                'file_path': file_path,
                'change_type': change_type,
                'file_ext': file_ext,
                'file_type': file_type,
                'priority': priority,
                'timestamp': datetime.now().isoformat(),
                'source': 'polling'
            }
            
            if self.redis_client:
                await self.redis_client.xadd(self.event_stream, {str(k): str(v) for k, v in event_data.items()})
            print(f"[collection] 📄 [轮询] 事件: {Path(file_path).name} ({file_type})")
        except Exception as e:
            print(f"[collection] 处理轮询事件失败: {e}")
    
    async def start(self):
        print("[collection] 🚀 启动采集层...")
        
        # 保存主线程事件循环引用
        self.main_loop = asyncio.get_event_loop()
        
        await self.connect_redis()
        
        self.running = True
        self.start_file_watching()
        
        print("[collection] ✅ 采集层已就绪，等待文件变更...")
        
        try:
            while self.running:
                await asyncio.sleep(1)
        except KeyboardInterrupt:
            print("\n[collection] 🛑 接收到中断信号")
        finally:
            await self.stop()
    
    async def stop(self):
        print("[collection] 🛑 停止采集层...")
        self.running = False
        
        if self.observer:
            self.observer.stop()
            self.observer.join()
            print("[collection] ✅ 文件监控已停止")
        
        if self.redis_client:
            await self.redis_client.close()
            print("[collection] ✅ Redis 连接已关闭")

async def main():
    """使用全局 SCAN_TARGETS 配置启动采集层"""
    # 过滤掉不存在的路径
    watch_paths = [p for p in SCAN_TARGETS if Path(p).exists()]
    print(f"[collection] 配置扫描路径 ({len(watch_paths)} 个):")
    for p in watch_paths:
        print(f"  - {p}")
    
    redis_url = 'redis://localhost:6379'
    event_stream = 'graphify:collection:events'
    
    layer = CollectionLayer(watch_paths, redis_url, event_stream)
    await layer.start()

if __name__ == '__main__':
    asyncio.run(main())