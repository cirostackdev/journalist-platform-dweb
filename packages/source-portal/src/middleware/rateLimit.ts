import type { Request, Response, NextFunction } from "express"

type RateLimitOptions = {
  maxRequests: number
  windowMs: number
  keyExtractor?: (req: Request) => string
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
    const key = opts.keyExtractor ? opts.keyExtractor(req) : (req.ip ?? "unknown")
    const now = Date.now()

    // Lazy eviction: clean up expired entries to prevent unbounded growth
    for (const [k, val] of store) {
      if (now - val.windowStart > opts.windowMs) {
        store.delete(k)
      }
    }

    const entry = store.get(key)

    if (!entry) {
      store.set(key, { count: 1, windowStart: now })
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
