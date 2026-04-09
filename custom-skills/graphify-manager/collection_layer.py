#!/usr/bin/env python3
# custom-skills/graphify-manager/collection_layer.py
import asyncio
import json
import sys
from pathlib import Path
from datetime import datetime
import subprocess
import hashlib
import threading
import queue

try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
    import redis.asyncio as redis
    WATCHDOG_AVAILABLE = True
except ImportError:
    WATCHDOG_AVAILABLE = False
    print("⚠️  watchdog 或 redis 未安装，采集层将使用轮询模式")

class GraphifyFileHandler(FileSystemEventHandler):
    def __init__(self, redis_client, event_stream, loop):
        self.redis_client = redis_client
        self.event_stream = event_stream
        self.file_hashes = {}
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
    
    async def process_file_change(self, file_path, change_type):
        try:
            file_path = Path(file_path)
            
            # 忽略隐藏文件和临时文件
            if file_path.name.startswith('.') or file_path.name.endswith('~'):
                return
            
            file_ext = file_path.suffix.lower()
            ignore_exts = ['.log', '.tmp', '.swp', '.pyc', '.pyo', '.so', '.dll']
            if file_ext in ignore_exts:
                return
            
            current_hash = self.get_file_hash(file_path)
            if not current_hash:
                return
                
            previous_hash = self.file_hashes.get(str(file_path))
            if previous_hash == current_hash and change_type == 'modified':
                return
                
            self.file_hashes[str(file_path)] = current_hash
            
            code_exts = ['.py', '.js', '.ts', '.jsx', '.tsx', '.go', '.rs', '.java', '.cpp', '.c']
            doc_exts = ['.md', '.txt', '.rst', '.pdf', '.docx', '.xlsx']
            
            if file_ext in code_exts:
                file_type = 'code'
                priority = 'high'
            elif file_ext in doc_exts:
                file_type = 'doc'
                priority = 'normal'
            else:
                file_type = 'other'
                priority = 'low'
            
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
            
            # 去重：5秒内同一文件只发一条
            import time
            last_time = self.recent_events.get(str(file_path), 0)
            if time.time() - last_time < 5:
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
                            if file_path.name.startswith('.') or file_path.suffix.lower() in ['.log', '.tmp', '.swp']:
                                continue
                            str_path = str(file_path)
                            current_mtime = file_path.stat().st_mtime
                            if str_path not in known_files:
                                known_files[str_path] = current_mtime
                                await self.process_polling_event(str_path, 'created')
                            elif known_files[str_path] != current_mtime:
                                known_files[str_path] = current_mtime
                                await self.process_polling_event(str_path, 'modified')
                
                await asyncio.sleep(30)
            except Exception as e:
                print(f"[collection] 轮询错误: {e}")
                await asyncio.sleep(60)
    
    async def process_polling_event(self, file_path, change_type):
        try:
            file_ext = Path(file_path).suffix.lower()
            event_data = {
                'type': 'file_change',
                'file_path': file_path,
                'change_type': change_type,
                'file_ext': file_ext,
                'timestamp': datetime.now().isoformat(),
                'source': 'polling'
            }
            
            if self.redis_client:
                await self.redis_client.xadd(self.event_stream, {str(k): str(v) for k, v in event_data.items()})
            print(f"[collection] 📄 [轮询] 事件: {Path(file_path).name}")
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
    watch_paths = [
        '/home/ai/projects/tiandao-system',
        '/home/ai/.openclaw/workspace/projects/lingyi-cms',
        '/home/ai/.openclaw/workspace'
    ]
    
    redis_url = 'redis://localhost:6379'
    event_stream = 'graphify:collection:events'
    
    layer = CollectionLayer(watch_paths, redis_url, event_stream)
    await layer.start()

if __name__ == '__main__':
    asyncio.run(main())