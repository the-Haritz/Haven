// Shared Express middlewares to handle request logging, error catches, and common validators.

import { Request, Response, NextFunction } from 'express';
import { isAddress } from 'viem';
import { AppError } from '../domain/errors';
import { logger } from '../infrastructure/logger';

// Simple request/response timer log. Very useful to measure latency in prod.
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  // Trigger logging after the server finishes sending the response
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP Request', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: duration,
    });
  });

  next();
}

// Global error boundary.
// - Operational errors (AppError subclasses): safely send the error string to the client.
// - Unknown errors: log the full stack trace and mask as a generic 500 error.
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  // Expected business or validation failures
  if (err instanceof AppError) {
    logger.warn('Operational error', {
      statusCode: err.statusCode,
      message: err.message,
      path: req.path,
    });

    res.status(err.statusCode).json({
      error: err.message,
    });
    return;
  }

  // Unhandled crashes or bugs
  logger.error('Unexpected error', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  res.status(500).json({
    error: 'Internal Server Error',
    // Don't leak system messages in prod
    ...(process.env.NODE_ENV === 'development' && { message: err.message }),
  });
}

// Reusable checksum validator using Viem's isAddress helper
export function isValidAddress(address: string): address is `0x${string}` {
  return isAddress(address);
}
