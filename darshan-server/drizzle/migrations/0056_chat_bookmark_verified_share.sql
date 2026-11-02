ALTER TABLE chat_bookmarks
  ADD COLUMN IF NOT EXISTS share_authorized_at timestamp;
