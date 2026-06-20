import type { Request, Response, NextFunction } from "express"

type RateLimitOptions = {
  maxRequests: number
  windowMs: number
}

type WindowEntry = {
  count: number
  windowStart: number
}

export function createRateLimiter(opts: RateLimitOptions) {
  const store = new Map<string, WindowEntry>()

  return function rateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    const ip = req.ip ?? "unknown"
    const now = Date.now()

    // Lazy eviction: clean up expired entries to prevent unbounded growth
    for (const [key, val] of store) {
      if (now - val.windowStart > opts.windowMs) {
        store.delete(key)
      }
    }

    const entry = store.get(ip)

    if (!entry) {
      store.set(ip, { count: 1, windowStart: now })
      return next()
    }

    if (entry.count >= opts.maxRequests) {
      res.status(429).json({ error: "Too many requests. Try again later." })
      return
    }

    entry.count++
    next()
  }
}
