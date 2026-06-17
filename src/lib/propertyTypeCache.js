/**
 * propertyType 경량 캐시 — 검색(다중) → 상세 보강 (S3·#20).
 *
 * 배경: KAYAK 단일 호텔(/api/3.0/hotel) 응답에는 propertyType 필드가 **없다**(실측 2026-06-17).
 *   그러나 앱 상세 헤더가 `{starRating}성급 · {propertyType} · {location}` 로 렌더하므로
 *   propertyType 이 빈 문자열이면 "5성급 ·  · 주소" 처럼 가운데가 빈다(UX 결함).
 *
 * 설계(codex 자문 채택): 검색(다중) 어댑터가 hotelId → 한글 라벨을 여기에 적재하고,
 *   상세 어댑터가 조회한다. 앱 흐름(검색→목록→상세)에서는 대부분 hit.
 *   캐시 미스(딥링크 직접진입·서버 재시작·TTL 만료)면 상세 어댑터가 보수적 폴백('숙소')을 쓴다.
 *
 * ⚠ 이 캐시는 "표시 라벨 보강"용 best-effort 다. 미스가 무결성을 깨지 않는다(폴백이 안전).
 *   가격·요금 등 정확성이 중요한 값은 절대 여기에 의존하지 않는다.
 */

const TTL_MS = Number(process.env.PROPERTY_TYPE_TTL_MS ?? 30 * 60 * 1000) // 30분
const MAX_ENTRIES = 5000 // 무한 증식 방지(LRU 근사: 초과 시 가장 오래된 것부터 제거)

/** key = `${languageCode}:${hotelId}` → { label, expires }. */
const cache = new Map()

function keyOf(hotelId, languageCode) {
  return `${languageCode}:${hotelId}`
}

/** 검색 어댑터가 호출: hotelId 의 propertyType 라벨을 적재(빈 라벨은 무시). */
export function rememberPropertyType(hotelId, label, languageCode = 'ko_KR') {
  if (!hotelId || typeof label !== 'string' || !label.trim()) return
  const key = keyOf(hotelId, languageCode)
  // 갱신 시 재삽입으로 최신화(Map 삽입순서 = LRU 근사).
  if (cache.has(key)) cache.delete(key)
  cache.set(key, { label, expires: Date.now() + TTL_MS })
  // 상한 초과 시 오래된 것부터 제거.
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break // 방어: 빈 Map 무한루프 차단(dedupe.gc 와 동일 패턴)
    cache.delete(oldest)
  }
}

/** 상세 어댑터가 호출: hotelId 의 propertyType 라벨(없거나 만료면 undefined). */
export function recallPropertyType(hotelId, languageCode = 'ko_KR') {
  const key = keyOf(hotelId, languageCode)
  const entry = cache.get(key)
  if (!entry) return undefined
  if (entry.expires <= Date.now()) {
    cache.delete(key)
    return undefined
  }
  return entry.label
}

/** 테스트/운영 reset 용. */
export function _resetPropertyTypeCache() {
  cache.clear()
}
