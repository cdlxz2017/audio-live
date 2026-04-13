-- 4G语音通讯系统 v2 数据库初始化脚本
-- 运行: psql postgresql://openclaw_ai:zyxrcy910128@localhost:5432/openclaw_memory -f init.sql

-- ============================================================
-- 模块1: 通讯录
-- ============================================================
CREATE TABLE IF NOT EXISTS voice_contacts (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    phone_normalized VARCHAR(20) NOT NULL,
    relationship VARCHAR(20) DEFAULT '其他',
    importance SMALLINT DEFAULT 0,  -- 0=普通 1=重要 2=紧急
    is_blacklist BOOLEAN DEFAULT FALSE,
    is_whitelist BOOLEAN DEFAULT FALSE,
    notes TEXT,
    call_count INTEGER DEFAULT 0,
    last_call_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vc_phone_norm ON voice_contacts(phone_normalized);
CREATE INDEX IF NOT EXISTS idx_vc_blacklist ON voice_contacts(is_blacklist) WHERE is_blacklist = TRUE;
CREATE INDEX IF NOT EXISTS idx_vc_name_trgm ON voice_contacts USING gin(name gin_trgm_ops);

-- ============================================================
-- 模块2: 通话记录
-- ============================================================
CREATE TABLE IF NOT EXISTS voice_calls (
    id BIGSERIAL PRIMARY KEY,
    contact_id INTEGER REFERENCES voice_contacts(id) ON DELETE SET NULL,
    phone VARCHAR(20) NOT NULL,
    direction VARCHAR(10) NOT NULL,  -- inbound / outbound
    duration INTEGER DEFAULT 0,       -- 秒
    status VARCHAR(20) DEFAULT 'completed',  -- completed / missed / failed
    transcript TEXT,
    summary TEXT,
    recording_path VARCHAR(500),
    quality_ok BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vcalls_created ON voice_calls(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vcalls_contact ON voice_calls(contact_id);
CREATE INDEX IF NOT EXISTS idx_vcalls_phone ON voice_calls(phone);

-- ============================================================
-- 模块4: 短信
-- ============================================================
CREATE TABLE IF NOT EXISTS voice_sms (
    id BIGSERIAL PRIMARY KEY,
    contact_id INTEGER REFERENCES voice_contacts(id) ON DELETE SET NULL,
    phone VARCHAR(20) NOT NULL,
    direction VARCHAR(10) NOT NULL,  -- inbound / outbound
    content TEXT,
    encoding VARCHAR(20),            -- UCS-2 / 7-bit / GSM
    status VARCHAR(20) DEFAULT 'received',  -- received / sent / failed
    sms_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vsms_contact ON voice_sms(contact_id);
CREATE INDEX IF NOT EXISTS idx_vsms_created ON voice_sms(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vsms_phone ON voice_sms(phone);

-- ============================================================
-- 触发器: updated_at 自动更新
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
    CREATE TRIGGER trg_voice_contacts_updated_at
        BEFORE UPDATE ON voice_contacts
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
