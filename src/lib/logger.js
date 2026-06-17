/**
 * 구조화(JSON 라인) 로깅 — S6 운영 전환 (S5 적대리뷰 ⑨ 이관).
 *
 * 한 줄 = JSON 1건(`{t,level,svc,msg,...fields}`)으로 운영 로그 수집기(파싱·검색)에 친화적.
 * 모든 라인을 `scrubSecrets` 로 통과시켜 apiKey·sig 평문 누출을 차단한다.
 *
 * 사용처: server 기동/운영설정 검증, errorHandler(업스트림 오류), 캐시백 truncation 경고.
 */
import { scrubSecrets } from './scrub.js'

function line(level, msg, fields) {
  const rec = { t: new Date().toISOString(), level, svc: 'meta-api', msg, ...(fields ?? {}) }
  // 전체 JSON 을 scrub — 필드 어디에 apiKey/sig 가 섞여도 가려진다.
  return scrubSecrets(JSON.stringify(rec))
}

export const logger = {
  info(msg, fields) {
    console.log(line('info', msg, fields))
  },
  warn(msg, fields) {
    console.warn(line('warn', msg, fields))
  },
  error(msg, fields) {
    console.error(line('error', msg, fields))
  },
}
