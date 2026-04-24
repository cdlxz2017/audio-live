-- Memory System Rebuild: 001_init.sql
-- 重建所有核心表 + pgvector HNSW 索引
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. memories — 结构化 entity/attribute/value 记忆
CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  user_id UUID NOT NULL,
  session_id UUID,
  message_index INTEGER,
  entity TEXT NOT NULL,
  attribute TEXT NOT NULL,
  value TEXT NOT NULL,
  raw_text TEXT,
  content TEXT,
  memory_type VARCHAR(20) NOT NULL DEFAULT 'factual' CHECK (memory_type IN ('factual','preference','event')),
  embedding vector(1024),
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.8 CHECK (confidence >= 0 AND confidence <= 1),
  superseded_by UUID REFERENCES memories(id),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  source VARCHAR(50) DEFAULT 'realtime',
  schema_version INTEGER DEFAULT 2,
  backfill_at TIMESTAMPTZ,
  source_message_id BIGINT,
  last_recalled_at TIMESTAMPTZ,
  value_score DOUBLE PRECISION DEFAULT 0.5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, session_id, message_index, entity, attribute)
);
CREATE INDEX IF NOT EXISTS idx_memories_embedding_hnsw ON memories USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64);
CREATE INDEX IF NOT EXISTS idx_memories_user ON memories (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_session ON memories (session_id);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories (memory_type);
CREATE INDEX IF NOT EXISTS idx_memories_active ON memories (is_active) WHERE is_active = TRUE;

-- 2. memory_summaries — 会话摘要
CREATE TABLE IF NOT EXISTS memory_summaries (
  id BIGSERIAL PRIMARY KEY,
  summary TEXT NOT NULL,
  summary_type VARCHAR(50) NOT NULL DEFAULT 'default',
  source_message_ids BIGINT[],
  source_session_id VARCHAR(100),
  time_range_start TIMESTAMPTZ,
  time_range_end TIMESTAMPTZ,
  embedding vector(1024),
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.8,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB DEFAULT '{}',
  content_hash VARCHAR(32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_memory_summaries_embedding_hnsw ON memory_summaries USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64);
CREATE INDEX IF NOT EXISTS idx_memory_summaries_created ON memory_summaries (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_summaries_session ON memory_summaries (source_session_id);
CREATE INDEX IF NOT EXISTS idx_memory_summaries_type ON memory_summaries (summary_type);

-- 3. personal_memories — 原始内容记忆
CREATE TABLE IF NOT EXISTS personal_memories (
  id BIGSERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'general',
  insight_type VARCHAR(50) NOT NULL DEFAULT 'general',
  embedding vector(1024),
  embedding_model VARCHAR(50) NOT NULL DEFAULT 'bge-m3',
  source_ids JSONB DEFAULT '[]',
  origin_session_id VARCHAR(100),
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.8,
  value_score DOUBLE PRECISION DEFAULT 0.5,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_personal_memories_embedding_hnsw ON personal_memories USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64);
CREATE INDEX IF NOT EXISTS idx_personal_memories_category ON personal_memories (category);
CREATE INDEX IF NOT EXISTS idx_personal_memories_created ON personal_memories (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_personal_memories_session ON personal_memories (origin_session_id);

-- 4. conversation_messages — 会话消息
CREATE TABLE IF NOT EXISTS conversation_messages (
  id BIGSERIAL PRIMARY KEY,
  session_id VARCHAR(100) NOT NULL,
  turn_index INTEGER NOT NULL DEFAULT 0,
  role VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  message_type VARCHAR(20) DEFAULT 'chat',
  channel VARCHAR(50),
  sender_id VARCHAR(100),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, turn_index, role)
);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_session ON conversation_messages (session_id, turn_index);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_role ON conversation_messages (role);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_created ON conversation_messages (created_at DESC);

-- 5. recall_logs — 召回日志
CREATE TABLE IF NOT EXISTS recall_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID,
  session_id UUID,
  query_text TEXT NOT NULL,
  query_embedding vector(1024),
  recalled_ids BIGINT[] NOT NULL DEFAULT '{}',
  recalled_sources TEXT[],
  scores DOUBLE PRECISION[] NOT NULL DEFAULT '{}',
  latency_ms INTEGER NOT NULL,
  feedback SMALLINT,
  intent VARCHAR(50) DEFAULT 'DEFAULT',
  sender_id_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recall_logs_tenant ON recall_logs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recall_logs_user ON recall_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recall_logs_intent ON recall_logs (intent);

-- 6. conversation_sessions — 会话元数据（可选辅助表）
CREATE TABLE IF NOT EXISTS conversation_sessions (
  id VARCHAR(100) PRIMARY KEY,
  session_key VARCHAR(200),
  title TEXT,
  topics TEXT[],
  l0_summary TEXT,
  l1_summary TEXT,
  message_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. summary_message_links — 摘要与消息关联
CREATE TABLE IF NOT EXISTS summary_message_links (
  summary_id BIGINT NOT NULL,
  message_id BIGINT NOT NULL,
  PRIMARY KEY (summary_id, message_id)
);

-- 8. session_summary_cursor — 摘要提取游标
CREATE TABLE IF NOT EXISTS session_summary_cursor (
  session_id VARCHAR(100) PRIMARY KEY,
  last_message_id BIGINT NOT NULL DEFAULT 0,
  last_extracted_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. memory_outbox — 记忆发件箱（用于异步处理）
CREATE TABLE IF NOT EXISTS memory_outbox (
  id BIGSERIAL PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);
