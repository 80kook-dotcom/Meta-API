/**
 * 앱↔중계 공유 시크릿 인증 hook (codex #16).
 * config.security.relaySharedSecret 설정 시 /api 요청에 x-relay-secret 헤더를 강제.
 * 미설정(개발 기본)이면 통과.
 *
 * ⚠ 공개 SPA에선 시크릿이 완전 비밀이 될 수 없다(번들에 노출) → 임시 남용 억제용.
 *    운영 본인증은 세션/Cloudflare Access/리버스프록시로(S6).
 */
import { config } from '../config.js'

export function relayAuth(req, res, next) {
  const secret = config.security.relaySharedSecret
  if (!secret) return next()
  if (req.headers['x-relay-secret'] === secret) return next()
  res.status(401).json({ error: 'UNAUTHORIZED', message: '중계 접근 권한이 없습니다.' })
}
