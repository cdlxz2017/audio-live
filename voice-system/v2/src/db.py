"""
db.py - PostgreSQL 连接池管理
"""
import psycopg2
from psycopg2 import pool
from psycopg2.extras import RealDictCursor
from contextlib import contextmanager
from src.config import config

_connection_pool = None


def get_pool(minconn=1, maxconn=5):
    global _connection_pool
    if _connection_pool is None:
        _connection_pool = pool.ThreadedConnectionPool(
            minconn, maxconn,
            config['database']['url']
        )
    return _connection_pool


@contextmanager
def get_conn():
    """自动归还的连接上下文"""
    p = get_pool()
    conn = p.getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        p.putconn(conn)


@contextmanager
def get_cursor(dict_cursor=True):
    """带事务的游标上下文"""
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=RealDictCursor if dict_cursor else None)
        try:
            yield cur
        finally:
            cur.close()
