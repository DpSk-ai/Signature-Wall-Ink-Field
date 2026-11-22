-- Signature Wall 数据库索引迁移
-- 目的: 优化高频查询性能

-- 1. request_id 索引 (幂等性查询)
-- UNIQUE 约束已经隐式创建了索引,但显式声明更清晰
CREATE INDEX IF NOT EXISTS idx_signatures_request_id ON signatures(request_id);

-- 2. status 索引 (查询待处理签名)
-- 用于 WHERE status='queued' 或 WHERE status!='complete' 查询
CREATE INDEX IF NOT EXISTS idx_signatures_status ON signatures(status);

-- 3. hidden 索引 (过滤可见签名)
-- 用于 WHERE hidden=0 查询
CREATE INDEX IF NOT EXISTS idx_signatures_hidden ON signatures(hidden);

-- 4. 复合索引 (最常见的查询模式)
-- 用于 WHERE hidden=0 AND status!='complete' ORDER BY created_at
CREATE INDEX IF NOT EXISTS idx_signatures_visibility_status ON signatures(hidden, status, created_at);

-- 验证索引
-- SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='signatures';
