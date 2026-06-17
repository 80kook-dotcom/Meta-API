/**
 * KAYAK API 패밀리별 호출 헬퍼.
 * search / autocomplete / static-feed / reporting 의 host·auth·header 차이를 한곳에 모은다.
 * (codex S0 자문 #4ⓑ + 사용자 결정 2026-06-17)
 *
 * 반환값은 RAW KAYAK 응답. 앱 타입 변환(어댑터)은 S2~.
 * S1(연결)에서 실제로 호출·검증하는 것은 autocomplete + searchHotels.
 * 나머지(searchHotel/constants/transactions)는 host·auth·header 분리를 위한 동일 패턴 빌더 —
 * 본격 매핑/캐시/상태규칙은 각 세션(S3·S2·S5)에서 채운다.
 */
import { config } from '../config.js'
import { callKayak, buildUrl, searchHeaders } from './client.js'

// 검색 결과(다중)에서 카드 구성에 필요한 옵션(가이드 §4).
const SEARCH_RESPONSE_OPTIONS = 'topRates,images,features,filter,destination'
// 검색 결과(단일·상세)에서 필요한 옵션(가이드 §5).
const HOTEL_RESPONSE_OPTIONS =
  'features,featureTags,featureSummary,images,place,reviews,description,rateBreakdown'

/**
 * 자동완성 — host=kayakHost, auth=apiKey(공용), 헤더 불필요.
 * GET {HOST}/api/affiliate/autocomplete/v1/hotels?apiKey=&searchTerm={q}
 */
export async function autocomplete({ q }) {
  const url = buildUrl(config.kayakHost, '/api/affiliate/autocomplete/v1/hotels', {
    apiKey: config.apiKey,
    searchTerm: q,
  })
  return callKayak(url) // 폴링·NDJSON 불필요
}

/**
 * 검색(다중) — host=kayakHost, auth=apiKey, 🔴 헤더 2개 필수, 비동기 폴링.
 * GET {HOST}/api/3.0/hotels?apiKey=&userTrackId=&destination=&checkin=&checkout=&rooms=
 *   &currencyCode=&languageCode=&responseOptions=&onlyIfComplete=false&includeTaxesInTotal=true
 */
export async function searchHotels({
  destination,
  checkin,
  checkout,
  rooms,
  clientIp,
  userTrackId,
  pageSize,
  currencyCode = 'KRW',
  languageCode = 'ko_KR',
}) {
  const url = buildUrl(config.kayakHost, '/api/3.0/hotels', {
    apiKey: config.apiKey,
    userTrackId,
    destination,
    checkin,
    checkout,
    rooms,
    currencyCode,
    languageCode,
    responseOptions: SEARCH_RESPONSE_OPTIONS,
    onlyIfComplete: 'false',
    includeTaxesInTotal: 'true',
    pageSize, // 미지정 시 KAYAK 기본(25). 라우트(S2)에서 250 등 지정.
  })
  return callKayak(url, { headers: searchHeaders(clientIp), poll: true })
}

/**
 * 검색(단일·상세) — searchHotels 와 동일 인증/헤더/폴링. 매핑은 S3.
 * GET {HOST}/api/3.0/hotel?...&hotel=khotel:{id}&responseOptions=...
 */
export async function searchHotel({
  hotelKey, // 예: 'khotel:3756840'
  checkin,
  checkout,
  rooms,
  clientIp,
  userTrackId,
  currencyCode = 'KRW',
  languageCode = 'ko_KR',
}) {
  const url = buildUrl(config.kayakHost, '/api/3.0/hotel', {
    apiKey: config.apiKey,
    userTrackId,
    hotel: hotelKey,
    checkin,
    checkout,
    rooms,
    currencyCode,
    languageCode,
    responseOptions: HOTEL_RESPONSE_OPTIONS,
    includeTaxesInTotal: 'true',
  })
  return callKayak(url, { headers: searchHeaders(clientIp), poll: true })
}

/**
 * 정적 데이터(constants-mapping) — host=kayakHost, auth=apiKey, 헤더 불필요, ⚠ NDJSON.
 * 캐시·라벨 매핑은 S2. 여기서는 NDJSON 파싱까지만.
 */
export async function getConstantsMapping({
  types = 'facility,property,placeType,theme,chain,imageTag',
  languageCode = 'ko_KR',
}) {
  const url = buildUrl(config.kayakHost, '/api/4.0/constants-mapping', {
    apiKey: config.apiKey,
    types,
    languageCode,
  })
  return callKayak(url, { ndjson: true })
}

/**
 * 리포팅 — host=reportingHost, auth=reportingKey, 헤더 X-Version:2.0. 상태규칙은 S5.
 * GET {REPORTING_HOST}/api/transactions/hotels?apiKey={reportingKey}&startDate=&endDate=&labels=&pageSize=
 */
export async function getTransactions({ startDate, endDate, labels, pageSize }) {
  const url = buildUrl(config.reportingHost, '/api/transactions/hotels', {
    apiKey: config.reportingKey,
    startDate,
    endDate,
    labels,
    pageSize,
  })
  return callKayak(url, { headers: { 'X-Version': '2.0' } })
}
