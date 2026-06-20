import { describe, test, expect } from "bun:test"
import { createRateLimiter } from "../src/middleware/rateLimit"
import type { Request, Response, NextFunction } from "express"

function makeReq(ip: string): Request {
  return { ip } as Request
}

function makeRes() {
  const res = {
    _code: 0,
    _body: null as unknown,
    status(code: number) { res._code = code; return res },
    json(body: unknown) { res._body = body; return res },
  }
  return res
}

describe("createRateLimiter", () => {
  test("allows requests under the limit", () => {
    const limiter = createRateLimiter({ maxRequests: 3, windowMs: 60_000 })
    const req = makeReq("1.2.3.4")
    let nextCalled = 0
    const next: NextFunction = () => { nextCalled++ }

    limiter(req, makeRes() as unknown as Response, next)
    limiter(req, makeRes() as unknown as Response, next)
    limiter(req, makeRes() as unknown as Response, next)

    expect(nextCalled).toBe(3)
  })

  test("blocks the (maxRequests+1)th request from the same IP", () => {
    const limiter = createRateLimiter({ maxRequests: 2, windowMs: 60_000 })
    const req = makeReq("5.6.7.8")
    const res = makeRes()
    const next: NextFunction = () => {}

    limiter(req, makeRes() as unknown as Response, next)
    limiter(req, makeRes() as unknown as Response, next)
    limiter(req, res as unknown as Response, next) // 3rd — should block

    expect(res._code).toBe(429)
  })

  test("different IPs get independent limits", () => {
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60_000 })
    let nextCalled = 0
    const next: NextFunction = () => { nextCalled++ }

    limiter(makeReq("10.0.0.1"), makeRes() as unknown as Response, next)
    limiter(makeReq("10.0.0.2"), makeRes() as unknown as Response, next)

    expect(nextCalled).toBe(2)
  })
})
