/**
 * 공통 에러 → JSON 변환 (Express 5 에러 미들웨어).
 * KayakError 는 status/code 를 그대로 전달, 그 외는 500. 비밀 키는 KayakError 단계에서
 * 이미 redact 되므로 여기서는 메시지만 노출(스택은 서버 로그로만·구조화 로깅 S6).
 */
import { config } from '../config.js'
import { KayakError } from '../kayak/client.js'
import { logger } from '../lib/logger.js'
import { scrubSecrets } from '../lib/scrub.js'

// scrubSecrets 는 lib/scrub.js 로 이동(logger 공용). 기존 import 경로 호환을 위해 re-export.
export { scrubSecrets }

// eslint-disable-next-line no-unused-vars -- Express 에러 핸들러는 인자 4개여야 인식됨
export function errorHandler(err, req, res, _next) {
  if (err instanceof KayakError) {
    if (err.status >= 500) logger.error('KayakError', { code: err.code, msg: err.message, body: scrubSecrets(err.body) })
    return res.status(err.status).json({ error: err.code, message: err.message })
  }
  // CORS 거부 등 기타.
  if (err?.message?.startsWith('CORS:')) {
    return res.status(403).json({ error: 'CORS_FORBIDDEN', message: err.message })
  }
  // 스택 트레이스는 내부 구조(경로·함수명)를 드러내므로 운영 로그엔 남기지 않는다(S6 적대리뷰 #4).
  const fields = { msg: err?.message }
  if (!config.isProduction) fields.stack = err?.stack
  logger.error('Unhandled error', fields)
  res.status(500).json({ error: 'INTERNAL_ERROR', message: '서버 내부 오류' })
}
