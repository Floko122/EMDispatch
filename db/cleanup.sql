-- Deletes whole sessions (and all related data via ON DELETE CASCADE)
-- that have had no activity for the past hour.
-- "Activity" = max of sessions.updated_at, last activity_logs.created_at, last commands.created_at

DELETE s
FROM sessions s
LEFT JOIN (
  SELECT session_id, MAX(created_at) AS last_log
  FROM activity_logs
  GROUP BY session_id
) l ON l.session_id = s.id
LEFT JOIN (
  SELECT session_id, MAX(created_at) AS last_cmd
  FROM commands
  GROUP BY session_id
) c ON c.session_id = s.id
WHERE GREATEST(
  IFNULL(s.updated_at, '1970-01-01'),
  IFNULL(l.last_log, '1970-01-01'),
  IFNULL(c.last_cmd, '1970-01-01')
) < (NOW() - INTERVAL 1 HOUR);
