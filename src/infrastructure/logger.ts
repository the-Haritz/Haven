// Winston logger setup. Structured logs are critical for Web3 backends — if a withdrawal fails
// at 3 AM, we need to easily grep logs by userId, txHash, or walletAddress.
// - Local Dev: human-readable, colorized output
// - Production: structured JSON format (machine-parseable for Datadog, ELK, CloudWatch, etc.)

import winston from 'winston';

const { combine, timestamp, printf, colorize, json } = winston.format;

// Human-readable output for running locally
const devFormat = combine(
  colorize(),
  timestamp({ format: 'HH:mm:ss' }),
  printf(({ level, message, timestamp, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} ${level}: ${message}${metaStr}`;
  })
);

// Clean JSON format for production indexers
const prodFormat = combine(
  timestamp(),
  json()
);

const isProduction = process.env.NODE_ENV === 'production';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: isProduction ? prodFormat : devFormat,
  transports: [
    new winston.transports.Console(),
  ],
  // Keep the server alive on uncaught errors (let pm2/kubernetes deal with recycling the process)
  exitOnError: false,
});
