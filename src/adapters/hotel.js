/**
 * 상세(단일) 어댑터 — KAYAK Single Hotel Search 응답 → 앱 HotelDetail (S3).
 *
 * 매핑 근거: 개발가이드 §5 + 라이브 실측(2026-06-17·노보텔 앰배서더 서울 동대문) + codex 자문(S3).
 * 결정 반영:
 *  - #11 guestRating: reviews.guestRatings.OVERALL(0~10) ÷2 → 0~5(transform.normalizeGuestRating).
 *  - #19 리뷰 items: KAYAK 개별리뷰(author/date) 미제공·실측 quotes/aspects 0건 → items=[](숨김).
 *        categories 는 guestRatings 키→한글 라벨·÷2. author/date/score 임의생성 금지(무결성·codex 동의).
 *  - #20 propertyType: 단일응답에 필드 없음(실측) → 검색 캐시(propertyTypeCache) 조회·미스 시 '숙소' 폴백.
 *  - #20 facilities: features(숫자[]) → 15버킷 {tag,label}(amenities.featuresToFacilities·codex 동의).
 *  - policies: checkin/checkout 는 HH:MM 추출(앱이 '이후/이전' 부착)·cancel code 없으면 ''(codex: 요금별
 *        hasFreeCancellation 을 호텔 공통 취소정책으로 승격 금지).
 *
 * 🔒 보안: KAYAK 응답엔 apiKey 가 평문 포함된 필드(place.href 등)가 있을 수 있다.
 *    이 어댑터는 앱 타입 안전 필드만 화이트리스트로 선택한다(href 류 미선택). bookUri 는 공개 딥링크라 보존.
 */
import { recallPropertyType } from '../lib/propertyTypeCache.js'
import { featuresToFacilities } from './amenities.js'
import { normalizeGuestRating, mapCashback, providerInitial, directProviderIndexes } from './transform.js'

// 잔여객실 불명 폴백 — hotels.js 와 동일 정책(누락을 0 으로 두면 '잔여 0개' 거짓 매진. 임계 3 초과로 미노출).
const ROOMS_UNKNOWN = 99
// 단일응답 propertyType 부재 + 검색캐시 미스 시 보수적 일반화(codex: '호텔' 하드코딩은 리조트/레지던스에 허위 가능).
const PROPERTY_TYPE_FALLBACK = '숙소'

/**
 * guestRatings 키 → 한글 라벨(고정 표시 순서). OVERALL 은 overall 로 분리(categories 에서 제외).
 * KAYAK 키 변형(SERVICE/SERVICES·CLEAN/CLEANLINESS·ROOM/ROOMS)을 같은 한글 라벨로 흡수하고,
 * 라벨 중복은 아래 dedupe 로 1개만 남긴다(앱 categories key=name·중복 시 React key 충돌 방지).
 */
const REVIEW_CATEGORY_ORDER = [
  ['LOCATION', '위치'],
  ['CLEAN', '청결도'],
  ['CLEANLINESS', '청결도'],
  ['COMFORT', '편안함'],
  ['SERVICES', '서비스'],
  ['SERVICE', '서비스'],
  ['STAFF', '직원'],
  ['VALUE', '가격 대비'],
  ['FACILITIES', '시설'],
  ['FOOD', '식사'],
  ['WIFI', '와이파이'],
  ['BREAKFAST', '조식'],
  ['ROOM', '객실'],
  ['ROOMS', '객실'],
  ['BUILDING', '건물'],
]

/** HH:MM 시간 추출 — 앱이 '15:00' 뒤에 '이후/이전'을 붙이므로 시간만 넘긴다. */
function extractPolicyTime(desc) {
  if (typeof desc !== 'string' || !desc.trim()) return ''
  const m = desc.match(/(\d{1,2}:\d{2})/)
  if (m) return m[1]
  // HH:MM 없음(예외 형식) → 후행 '이후/이전' 등 꼬리말 제거(앱 부착어와 '이후 이후' 중복 방지). 비면 원문.
  const cleaned = desc.replace(/\s*(이후|이전|부터|까지|after|before|from)\s*$/i, '').trim()
  return cleaned || desc.trim()
}

/** reviews.guestRatings → 앱 categories(0~5·한글·중복 라벨 제거·고정 순서). */
function buildReviewCategories(guestRatings) {
  if (!guestRatings || typeof guestRatings !== 'object') return []
  const out = []
  const seen = new Set()
  for (const [key, label] of REVIEW_CATEGORY_ORDER) {
    const raw = guestRatings[key]
    // KAYAK 계약 0~10 밖(NaN·Infinity·음수·>10)·중복 라벨은 카테고리에서 제외(적대리뷰 #3·이중 방어).
    if (!Number.isFinite(raw) || raw < 0 || raw > 10 || seen.has(label)) continue
    seen.add(label)
    out.push({ name: label, score: normalizeGuestRating(raw) })
  }
  return out
}

/** policies[]({code,name,description}) → 앱 {checkin,checkout,cancel}. */
function buildPolicies(policies) {
  const byCode = {}
  for (const p of Array.isArray(policies) ? policies : []) {
    if (p?.code) byCode[String(p.code).toLowerCase()] = p.description
  }
  const cancel = byCode.cancel ?? byCode.cancellation ?? byCode.cancellationpolicy
  return {
    checkin: extractPolicyTime(byCode.checkin),
    checkout: extractPolicyTime(byCode.checkout),
    // 취소정책은 문장이라 시간추출 X. KAYAK 상세에 cancel code 없으면 ''(앱이 truthy 일 때만 섹션 렌더).
    cancel: typeof cancel === 'string' ? cancel : '',
  }
}

/** 공급사 1건 → 앱 Provider(index 명시·logo 약자·logoUrl 전방호환). */
function adaptProvider(p, index) {
  const name = p?.name ?? ''
  const out = { index, name, logo: providerInitial(name), cashback: mapCashback(p?.cashback, p?.isDirect) }
  if (p?.logo) out.logoUrl = String(p.logo)
  return out
}

/** 요금 1건 → 앱 RoomRate. (isCheapestRate 는 호출부에서 전체 최저가 정합 재계산.) */
function adaptRoomRate(r) {
  return {
    providerIndex: typeof r?.providerIndex === 'number' ? r.providerIndex : -1,
    roomName: r?.roomName ?? '',
    totalRate: typeof r?.totalRate === 'number' ? r.totalRate : 0,
    isCheapestRate: !!r?.isCheapestRate,
    hasFreeCancellation: !!r?.hasFreeCancellation,
    canPayLater: !!r?.canPayLater,
    inclusions: Array.isArray(r?.inclusions) ? r.inclusions : [],
    availableRooms: typeof r?.availableRooms === 'number' ? r.availableRooms : ROOMS_UNKNOWN,
    bookUri: r?.bookUri ? String(r.bookUri) : '', // 공개 딥링크(p= 회원라벨 자리는 S4 에서 주입).
  }
}

/** images → 앱 {url,tag}. KAYAK 단일/검색 이미지엔 tag 없음(가이드 §5) → tag=''(사진탭 '모든 사진'만). */
function adaptDetailImages(images) {
  if (!Array.isArray(images)) return []
  const out = []
  for (const im of images) {
    if (typeof im?.large === 'string' && im.large) out.push({ url: im.large, tag: '' })
  }
  return out
}

/**
 * @param {*} resp KAYAK 단일 호텔 RAW 응답
 * @param {{languageCode?:string}} opts
 * @returns {object} 앱 HotelDetail
 */
export function adaptHotelDetail(resp, { languageCode = 'ko_KR' } = {}) {
  const hotelId = String(resp?.id ?? resp?.key ?? '')
  const reviews = resp?.reviews ?? {}
  const guestRatings = reviews?.guestRatings ?? {}

  // 「사이트 직접 예약」(isDirect) 공급사는 노출 정책상 제외(사용자 결정 2026-06-23).
  // 🔑 providerIndex 조인 보존: adaptProvider(p, i) 는 원본 배열 위치를 provider.index 에 박는다.
  //   따라서 map(원본 index 고정) → filter(direct 제거) 순서면 남은 provider 의 index 가 원본 위치를
  //   그대로 유지한다. results[].providerIndex 도 원본 위치를 가리키므로 인덱스 재매핑 없이
  //   priceCompare.buildProviderGroups(provider.index === r.providerIndex)의 조인이 깨지지 않는다.
  const rawProviders = Array.isArray(resp?.providers) ? resp.providers : []
  const directIdx = directProviderIndexes(rawProviders)
  const providers = rawProviders.map(adaptProvider).filter((p) => !directIdx.has(p.index))
  // 무효 요금 제외: totalRate<=0(거짓 '₩0')·providerIndex<0(공급사 조인 불가)은 가격비교에 부적합 → 드롭.
  // KAYAK 정상 응답엔 없음(실측 163건 전부 유효)·손상/부분응답 방어 + 앱 가격비교 정합(적대리뷰 #2·#4·#5).
  // + direct 공급사 요금도 함께 제외(위 노출 정책).
  const results = (Array.isArray(resp?.results) ? resp.results : [])
    .map(adaptRoomRate)
    // providerIndex 범위 가드(codex #1): rawProviders 범위를 벗어난 요금은 조인 불가 고아 → 드롭.
    .filter((r) => r.totalRate > 0 && r.providerIndex >= 0 && r.providerIndex < rawProviders.length && !directIdx.has(r.providerIndex))
  // isCheapestRate 정합: 남은 요금 중 최저가만 true(앱 '최저가' 뱃지=rep.isCheapestRate·목록 어댑터와 동일 보정).
  if (results.length) {
    const min = Math.min(...results.map((r) => r.totalRate))
    for (const r of results) r.isCheapestRate = r.totalRate === min
  }

  const overall = normalizeGuestRating(guestRatings.OVERALL)

  return {
    hotelId,
    name: resp?.translatedName || resp?.name || '', // 한글 표시 우선
    starRating: typeof resp?.starRating === 'number' && resp.starRating > 0 ? resp.starRating : 0,
    guestRating: overall, // 헤더 RatingBadge·ratingWord(0~5)
    numberOfReviews:
      typeof reviews?.numberOfReviews === 'number' && reviews.numberOfReviews > 0 ? reviews.numberOfReviews : 0,
    propertyType: recallPropertyType(hotelId, languageCode) || PROPERTY_TYPE_FALLBACK,
    location: resp?.address || '',
    description: typeof resp?.description === 'string' ? resp.description : '',
    facilities: featuresToFacilities(resp?.features),
    policies: buildPolicies(resp?.policies),
    images: adaptDetailImages(resp?.images),
    place: {
      lat: typeof resp?.latitude === 'number' ? resp.latitude : 0,
      lon: typeof resp?.longitude === 'number' ? resp.longitude : 0,
      address: resp?.address || '',
    },
    reviews: {
      overall,
      categories: buildReviewCategories(guestRatings),
      items: [], // KAYAK 개별리뷰(author/date) 미제공 → 빈 배열(#19·무결성)
    },
    providers,
    results,
    isComplete: resp?.isComplete === true,
  }
}
