/**
 * 단순 in-memory 슬라이딩 윈도우 rate-limit (codex #16 · 남용 억제).
 * config.security.rateLimitPerMin <= 0 이면 비활성(개발 기본). 운영 데모 전 양수로.
 *
 * ⚠ 단일 프로세스 메모리 기준. 다중 인스턴스/영속 제한은 S6에서 외부 스토어로.
 */
import { config } from '../config.js'

const WINDOW_MS = 60_000
const hits = new Map() // ip → number[] (요청 타임스탬프)

export function rateLimit(req, res, next) {
  const max = config.security.rateLimitPerMin
  if (!max || max <= 0) return next()

  const key = req.clientIp || req.ip || 'unknown'
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
  if (recent.length >= max) {
    res.setHeader('Retry-After', '60')
    return res.status(429).json({ error: 'RATE_LIMITED', message: '요청이 많습니다. 잠시 후 다시 시도하세요.' })
  }
  recent.push(now)
  hits.set(key, recent)
  next()
}
