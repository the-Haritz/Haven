// Express server entry point.
// Note: Config import must stay first so dotenv variables are loaded and validated
// before any other modules initialize.

import { config } from './infrastructure/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { routes } from './api/routes';
import { requestLogger, errorHandler } from './api/middleware';
import { logger } from './infrastructure/logger';

const app = express();

// Standard middleware setup
app.use(helmet());           // Basic security headers
app.use(cors());             // Cross-origin resource sharing
app.use(express.json());     // JSON request body parser
app.use(requestLogger);      // API performance logger

// ─── Routes ──────────────────────────────────────────────────────────
app.use('/api', routes);

// Global error catcher (Express requires this to be registered last)
app.use(errorHandler);

// ─── Start Server ────────────────────────────────────────────────────
app.listen(config.port, () => {
  logger.info(`🚀 Haven MVP Server running on http://localhost:${config.port}`, {
    environment: config.nodeEnv,
    chain: 'Base Sepolia',
    logLevel: config.logLevel,
  });
});
