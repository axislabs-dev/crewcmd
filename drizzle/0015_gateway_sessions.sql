CREATE TABLE IF NOT EXISTS gateway_sessions (
  key TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  spawned_by_key TEXT,
  kind TEXT NOT NULL,
  label TEXT,
  title TEXT,
  last_message_preview TEXT,
  updated_at TIMESTAMP WITH TIME ZONE,
  token_usage JSONB,
  model TEXT,
  model_provider TEXT,
  session_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gateway_sessions_agent ON gateway_sessions(agent_id);
CREATE INDEX IF NOT EXISTS idx_gateway_sessions_spawned ON gateway_sessions(spawned_by_key);
CREATE INDEX IF NOT EXISTS idx_gateway_sessions_updated ON gateway_sessions(updated_at DESC);
