-- Канал, в котором создано подтверждение (telegram/web/api), чтобы confirm
-- не терял его и подписка получала правильный channel.
ALTER TABLE agent_confirmations
  ADD COLUMN IF NOT EXISTS channel TEXT;
