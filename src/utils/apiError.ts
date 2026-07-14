import type { Response } from 'express';
import logger from '../logger';

export function isDevelopmentMode() {
  return process.env.NODE_ENV === 'development';
}

export function isMissingRelationError(error: unknown, relationName?: string) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  if (relationName && message.includes(`relation "${relationName}" does not exist`)) {
    return true;
  }

  return message.includes('does not exist') && message.includes('relation');
}

export function formatServerError(error: unknown, fallbackMessage: string) {
  const message = error instanceof Error ? error.message : fallbackMessage;

  if (isDevelopmentMode()) {
    return {
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
    };
  }

  return {
    error: fallbackMessage,
  };
}

export function sendServerError(res: Response, error: unknown, fallbackMessage: string) {
  logger.error(fallbackMessage, error);
  return res.status(500).json(formatServerError(error, fallbackMessage));
}
