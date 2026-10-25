-- Dev only. The test database lives in the same container, and `prisma migrate dev` needs to
-- create a temporary shadow database, hence the global grant.
CREATE DATABASE IF NOT EXISTS focentra_test;
GRANT ALL PRIVILEGES ON *.* TO 'focentra_app'@'%';
FLUSH PRIVILEGES;
