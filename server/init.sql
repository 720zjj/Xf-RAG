CREATE DATABASE IF NOT EXISTS iflytek_translator DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE iflytek_translator;

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(50) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  nickname VARCHAR(50) DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 文档表
CREATE TABLE IF NOT EXISTS documents (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  filename VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  file_type VARCHAR(20) NOT NULL COMMENT 'pdf, doc, docx, md, txt',
  file_size BIGINT DEFAULT 0,
  file_path VARCHAR(500) NOT NULL,
  file_hash CHAR(64) DEFAULT NULL COMMENT '原始文件 SHA-256，用于同一用户去重',
  content LONGTEXT COMMENT '提取的文本内容',
  chunk_count INT DEFAULT 0 COMMENT '语义块数量',
  status TINYINT DEFAULT 0 COMMENT '0=处理中 1=已完成 2=失败 3=排队 4=已取消',
  mineru_task_id VARCHAR(100) DEFAULT NULL COMMENT 'MinerU任务ID',
  mineru_batch_id VARCHAR(100) DEFAULT NULL COMMENT 'MinerU批次ID',
  mineru_zip_url VARCHAR(500) DEFAULT NULL COMMENT 'MinerU结果zip地址',
  mineru_pages INT DEFAULT 0 COMMENT '解析页数',
  mineru_model VARCHAR(20) DEFAULT 'pipeline' COMMENT '解析模型',
  processing_started_at DATETIME DEFAULT NULL,
  error_message VARCHAR(1000) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_documents_user (user_id, created_at),
  UNIQUE INDEX uq_documents_user_file_hash (user_id, file_hash),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 文档解析后台任务表
CREATE TABLE IF NOT EXISTS document_jobs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  document_id INT NOT NULL,
  user_id INT NOT NULL,
  job_type VARCHAR(20) NOT NULL DEFAULT 'parse',
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  progress TINYINT NOT NULL DEFAULT 0,
  stage VARCHAR(30) NOT NULL DEFAULT 'queued',
  attempts_made INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  cancel_requested TINYINT(1) NOT NULL DEFAULT 0,
  queue_job_id VARCHAR(64) DEFAULT NULL,
  error_message VARCHAR(1000) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME DEFAULT NULL,
  finished_at DATETIME DEFAULT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_dj_document_created (document_id, created_at),
  INDEX idx_dj_user_created (user_id, created_at),
  INDEX idx_dj_active (status, created_at),
  UNIQUE INDEX uq_dj_queue_job (queue_job_id),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 翻译记录表
CREATE TABLE IF NOT EXISTS translations (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  source_text TEXT NOT NULL,
  target_text TEXT NOT NULL,
  source_lang VARCHAR(10) NOT NULL,
  target_lang VARCHAR(10) NOT NULL,
  document_id INT DEFAULT NULL COMMENT '关联文档（可选）',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_translations_user (user_id, created_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- RAG 问答记录表
CREATE TABLE IF NOT EXISTS rag_qa (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  document_id INT DEFAULT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  sources JSON COMMENT '参考来源（JSON数组）',
  bm25_scores JSON COMMENT 'BM25评分（JSON数组）',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rag_qa_user (user_id, created_at),
  INDEX idx_rag_qa_document (document_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- 文档语义块 + 向量表（本地 embedding 向量化，用于语义检索）
CREATE TABLE IF NOT EXISTS document_chunks (
  id INT PRIMARY KEY AUTO_INCREMENT,
  document_id INT NOT NULL,
  user_id INT NOT NULL,
  chunk_index INT NOT NULL COMMENT '块在文档内的顺序',
  content MEDIUMTEXT NOT NULL COMMENT '块文本',
  embedding MEDIUMTEXT NOT NULL COMMENT '句向量（JSON 数组）',
  -- 结构化元数据（用于检索前置过滤）
  brand VARCHAR(50) DEFAULT '科大讯飞' COMMENT '品牌',
  product_line VARCHAR(50) DEFAULT '翻译机' COMMENT '产品线',
  product_model VARCHAR(100) DEFAULT '' COMMENT '产品型号',
  firmware_version VARCHAR(50) DEFAULT '' COMMENT '固件版本',
  document_type VARCHAR(50) DEFAULT '' COMMENT '文档类型：用户操作手册/快速入门指南/产品功能说明/售后FAQ/安全说明',
  document_version VARCHAR(50) DEFAULT '' COMMENT '文档版本',
  chapter VARCHAR(100) DEFAULT '' COMMENT '所属章节',
  content_type VARCHAR(50) DEFAULT 'general' COMMENT '内容类型：operation/faq/safety/feature/general',
  risk_level VARCHAR(20) DEFAULT 'low' COMMENT '风险等级：low/medium/high',
  effective_status VARCHAR(20) DEFAULT 'active' COMMENT '生效状态：active/deprecated',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_dc_doc (document_id),
  INDEX idx_dc_user (user_id),
  INDEX idx_dc_product (product_line, product_model),
  INDEX idx_dc_type (content_type),
  INDEX idx_dc_status (effective_status),
  UNIQUE INDEX uq_dc_document_chunk (document_id, chunk_index),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- SOP 结构化操作表
CREATE TABLE IF NOT EXISTS sops (
  id INT PRIMARY KEY AUTO_INCREMENT,
  title VARCHAR(255) NOT NULL,
  brand VARCHAR(50) DEFAULT '科大讯飞',
  product_line VARCHAR(50) DEFAULT '翻译机',
  product_model VARCHAR(100) DEFAULT '',
  firmware_version VARCHAR(50) DEFAULT '',
  category VARCHAR(50) DEFAULT '',
  prerequisites JSON,
  warnings JSON,
  steps JSON NOT NULL,
  completion_check VARCHAR(500) DEFAULT '',
  common_errors JSON,
  source_document VARCHAR(255) DEFAULT '',
  source_pages VARCHAR(100) DEFAULT '',
  difficulty VARCHAR(20) DEFAULT 'easy',
  estimated_duration INT DEFAULT 0,
  review_status VARCHAR(20) DEFAULT 'draft',
  created_by INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_sop_product (product_line, product_model),
  INDEX idx_sop_category (category),
  INDEX idx_sop_status (review_status),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- RAG 回答可信度追溯、实际使用证据与用户反馈
CREATE TABLE IF NOT EXISTS rag_answer_traces (
  id CHAR(36) PRIMARY KEY,
  qa_id INT DEFAULT NULL,
  user_id INT NOT NULL,
  endpoint VARCHAR(32) NOT NULL,
  question_snapshot TEXT NOT NULL,
  effective_question TEXT DEFAULT NULL,
  product_line VARCHAR(50) DEFAULT '',
  product_model VARCHAR(100) DEFAULT '',
  trust_level VARCHAR(20) NOT NULL,
  reason_code VARCHAR(64) NOT NULL,
  threshold_version VARCHAR(64) DEFAULT NULL,
  retrieval_ms INT DEFAULT NULL,
  rerank_ms INT DEFAULT NULL,
  generation_ms INT DEFAULT NULL,
  total_ms INT DEFAULT NULL,
  metadata JSON,
  prompt_tokens INT DEFAULT NULL,
  completion_tokens INT DEFAULT NULL,
  total_tokens INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rat_user_created (user_id, created_at),
  INDEX idx_rat_decision_created (trust_level, reason_code, created_at),
  FOREIGN KEY (qa_id) REFERENCES rag_qa(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rag_answer_evidence (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  trace_id CHAR(36) NOT NULL,
  evidence_id VARCHAR(16) NOT NULL,
  source_type VARCHAR(32) NOT NULL,
  document_id INT DEFAULT NULL,
  chunk_id INT DEFAULT NULL,
  sop_id INT DEFAULT NULL,
  source_title VARCHAR(255) NOT NULL,
  excerpt MEDIUMTEXT NOT NULL,
  retrieval_score DECIMAL(10,6) DEFAULT NULL,
  rerank_score DECIMAL(10,6) DEFAULT NULL,
  factors JSON,
  selection_reason VARCHAR(32) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE INDEX uq_rae_trace_evidence (trace_id, evidence_id),
  INDEX idx_rae_trace (trace_id),
  FOREIGN KEY (trace_id) REFERENCES rag_answer_traces(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL,
  FOREIGN KEY (chunk_id) REFERENCES document_chunks(id) ON DELETE SET NULL,
  FOREIGN KEY (sop_id) REFERENCES sops(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rag_answer_feedback (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  trace_id CHAR(36) NOT NULL,
  qa_id INT DEFAULT NULL,
  user_id INT NOT NULL,
  outcome VARCHAR(16) NOT NULL,
  reason_code VARCHAR(64) DEFAULT NULL,
  comment VARCHAR(1000) DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE INDEX uq_raf_user_trace (user_id, trace_id),
  INDEX idx_raf_outcome_created (outcome, created_at),
  FOREIGN KEY (trace_id) REFERENCES rag_answer_traces(id) ON DELETE CASCADE,
  FOREIGN KEY (qa_id) REFERENCES rag_qa(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 视频元数据表
CREATE TABLE IF NOT EXISTS videos (
  id INT PRIMARY KEY AUTO_INCREMENT,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  brand VARCHAR(50) DEFAULT '科大讯飞',
  product_line VARCHAR(50) DEFAULT '翻译机',
  product_model VARCHAR(100) DEFAULT '',
  firmware_version VARCHAR(50) DEFAULT '',
  category VARCHAR(50) DEFAULT '',
  tags JSON,
  duration_seconds INT DEFAULT 0,
  video_url VARCHAR(500) DEFAULT '',
  thumbnail_url VARCHAR(500) DEFAULT '',
  source_provider VARCHAR(50) NOT NULL DEFAULT 'local',
  external_id VARCHAR(160) DEFAULT NULL,
  source_page_url VARCHAR(700) DEFAULT '',
  source_priority SMALLINT NOT NULL DEFAULT 0,
  source_sop_id INT DEFAULT NULL,
  review_status VARCHAR(20) DEFAULT 'draft',
  publish_status VARCHAR(20) DEFAULT 'unpublished',
  view_count INT DEFAULT 0,
  resolve_count INT DEFAULT 0,
  created_by INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_video_product (product_line, product_model),
  INDEX idx_video_category (category),
  INDEX idx_video_status (review_status, publish_status),
  UNIQUE INDEX uq_video_external_source (source_provider, external_id),
  FOREIGN KEY (source_sop_id) REFERENCES sops(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS video_chapters (
  id INT PRIMARY KEY AUTO_INCREMENT,
  video_id INT NOT NULL,
  chapter_index INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  start_time DECIMAL(8,2) NOT NULL,
  end_time DECIMAL(8,2) DEFAULT NULL,
  step_number INT DEFAULT NULL,
  keywords VARCHAR(500) DEFAULT '',
  UNIQUE INDEX uq_video_chapter (video_id, chapter_index),
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS video_qa_links (
  id INT PRIMARY KEY AUTO_INCREMENT,
  video_id INT NOT NULL,
  qa_id INT DEFAULT NULL,
  user_id INT NOT NULL,
  action VARCHAR(20) DEFAULT 'recommend',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_vqa_video (video_id),
  INDEX idx_vqa_user (user_id),
  UNIQUE INDEX uq_vqa_action (video_id, user_id, action),
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
  FOREIGN KEY (qa_id) REFERENCES rag_qa(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS support_channels (
  id INT PRIMARY KEY AUTO_INCREMENT,
  channel_code VARCHAR(80) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  product_line VARCHAR(50) NOT NULL,
  product_model VARCHAR(100) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE INDEX uq_support_channels_code (channel_code),
  UNIQUE INDEX uq_support_channels_creator_product (created_by, product_line, product_model),
  INDEX idx_support_channels_creator_active (created_by, is_active, updated_at),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
