/**
 * Error classification for user-facing error messages.
 *
 * Transforms cryptic network errors and API failures into
 * actionable messages with suggestions and docs links.
 */

export interface ClassifiedError {
  message: string;
  suggestion: string;
  docsUrl?: string;
  retryable: boolean;
}

/** Classify a caught error into a user-friendly message. */
export function classifyError(err: unknown): ClassifiedError {
  if (!(err instanceof Error)) {
    return {
      message: String(err),
      suggestion: 'An unexpected error occurred.',
      retryable: false,
    };
  }

  const msg = err.message;

  // Network errors
  if ('code' in err) {
    const code = (err as NodeJS.ErrnoException).code;
    switch (code) {
      case 'ENOTFOUND':
        return {
          message: 'Could not resolve hostname.',
          suggestion: 'Check your internet connection and DNS settings.',
          retryable: true,
        };
      case 'ECONNRESET':
        return {
          message: 'Connection was reset by the server.',
          suggestion: 'This is usually temporary. Try again in a few seconds.',
          retryable: true,
        };
      case 'ECONNREFUSED':
        return {
          message: 'Connection refused.',
          suggestion: 'The service may be down. Try again later.',
          retryable: true,
        };
      case 'ETIMEDOUT':
        return {
          message: 'Request timed out.',
          suggestion: 'Check your network connection or try again later.',
          retryable: true,
        };
    }
  }

  // Timeout errors (from withTimeout utility)
  if (err.name === 'TimeoutError') {
    return {
      message: msg,
      suggestion:
        'The operation took too long. Check your connection and retry.',
      retryable: true,
    };
  }

  // HTTP status errors
  if (
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('Unauthorized')
  ) {
    return {
      message: 'Authentication failed.',
      suggestion:
        'Your session may have expired. Run /login to re-authenticate.',
      retryable: false,
    };
  }

  if (msg.includes('429') || msg.includes('Too Many Requests')) {
    return {
      message: 'Rate limited by the API.',
      suggestion: 'Wait a moment and try again.',
      retryable: true,
    };
  }

  if (msg.includes('500') || msg.includes('502') || msg.includes('503')) {
    return {
      message: 'Server error from Amplitude API.',
      suggestion: 'This is temporary. Try again in a few seconds.',
      retryable: true,
    };
  }

  // Default
  return {
    message: msg,
    suggestion:
      'Run with --debug for more details, or /feedback to report this issue.',
    retryable: false,
  };
}
