-- ============================================================
-- seed.sql
-- Default settings for proxy-manager-telebot
-- ============================================================

INSERT INTO settings (key, value, description) VALUES
    ('default_rate_limit_hourly', '5', 'Default hourly proxy request limit for new users'),
    ('default_rate_limit_daily', '20', 'Default daily proxy request limit for new users'),
    ('default_rate_limit_total', '100', 'Default total proxy request limit for new users'),
    ('default_approval_mode', '"manual"', 'Default approval mode for new users (auto or manual)'),
    ('auto_clean_trash_days', '30', 'Number of days before permanently cleaning soft-deleted records'),
    ('telegram_bot_token', '""', 'Telegram bot API token'),
    ('telegram_webhook_secret', '""', 'Secret used to verify Telegram webhook requests')
ON CONFLICT (key) DO NOTHING;
