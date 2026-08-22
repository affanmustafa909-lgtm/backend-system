import type { NextFunction, Request, Response } from "express";

type Waiter = {
  resolve: () => void;
};

/**
 * Soft load-shed: cap concurrent request handlers; queue overflow briefly;
 * reject with 503 when the wait queue is full. Health checks bypass the queue.
 */
export function createRequestConcurrencyMiddleware(opts?: {
  maxConcurrent?: number;
  maxQueue?: number;
}) {
  const maxConcurrent = Math.max(
    1,
    opts?.maxConcurrent ?? Number(process.env.API_MAX_CONCURRENT ?? 60),
  );
  const maxQueue = Math.max(0, opts?.maxQueue ?? Number(process.env.API_QUEUE_MAX ?? 150));

  let active = 0;
  const waiters: Waiter[] = [];

  function release(): void {
    active = Math.max(0, active - 1);
    const next = waiters.shift();
    if (next) {
      active += 1;
      next.resolve();
    }
  }

  function acquire(): Promise<"ok" | "full"> {
    if (active < maxConcurrent) {
      active += 1;
      return Promise.resolve("ok");
    }
    if (waiters.length >= maxQueue) {
      return Promise.resolve("full");
    }
    return new Promise((resolve) => {
      waiters.push({
        resolve: () => resolve("ok"),
      });
    });
  }

  return function requestConcurrencyMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const path = req.path || "";
    if (path === "/health" || path === "/health/db" || path.startsWith("/health/")) {
      next();
      return;
    }

    void acquire().then((status) => {
      if (status === "full") {
        res.setHeader("Retry-After", "1");
        res.status(503).json({
          statusCode: 503,
          message: "Server busy. Retry shortly.",
        });
        return;
      }

      let released = false;
      const done = () => {
        if (released) return;
        released = true;
        release();
      };

      res.on("finish", done);
      res.on("close", done);
      next();
    });
  };
}
