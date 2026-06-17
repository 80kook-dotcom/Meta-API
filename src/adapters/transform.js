/**
 * 어댑터 공통 변환 헬퍼 — 검색(다중)·상세(단일)·자동완성이 공유하는 순수 함수.
 * cross-cutting 결정(#5 캐시백·#7 평점)을 한곳에서 단일 척도로 강제한다(S2·S3 공통).
 */

/**
 * 투숙객 평점 정규화 (#7).
 * KAYAK 0~10 → 앱 0~5(÷2·소수1자리 반올림). -1(평점없음) → 0.
 * 앱 컴포넌트가 0~5 척도(임계 4.5/4.0/3.5·score/5*100)에 하드코딩돼 있어 ÷2 로 통일(앱 무변경).
 * ⚠ -1→0 은 '평점 없음'과 '0점'을 구분 못 함 → 호출부는 numberOfReviews 로 '평점 없음'을 별도 판단 가능.
 * @param {number} raw KAYAK guestRating (0~10 또는 -1)
 * @returns {number} 0~5 (소수1자리)
 */
export function normalizeGuestRating(raw) {
  if (typeof raw !== 'number' || raw < 0) return 0
  return Math.round((raw / 2) * 10) / 10
}

/**
 * 공급사 cashback → 앱 Cashback (#5).
 * - isDirect 또는 cashback 없음 → { type: 'NONE' }.
 * - PERCENTAGE → { type:'PERCENTAGE', value, cap?, currency? }.
 *   ⚠ 앱 타입은 {type,value}만 선언하나, cap·currency 를 **진단/전방호환 추가 필드**로 보존한다
 *   (런타임 무해·향후 아웃링크 트랙에서 cap 반영용). 리스트 카드는 율(%)만 쓰므로 과대표시 아님.
 * @param {{type?:string,value?:number,cap?:number,currency?:string}|undefined} cashback
 * @param {boolean} isDirect
 * @returns {{type:'PERCENTAGE'|'NONE', value?:number, cap?:number, currency?:string}}
 */
export function mapCashback(cashback, isDirect) {
  if (isDirect || !cashback || cashback.type !== 'PERCENTAGE' || typeof cashback.value !== 'number') {
    return { type: 'NONE' }
  }
  const out = { type: 'PERCENTAGE', value: cashback.value }
  if (typeof cashback.cap === 'number') out.cap = cashback.cap
  if (cashback.currency) out.currency = cashback.currency
  return out
}

/** KAYAK primaryPlaceType enum → 앱 PlaceType(city|region|hotel|airport|neighborhood). */
const PLACE_TYPE_MAP = {
  city: 'city',
  hotel: 'hotel',
  airport: 'airport',
  neighborhood: 'neighborhood',
  region: 'region',
  // 앱에 없는 KAYAK enum → region 으로 흡수(가이드 §3).
  country: 'region',
  touristregion: 'region',
  landmark: 'region',
  nationalpark: 'region',
  island: 'region',
  trainstation: 'region',
}
export function mapPlaceType(kayakType) {
  return PLACE_TYPE_MAP[String(kayakType).toLowerCase()] ?? 'region'
}

/**
 * 공급사 로고 약자 — 앱 TopRate.providerLogo 는 1글자 배지 가정.
 * KAYAK logo 는 이미지 URL 이라 name 첫 글자를 파생(예: '아고다'→'아'). URL 은 별도 보존.
 */
export function providerInitial(name) {
  return (String(name ?? '').trim()[0] ?? '?')
}

/** result.images[].large 배열 → string[] (빈/누락 방어). */
export function pickImages(images) {
  if (!Array.isArray(images)) return []
  return images.map((im) => im?.large).filter((u) => typeof u === 'string' && u)
}

/**
 * rates 를 1박 총액 오름차순으로 정렬한 새 배열.
 * 앱은 topRates[0] 을 대표 요금(rateOf)으로 쓰므로 최저가가 [0] 이어야 가격 필터/정렬이 맞다.
 * (KAYAK rates 순서는 최저가 우선이 아님 — 실측에서 rates[0].isCheapestRate=false 사례 확인.)
 */
export function ratesCheapestFirst(rates) {
  if (!Array.isArray(rates)) return []
  return rates.slice().sort((a, b) => (a?.totalRate ?? Infinity) - (b?.totalRate ?? Infinity))
}
