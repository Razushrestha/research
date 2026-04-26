/**
 * Vercel serverless entry: export the Express app (no app.listen).
 */
require('dotenv').config();
const createApp = require('../src/app');

const app = createApp();
module.exports = app;
