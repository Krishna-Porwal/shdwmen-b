import pino from 'pino';
import pinoHttp from 'pino-http';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers.x-api-key', 'req.headers.apikey', 'req.headers.api_key'],
    remove: true,
  },
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
});

const consoleToLoggerMap: Record<string, string> = {
  log: 'info',
  info: 'info',
  warn: 'warn',
  error: 'error',
  debug: 'debug',
};

function patchConsoleWithLogger() {
  Object.entries(consoleToLoggerMap).forEach(([consoleMethod, loggerMethod]) => {
    const original = (console as any)[consoleMethod]?.bind(console);
    (console as any)[consoleMethod] = (...args: any[]) => {
      try {
        (logger as any)[loggerMethod](...args);
      } catch (err) {
        if (original) {
          original('Failed to forward console output to logger:', err);
          original(...args);
        }
      }
    };
  });
}

patchConsoleWithLogger();

export const requestLogger = pinoHttp({
  logger,
});

export default logger;
