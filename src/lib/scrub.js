/**
 * 로그·에러 본문에서 비밀 흔적을 가린다 (PUBLIC 레포·키/서명 보호).
 *
 * - `apiKey=...`  : KAYAK URL 에 박히는 검색·자동완성·정적·리포팅 공용 키.
 * - `sig=...`     : 캐시백 라벨 HMAC 서명(S6·codex 권고: query 로그 잔류 방지).
 *
 * 구조화 로깅(`lib/logger.js`)이 모든 로그 라인 JSON 을 이 함수로 통과시킨다.
 * (S2 적대리뷰에서 errorHandler 의 raw 본문 로그가 apiKey 를 흘릴 수 있어 도입했고,
 *  S6 에서 lib 로 추출 — errorHandler 는 호환을 위해 그대로 re-export 한다.)
 */
export function scrubSecrets(body) {
  if (body == null) return ''
  const s = typeof body === 'string' ? body : JSON.stringify(body)
  return s
    .replace(/(apiKey=)[^&\s"']*/gi, '$1***')
    // query 형태 sig=... (캐시백 라벨 서명) — 로그·에러에 평문 잔류 금지.
    .replace(/(\bsig=)[^&\s"']*/gi, '$1***')
}
