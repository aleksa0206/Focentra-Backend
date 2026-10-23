import 'dotenv/config';

// Integration tests wipe tables; refuse to run against anything but a *_test database.
export default async function globalSetup() {
  if (process.env.NODE_ENV === 'test' && !process.env.DB_NAME?.endsWith('_test')) {
    throw new Error(`Refusing to run tests against database "${process.env.DB_NAME}"`);
  }
}
