#!/usr/bin/env python3
"""
test_basic.py - 基础功能测试
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

def test_normalize():
    from src.contacts_db import normalize_phone
    assert normalize_phone('+86 139-8081-9087') == '13980819087'
    assert normalize_phone('8613980819087') == '13980819087'
    assert normalize_phone('13980819087') == '13980819087'
    print("✅ test_normalize")

def test_contacts_add():
    from src.contacts_db import contact_add, contact_delete, contact_get
    contact_add('测试用户', '13800000000', '朋友', 0)
    c = contact_get('13800000000')
    assert c is not None
    assert c['name'] == '测试用户'
    contact_delete('13800000000')
    print("✅ test_contacts_add")

def test_sms_save():
    from src.sms_db import sms_save
    sid = sms_save('13800000000', '测试短信', 'inbound')
    assert sid > 0
    print("✅ test_sms_save")

def test_tts():
    from src.tts_client import generate_tts
    import tempfile
    path = generate_tts('你好，这是测试')
    assert path is not None
    print(f"✅ test_tts: {path}")

def test_config():
    from src.config import config
    assert config['database']['url']
    assert config['serial']['at_port']
    print("✅ test_config")

if __name__ == '__main__':
    test_config()
    test_normalize()
    test_contacts_add()
    test_sms_save()
    test_tts()
    print("\n全部测试通过！")
