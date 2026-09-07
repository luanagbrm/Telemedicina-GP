-- Runs once on first MySQL container start (docker-entrypoint-initdb.d).
-- The database and app user are created by MySQL from the compose env vars;
-- here we just make sure the app user can also work with a shadow test DB.

CREATE DATABASE IF NOT EXISTS telemed_test
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

GRANT ALL PRIVILEGES ON telemed.*      TO 'telemed'@'%';
GRANT ALL PRIVILEGES ON telemed_test.* TO 'telemed'@'%';
FLUSH PRIVILEGES;
