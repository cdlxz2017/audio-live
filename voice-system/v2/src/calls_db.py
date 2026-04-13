"""
calls_db.py - 通话记录存储
"""
from typing import Optional
from src.db import get_cursor
from src.contacts_db import normalize_phone, contact_get


def call_save(phone: str, direction: str, duration: int = 0,
              status: str = 'completed', transcript: str = '',
              summary: str = '', recording_path: str = '',
              quality_ok: bool = True) -> int:
    """保存通话记录"""
    phone_norm = normalize_phone(phone)
    contact = contact_get(phone)
    contact_id = contact['id'] if contact else None

    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO voice_calls
                (phone, contact_id, direction, duration, status,
                 transcript, summary, recording_path, quality_ok)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING id
        """, (phone, contact_id, direction, duration, status,
              transcript, summary, recording_path, quality_ok))
        return cur.fetchone()['id']


def call_list(limit: int = 50):
    """查询最近通话记录"""
    with get_cursor() as cur:
        cur.execute("""
            SELECT c.*, ct.name as contact_name
            FROM voice_calls c
            LEFT JOIN voice_contacts ct ON c.contact_id = ct.id
            ORDER BY c.created_at DESC
            LIMIT %s
        """, (limit,))
        return cur.fetchall()
