process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://sigp:sigp@localhost:5432/sigp_test';
process.env.JWT_SECRET = 'test-secret';
