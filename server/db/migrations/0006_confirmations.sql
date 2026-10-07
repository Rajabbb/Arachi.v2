-- Actions the agent prepared that send messages to carriers (an RFQ, reminders,
-- the winner's notice). They only run when the user presses "Bəli" under the
-- reply, so text hidden in a document or an offer cannot make the agent send
-- email on its own. params holds the exact action shown to the user (JSON).

CREATE TABLE confirmations (
  id text PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  conversation_id bigint NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  message_id bigint REFERENCES conversation_messages (id) ON DELETE CASCADE,
  tool text NOT NULL,
  params text NOT NULL,
  summary text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  result text NOT NULL DEFAULT '',
  noted integer NOT NULL DEFAULT 0,
  created_at text NOT NULL,
  resolved_at text
);
CREATE INDEX confirmations_conversation ON confirmations (conversation_id, status);

ALTER TABLE confirmations ENABLE ROW LEVEL SECURITY;
