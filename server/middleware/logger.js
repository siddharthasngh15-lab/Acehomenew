/**
 * Request Logger Middleware
 * Logs all API requests with method, path, status, and duration
 */

export const requestLogger = (req, res, next) => {
  const start = Date.now();
  const timestamp = new Date().toISOString();

  // Log request
  console.log(`[${timestamp}] ${req.method} ${req.path}`);

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusColor = res.statusCode >= 400 ? '❌' : res.statusCode >= 300 ? '⚠️' : '✅';
    console.log(`${statusColor} [${timestamp}] ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
  });

  next();
};

/**
 * Error Logger
 * Logs errors with stack trace in development
 */
export const errorLogger = (err, req, res, next) => {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ERROR:`, {
    method: req.method,
    path: req.path,
    error: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
  next(err);
};

