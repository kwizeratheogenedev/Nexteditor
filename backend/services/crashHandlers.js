import { logger as defaultLogger } from './logger.js';

// Makes sure a crash always leaves a useful log line behind.
//
// Default behavior is unchanged from plain Node: an unhandled promise
// rejection or uncaught exception still stops the process (a process manager
// or nodemon restarts it) - it just gets logged properly first.
//
// Set KEEP_ALIVE_ON_REJECTION=1 to instead log unhandled promise rejections
// and keep serving. Reasonable for a many-user render server where one bad
// request shouldn't kill everyone else's in-flight renders, at the cost of the
// process possibly continuing in an unexpected state.
export function installCrashHandlers({ log = defaultLogger, exit = process.exit } = {}) {
  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled promise rejection', { err: reason instanceof Error ? reason : new Error(String(reason)) });
    if (process.env.KEEP_ALIVE_ON_REJECTION === '1') return;
    // Re-throw so it becomes an uncaught exception, handled just below.
    throw reason;
  });

  process.on('uncaughtException', (err) => {
    log.error('Uncaught exception - shutting down', { err });
    // Give the log line a moment to flush before exiting.
    setTimeout(() => exit(1), 200).unref?.();
  });
}
