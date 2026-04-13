"""
notifier.py - 微信推送
"""
import subprocess
import logging
from src.config import config

log = logging.getLogger('voice.notifier')
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
    filename='/home/ai/.openclaw/workspace/logs/voice-v2/notifier.log'
)

WECHAT_CFG = config['wechat']


def notify_call(caller_name: str, caller: str, duration: int,
                summary: str, transcript: str):
    """
    推送来电摘要到微信
    """
    contact_info = f"{caller_name} ({caller})" if caller_name != caller else caller
    msg = f"""📞 来电摘要
━━━━━━━━━━━━━━━
号码：{contact_info}
时长：{duration} 秒
━━━━━━━━━━━━━━━
{summary}
━━━━━━━━━━━━━━━
转写：
{transcript[:300]}{'...' if len(transcript) > 300 else ''}"""

    return _wechat_send(msg)


def notify_sms(sender_name: str, sender: str, content: str):
    """推送收到短信到微信"""
    contact_info = f"{sender_name} ({sender})" if sender_name != sender else sender
    msg = f"""📩 新短信
━━━━━━━━━━━━━━━
来自：{contact_info}
━━━━━━━━━━━━━━━
{content}"""
    return _wechat_send(msg)


def _wechat_send(message: str, target: str = None) -> bool:
    target = target or WECHAT_CFG['target']
    channel = WECHAT_CFG['channel']
    try:
        result = subprocess.run([
            'openclaw', 'message', 'send',
            '--channel', channel,
            '--target', target,
            '--message', message
        ], capture_output=True, text=True, timeout=15)
        if result.returncode == 0 and ('Sent' in result.stdout or 'sent' in result.stdout.lower()):
            log.info("微信推送成功")
            return True
        else:
            log.error(f"微信推送失败: {result.stderr or result.stdout}")
            return False
    except Exception as e:
        log.error(f"微信推送异常: {e}")
        return False
