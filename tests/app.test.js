jest.mock('../src/db', () => ({
  query: jest.fn(),
  pool: {},
}));

const request = require('supertest');
const createApp = require('../src/app');
const db = require('../src/db');

describe('createApp', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET / responds with running message', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/running/i);
  });

  it('GET /health returns 200 when database is reachable', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const app = createApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, database: 'connected' });
  });

  it('GET /health returns 503 when database errors', async () => {
    db.query.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const app = createApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.database).toBe('disconnected');
  });

  it('GET /unknown returns 404', async () => {
    const app = createApp();
    const res = await request(app).get('/no-such-route');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not found.');
  });
});
