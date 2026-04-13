#!/usr/bin/env python3
"""
A7670G 4G模块 - 统一监听服务（v6 - 语音留言系统）
来电 → 接听 → 播放语音提示 → 录制留言 → 转写 → 推送
"""

import serial, time, re, os, sys, signal, subprocess, json, urllib.request
from datetime import datetime

PORT = '/dev/ttyUSB2'
BAUD = 115200
LOG_FILE = '/home/ai/.openclaw/workspace/logs/4g-calls.log'
RECORDINGS_IN = '/home/ai/.openclaw/workspace/voice-system/recordings/inbound'
GREETING_FILE = '/home/ai/.openclaw/workspace/voice-system/data/greeting_4g.wav'
GREETING_VOLUME = 2.5

os.makedirs(RECORDINGS_IN, exist_ok=True)
os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)

# ── 全局状态 ─────────────────────────────────────────
rec_proc = None
in_call = False
call_start = None
caller = None
rec_path = None
ring_count = 0
ringing = False

def log(msg):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    with open(LOG_FILE, 'a') as f:
        f.write(line + '\n')

# ── 录音控制 ─────────────────────────────────────────
def start_recording(out_path: str):
    global rec_proc
    if rec_proc:
        rec_proc.terminate()
        try: rec_proc.wait(timeout=3)
        except: rec_proc.kill()
    rec_proc = subprocess.Popen(
        ['arecord', '-D', 'plughw:1,0', '-f', 'S16_LE', '-r', '8000', '-c', '1', out_path],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    log(f"[录音] 开始 PID={rec_proc.pid}")

def stop_recording():
    global rec_proc
    if rec_proc:
        rec_proc.terminate()
        try: rec_proc.wait(timeout=5)
        except: rec_proc.kill()
        log(f"[录音] 停止")
        rec_proc = None

def cleanup():
    stop_recording()
    log("服务停止")

signal.signal(signal.SIGTERM, lambda *a: cleanup())
signal.signal(signal.SIGINT, lambda *a: cleanup())

# ── 语音提示播放 ─────────────────────────────────────
def play_greeting():
    """播放语音提示到Pi耳机口（→4G模块mic→通话对方）"""
    if not os.path.exists(GREETING_FILE):
        log(f"[提示] 语音文件不存在")
        return
    log(f"[提示] 播放语音提示...")
    try:
        proc = subprocess.run([
            'ffmpeg', '-y',
            '-i', GREETING_FILE,
            '-af', f'volume={GREETING_VOLUME}',
            '-ar', '48000', '-ac', '2',
            '-f', 'alsa', 'plughw:1,0'
        ], capture_output=True, timeout=15)
        if proc.returncode == 0:
            log(f"[提示] 播放完成")
        else:
            log(f"[提示] 播放失败: {proc.stderr[-100:]}")
    except subprocess.TimeoutExpired:
        log(f"[提示] 播放超时")
    except Exception as e:
        log(f"[提示] 播放异常: {e}")

# ── DashScope Fun-ASR 转写（主）──────────────────────
def transcribe_funasr(wav_path: str) -> str:
    try:
        import subprocess as _sub, requests, json as _json, os as _os, time
        log("[Fun-ASR] 准备音频...")

        pcm_path = wav_path + '.16k.wav'
        r = _sub.run(
            ['ffmpeg', '-y', '-i', wav_path, '-ar', '16000', '-ac', '1',
             '-acodec', 'pcm_s16le', pcm_path],
            capture_output=True, timeout=15
        )
        if r.returncode != 0:
            log(f"[Fun-ASR] 转码失败")
            return None

        with open(pcm_path, 'rb') as f:
            upload = requests.post(
                'https://litterbox.catbox.moe/resources/internals/api.php',
                files={'fileToUpload': (_os.path.basename(pcm_path), f, 'audio/wav')},
                data={'reqtype': 'fileupload', 'time': '72h'},
                timeout=60
            )
        if upload.status_code != 200 or not upload.text.strip().startswith('https://'):
            log(f"[Fun-ASR] 上传失败")
            _os.unlink(pcm_path)
            return None

        audio_url = upload.text.strip()
        log(f"[Fun-ASR] 已上传")

        _os.environ['DASHSCOPE_API_KEY'] = 'sk-50c8c0524a8244ffbdcb9131545dfa56'
        from dashscope.audio.asr import Transcription

        task_resp = Transcription.async_call(model='fun-asr', file_urls=[audio_url], language_hints=['zh'])
        task_id = task_resp.output.task_id
        log(f"[Fun-ASR] 任务ID: {task_id}")

        for i in range(20):
            result = Transcription.wait(task=task_id)
            if result.output.task_status == 'SUCCEEDED':
                for r in result.output.results:
                    turl = r.get('transcription_url')
                    if turl:
                        import urllib.request as _ur
                        with _ur.urlopen(turl, timeout=30) as tr:
                            tr_data = _json.load(tr)
                            texts = []
                            for ch in tr_data.get('transcripts', []):
                                txt = ch.get('text', '')
                                if txt:
                                    texts.append(txt)
                            text = ' '.join(texts)
                            log(f"[Fun-ASR] 结果: {text[:80]}")
                            _os.unlink(pcm_path)
                            return text or "(无语音内容)"
                break
            elif result.output.task_status == 'FAILED':
                log(f"[Fun-ASR] 失败")
                break
            time.sleep(3)

        _os.unlink(pcm_path)
        return None
    except Exception as e:
        log(f"[Fun-ASR] 异常: {e}")
        try:
            _os.unlink(wav_path + '.16k.wav')
        except:
            pass
        return None

# ── Whisper 本地转写（兜底）────────────────────────────
def transcribe_whisper(wav_path: str) -> str:
    try:
        import whisper
        log("[Whisper] 加载模型 (large-v3-turbo)...")
        model = whisper.load_model('large-v3-turbo')
        log(f"[Whisper] 转写中...")
        result = model.transcribe(wav_path, language='zh', initial_prompt='电话通话内容')
        text = result['text'].strip()
        log(f"[Whisper] 结果: {text[:80] or '(空)'}")
        return text or "(无语音内容)"
    except Exception as e:
        log(f"[Whisper] 失败: {e}")
        try:
            import whisper
            model = whisper.load_model('base')
            result = model.transcribe(wav_path, language='zh', initial_prompt='电话通话内容')
            return result['text'].strip() or "(无语音内容)"
        except Exception as e2:
            log(f"[Whisper] base也失败: {e2}")
            return "(转写失败)"

def transcribe(wav_path: str) -> str:
    result = transcribe_funasr(wav_path)
    if result:
        return result
    log("[转写] Fun-ASR 失败，回退到 Whisper...")
    return transcribe_whisper(wav_path)

# ── 推送脚本 ─────────────────────────────────────────
PUSH_SCRIPT = '/home/ai/.openclaw/workspace/voice-system/src/push_call_summary.py'

def push_summary(caller, duration, transcript, wav_path):
    log("[推送] 启动摘要推送进程...")
    try:
        result = subprocess.run(
            [sys.executable, PUSH_SCRIPT, caller or '', str(duration), transcript, wav_path],
            capture_output=True, text=True, timeout=60
        )
        if result.returncode == 0:
            log("[推送] 成功")
        else:
            log(f"[推送] 失败: {result.stderr or result.stdout}")
    except Exception as e:
        log(f"[推送] 异常: {e}")

# ── AT命令 ─────────────────────────────────────────
def at_cmd(s, cmd, delay=0.5):
    s.write((cmd + '\r\n').encode())
    time.sleep(delay)
    resp = ''
    deadline = time.time() + 2.0
    while time.time() < deadline:
        if s.in_waiting > 0:
            resp += s.read(s.in_waiting).decode(errors='replace')
        time.sleep(0.05)
    return resp

def query_clcc(s):
    resp = at_cmd(s, 'AT+CLCC', delay=0.5)
    m = re.search(r'\+CLCC:\s*(\d+),(\d+),(\d+),(\d+),(\d+),"([^"]*)"', resp)
    if m:
        return int(m.group(3)), m.group(6)
    return None, None

# ── 主循环 ─────────────────────────────────────────
def main():
    global in_call, call_start, caller, rec_path, ring_count, ringing

    log("统一监听服务启动（v6 - 语音留言系统）")

    while True:
        try:
            s = serial.Serial(PORT, BAUD, timeout=0)
            s.flushInput()
            log("串口已连接")
            time.sleep(0.5)

            at_cmd(s, 'AT+CREG=0')
            at_cmd(s, 'AT+CEREG=0')
            at_cmd(s, 'AT+CLIP=1')
            at_cmd(s, 'AT+CNMI=2,1,0,1,0')
            at_cmd(s, 'AT+CLCC=1')
            log("模块初始化完成")

            buffer = ''

            while True:
                if s.in_waiting > 0:
                    data = s.read(s.in_waiting).decode(errors='replace')
                    buffer += data

                    # ── 来电检测 ─────────────────────────
                    if not in_call:
                        clip_m = re.search(r'\+CLIP:\s*"([^"]+)"', buffer)
                        if clip_m and not caller:
                            caller = clip_m.group(1)
                            log(f"📞 来电号码: {caller}")

                        ring_matches = re.findall(r'\bRING\b', buffer)
                        if ring_matches:
                            ring_count += len(ring_matches)
                            if not ringing:
                                ringing = True
                                log(f"📞 振铃 (RING x{ring_count})")

                        if ringing and ring_count >= 2 and caller:
                            log(f"📞 接听: {caller}，RING x{ring_count}，开始接听...")
                            buffer = ''

                            answered = False
                            for attempt in range(5):
                                s.write(b'ATA\r\n')
                                time.sleep(2)

                                call_state, _ = query_clcc(s)
                                log(f"[ATA] 尝试{attempt+1}: CLCC={call_state}")

                                if call_state == 0:
                                    answered = True
                                    log("[ATA] ✅ 通话已激活")
                                    break
                                elif call_state is None:
                                    time.sleep(1)
                                else:
                                    time.sleep(1)

                            if answered:
                                # 先开始录音（会录到greeting，之后是用户留言）
                                ts = datetime.now().strftime('%Y%m%d_%H%M%S')
                                safe = re.sub(r'\D', '', caller)[-11:] if caller else 'unknown'
                                rec_path = os.path.join(RECORDINGS_IN, f'{ts}_{safe}.wav')
                                start_recording(rec_path)
                                in_call = True
                                call_start = datetime.now()
                                log(f"通话已开始，先录音再播放提示...")

                                # 再播放语音提示
                                play_greeting()
                            else:
                                log(f"[错误] 接听失败，跳过来电")
                                ringing = False
                                ring_count = 0
                                caller = None

                            buffer = ''

                    # ── 通话结束 ──────────────────────
                    if in_call:
                        if ('NO CARRIER' in buffer or 'VOICE CALL: END' in buffer or
                            '+CEND' in buffer or
                            (re.search(r'\+CLCC:', buffer) and re.search(r',6,', buffer))):
                            duration = (datetime.now() - call_start).seconds
                            log(f"📞 通话结束: {caller}，时长 {duration}s")
                            stop_recording()

                            if rec_path and os.path.exists(rec_path):
                                transcript = transcribe(rec_path)
                                push_summary(caller, duration, transcript, rec_path)

                                record = {
                                    "ts": datetime.now().strftime('%Y%m%d_%H%M%S'),
                                    "caller": caller, "duration": duration,
                                    "transcript": transcript,
                                    "wav": rec_path, "tag": "inbound"
                                }
                                os.makedirs('/home/ai/.openclaw/workspace/voice-system/data', exist_ok=True)
                                with open('/home/ai/.openclaw/workspace/voice-system/data/calls.jsonl', 'a') as f:
                                    f.write(json.dumps(record, ensure_ascii=False) + '\n')

                            in_call = False
                            caller = None
                            rec_path = None
                            buffer = ''

                    # ── 短信 ──────────────────────────
                    if '+CMT:' in buffer:
                        log(f"📩 收到短信")
                        buffer = ''

                    # ── 来电取消 ────────────────────
                    if ringing and not in_call:
                        if 'NO CARRIER' in buffer or 'MISSED_CALL' in buffer:
                            log(f"📞 来电取消: {caller}")
                            ringing = False
                            ring_count = 0
                            caller = None
                            buffer = ''

                    if len(buffer) > 2000:
                        buffer = buffer[-500:]

                time.sleep(0.05)

        except serial.SerialException as e:
            log(f"串口错误: {e}，3秒后重连...")
            stop_recording()
            time.sleep(3)
        except Exception as e:
            log(f"异常: {e}，5秒后重连...")
            stop_recording()
            time.sleep(5)

if __name__ == '__main__':
    main()
