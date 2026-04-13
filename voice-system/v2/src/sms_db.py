"""
sms_db.py - 短信存储 CRUD
"""
from typing import Optional, List
from src.db import get_cursor
from src.contacts_db import normalize_phone, contact_get
from datetime import datetime


def sms_save(phone: str, content: str, direction: str,
             encoding: str = 'UCS-2', status: str = 'received',
             sms_at: datetime = None) -> int:
    """保存短信，返回新ID"""
    phone_norm = normalize_phone(phone)
    contact = contact_get(phone)
    contact_id = contact['id'] if contact else None

    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO voice_sms
                (phone, contact_id, direction, content, encoding, status, sms_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
            RETURNING id
        """, (phone, contact_id, direction, content, encoding, status,
              sms_at or datetime.now()))
        return cur.fetchone()['id']


def sms_list(limit: int = 50, phone: str = None) -> List[dict]:
    """查询短信历史"""
    with get_cursor() as cur:
        if phone:
            phone_norm = normalize_phone(phone)
            cur.execute("""
                SELECT s.*, c.name as contact_name
                FROM voice_sms s
                LEFT JOIN voice_contacts c ON s.contact_id = c.id
                WHERE s.phone = %s
                ORDER BY s.created_at DESC
                LIMIT %s
            """, (phone, limit))
        else:
            cur.execute("""
                SELECT s.*, c.name as contact_name
                FROM voice_sms s
                LEFT JOIN voice_contacts c ON s.contact_id = c.id
                ORDER BY s.created_at DESC
                LIMIT %s
            """, (limit,))
        return cur.fetchall()
