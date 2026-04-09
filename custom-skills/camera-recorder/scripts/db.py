#!/usr/bin/env python3
"""视频记录数据库模块"""
import psycopg2
import json
import os
import sys

def load_config():
    # config.json 在 skill 根目录，不在 scripts 子目录
    skill_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    path = os.path.join(skill_dir, "config.json")
    with open(path) as f:
        return json.load(f)

def get_connection():
    cfg = load_config()["db"]
    return psycopg2.connect(
        host=cfg["host"],
        port=cfg["port"],
        user=cfg["user"],
        password=cfg["password"],
        database=cfg["database"]
    )

def init_table():
    """创建 video_records 表"""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS video_records (
            id              BIGSERIAL PRIMARY KEY,
            filename        TEXT NOT NULL,
            filepath        TEXT NOT NULL,
            duration_sec    INTEGER,
            resolution      TEXT,
            file_size_bytes BIGINT,
            transcript      TEXT,
            transcript_status TEXT DEFAULT 'pending',
            email_sent      BOOLEAN DEFAULT false,
            email_sent_at   TIMESTAMP,
            created_at      TIMESTAMP DEFAULT NOW(),
            updated_at      TIMESTAMP DEFAULT NOW()
        );
    """)
    conn.commit()
    cur.close()
    conn.close()

def insert_record(filename, filepath, duration_sec=None, size_bytes=None):
    """插入视频记录"""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO video_records (filename, filepath, duration_sec, file_size_bytes, transcript_status)
        VALUES (%s, %s, %s, %s, 'pending')
        RETURNING id;
    """, (filename, filepath, duration_sec, size_bytes))
    rid = cur.fetchone()[0]
    conn.commit()
    cur.close()
    conn.close()
    return rid

def update_transcript(record_id, transcript):
    """更新转写内容"""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        UPDATE video_records 
        SET transcript=%s, transcript_status='done', updated_at=NOW()
        WHERE id=%s;
    """, (transcript, record_id))
    conn.commit()
    cur.close()
    conn.close()

def mark_email_sent(record_id):
    """标记邮件已发送"""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        UPDATE video_records 
        SET email_sent=true, email_sent=true, email_sent_at=NOW(), updated_at=NOW()
        WHERE id=%s;
    """, (record_id,))
    conn.commit()
    cur.close()
    conn.close()

def get_record(record_id):
    """获取记录"""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM video_records WHERE id=%s;", (record_id,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return row

def list_records(limit=10):
    """列出最近记录"""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT id, filename, duration_sec, transcript_status, email_sent, created_at
        FROM video_records ORDER BY created_at DESC LIMIT %s;
    """, (limit,))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return rows

def main():
    if len(sys.argv) < 2:
        # 默认初始化表
        init_table()
        print("OK: table initialized")
        return
    
    cmd = sys.argv[1]
    
    if cmd == "init":
        init_table()
        print("OK: table created")
    
    elif cmd == "insert" and len(sys.argv) >= 5:
        rid = insert_record(sys.argv[2], sys.argv[3], int(sys.argv[4]))
        print(f"OK: record {rid} created")
    
    elif cmd == "transcript" and len(sys.argv) >= 4:
        update_transcript(int(sys.argv[2]), sys.argv[3])
        print("OK: transcript updated")
    
    elif cmd == "email-sent" and len(sys.argv) >= 3:
        mark_email_sent(int(sys.argv[2]))
        print("OK: email sent marked")
    
    elif cmd == "list":
        rows = list_records()
        for r in rows:
            print(f"{r[0]} | {r[1]} | {r[2]}s | {r[3]} | email={'Y' if r[4] else 'N'} | {r[5]}")
    
    else:
        print("Usage: db.py [init|insert|transcript|email-sent|list]")
        sys.exit(1)

if __name__ == "__main__":
    main()
