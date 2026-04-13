"""
contacts_db.py - 通讯录 CRUD
"""
import re
from typing import Optional, List
from src.db import get_cursor


def normalize_phone(phone: str) -> str:
    """号码标准化：去+86、空格、横线、括号、点"""
    p = re.sub(r'[^\d]', '', phone)
    if p.startswith('86') and len(p) > 10:
        p = p[2:]
    return p[-11:].zfill(11)


def phone_last7(phone: str) -> str:
    """返回后7位用于模糊匹配"""
    return normalize_phone(phone)[-7:]


def contact_add(name: str, phone: str, relationship='其他',
                importance: int = 0, is_blacklist: bool = False,
                is_whitelist: bool = False, notes: str = '') -> int:
    """添加联系人，返回新ID"""
    phone_norm = normalize_phone(phone)
    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO voice_contacts
                (name, phone, phone_normalized, relationship, importance,
                 is_blacklist, is_whitelist, notes)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (phone_normalized) DO UPDATE SET
                name = EXCLUDED.name,
                relationship = EXCLUDED.relationship,
                importance = EXCLUDED.importance,
                is_blacklist = EXCLUDED.is_blacklist,
                is_whitelist = EXCLUDED.is_whitelist,
                notes = EXCLUDED.notes
            RETURNING id
        """, (name, phone, phone_norm, relationship, importance,
              is_blacklist, is_whitelist, notes))
        return cur.fetchone()['id']


def contact_get(phone: str) -> Optional[dict]:
    """通过号码查询联系人"""
    phone_norm = normalize_phone(phone)
    with get_cursor() as cur:
        cur.execute(
            "SELECT * FROM voice_contacts WHERE phone_normalized = %s",
            (phone_norm,))
        return cur.fetchone()


def contact_find_by_name(name: str) -> List[dict]:
    """通过姓名模糊搜索"""
    with get_cursor() as cur:
        cur.execute(
            "SELECT * FROM voice_contacts WHERE name ILIKE %s ORDER BY name",
            (f'%{name}%',))
        return cur.fetchall()


def contact_list() -> List[dict]:
    """列出所有联系人"""
    with get_cursor() as cur:
        cur.execute(
            "SELECT * FROM voice_contacts ORDER BY call_count DESC, name")
        return cur.fetchall()


def contact_delete(phone: str) -> bool:
    """删除联系人"""
    phone_norm = normalize_phone(phone)
    with get_cursor() as cur:
        cur.execute(
            "DELETE FROM voice_contacts WHERE phone_normalized = %s",
            (phone_norm,))
        return cur.rowcount > 0


def contact_blacklist(phone: str) -> bool:
    """加入黑名单"""
    phone_norm = normalize_phone(phone)
    with get_cursor() as cur:
        cur.execute(
            "UPDATE voice_contacts SET is_blacklist = TRUE WHERE phone_normalized = %s",
            (phone_norm,))
        return cur.rowcount > 0


def contact_whitelist(phone: str) -> bool:
    """加入白名单"""
    phone_norm = normalize_phone(phone)
    with get_cursor() as cur:
        cur.execute(
            "UPDATE voice_contacts SET is_whitelist = TRUE WHERE phone_normalized = %s",
            (phone_norm,))
        return cur.rowcount > 0


def contact_increment_call(phone: str):
    """通话计数+1，更新最后通话时间"""
    phone_norm = normalize_phone(phone)
    with get_cursor() as cur:
        cur.execute("""
            UPDATE voice_contacts
            SET call_count = call_count + 1, last_call_at = NOW()
            WHERE phone_normalized = %s
        """, (phone_norm,))


def contact_identify(phone: str) -> dict:
    """
    识别来电号码，返回联系人信息
    优先级：精确匹配 > 后7位模糊匹配
    """
    # 精确匹配
    contact = contact_get(phone)
    if contact:
        return contact

    # 后7位模糊匹配
    last7 = phone_last7(phone)
    with get_cursor() as cur:
        cur.execute("""
            SELECT * FROM voice_contacts
            WHERE phone_normalized LIKE %s
            ORDER BY importance DESC, call_count DESC
            LIMIT 1
        """, (f'%{last7}',))
        return cur.fetchone()


def contact_blacklist_check(phone: str) -> bool:
    """检查是否在黑名单"""
    contact = contact_get(phone)
    return contact and contact['is_blacklist']


def contact_whitelist_check(phone: str) -> bool:
    """检查是否在白名单"""
    contact = contact_get(phone)
    return contact and contact['is_whitelist']
