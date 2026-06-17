/**
 * 공통 에러 → JSON 변환 (Express 5 에러 미들웨어).
 * KayakError 는 status/code 를 그대로 전달, 그 외는 500. 비밀 키는 KayakError 단계에서
 * 이미 redact 되므로 여기서는 메시지만 노출(스택은 서버 로그로만).
 */
import { KayakError } from '../kayak/client.js'

// eslint-disable-next-line no-unused-vars -- Express 에러 핸들러는 인자 4개여야 인식됨
export function errorHandler(err, req, res, _next) {
  if (err instanceof KayakError) {
    if (err.status >= 500) console.error(`[meta-api] KayakError ${err.code}:`, err.message, err.body ?? '')
    return res.status(err.status).json({ error: err.code, message: err.message })
  }
  // CORS 거부 등 기타.
  if (err?.message?.startsWith('CORS:')) {
    return res.status(403).json({ error: 'CORS_FORBIDDEN', message: err.message })
  }
  console.error('[meta-api] Unhandled error:', err)
  res.status(500).json({ error: 'INTERNAL_ERROR', message: '서버 내부 오류' })
}
