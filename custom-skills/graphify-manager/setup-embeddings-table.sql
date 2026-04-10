-- C2: graphify_code_embeddings 辅助向量表
-- PostgreSQL + pgvector 1024维 HNSW 索引

-- 确保 pgvector 扩展已安装
CREATE EXTENSION IF NOT EXISTS vector;

-- 主向量表
CREATE TABLE IF NOT EXISTS graphify_code_embeddings (
    id          BIGSERIAL PRIMARY KEY,
    node_id     TEXT NOT NULL UNIQUE,          -- GraphifyCode.id（Neo4j）
    node_name   TEXT,                           -- GraphifyCode.name
    node_type   TEXT,                           -- GraphifyCode.type
    tags        TEXT,                           -- GraphifyCode.tags（逗号分隔）
    file_path   TEXT,                           -- GraphifyCode.file_path
    embed_text  TEXT,                           -- 用于生成 embedding 的文本
    embedding   vector(1024),                   -- BGE-m3 向量
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- HNSW 索引（余弦距离，bgE-m3 非归一化向量用 cosine_ops）
CREATE INDEX IF NOT EXISTS graphify_code_embeddings_hnsw_idx
    ON graphify_code_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- node_id 索引（用于 upsert 查找）
CREATE INDEX IF NOT EXISTS graphify_code_embeddings_node_id_idx
    ON graphify_code_embeddings (node_id);

-- 进度追踪表（支持断点续传）
CREATE TABLE IF NOT EXISTS graphify_embedding_backfill_progress (
    id          BIGSERIAL PRIMARY KEY,
    run_id      TEXT NOT NULL,                  -- 本次运行唯一ID
    total       BIGINT DEFAULT 0,               -- 总节点数
    processed   BIGINT DEFAULT 0,               -- 已处理数
    succeeded   BIGINT DEFAULT 0,               -- 成功写入数
    failed      BIGINT DEFAULT 0,               -- 失败数（空文本等）
    last_node_id TEXT,                          -- 最后处理的 node_id（用于续传）
    status      TEXT DEFAULT 'running',         -- running / done / failed
    started_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE graphify_code_embeddings IS 'C2: GraphifyCode 节点的 BGE-m3 向量嵌入辅助表';
COMMENT ON TABLE graphify_embedding_backfill_progress IS 'C2: 历史节点批量回填进度追踪';
