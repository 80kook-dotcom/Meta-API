/**
 * 검색(다중) 어댑터 — KAYAK Hotel Search 응답 → 앱 { results: Hotel[], totalCount }.
 *
 * 매핑 근거: 개발가이드 §4 + 실측(2026-06-17).
 * 결정 반영:
 *  - #4 amenities: features[](숫자ID) → 정적 버킷 라벨(adapters/amenities).
 *  - #5 cashback: provider.cashback → 앱 Cashback(transform.mapCashback·isDirect=NONE).
 *  - #7 guestRating: 0~10 → 0~5(transform.normalizeGuestRating).
 *  - #17 totalCount: 적응 후 반환 건수. KAYAK totalResults 는 serverTotalResults(진단·앱 타입 외)로 보존.
 *  - propertyType: 응답 내 propertyTypes 패싯 1차, 누락 시 constants 캐시 폴백.
 *
 * 🔒 보안: KAYAK 응답의 destination.href·result.href 에는 apiKey 가 평문 포함된다.
 *    이 어댑터는 그 필드를 **읽지 않는다**(앱 타입에 맞는 안전 필드만 선택). → 키 누출 차단.
 */
import { getPropertyLabel } from '../kayak/constants.js'
import { rememberPropertyType } from '../lib/propertyTypeCache.js'
import { featuresToAmenities } from './amenities.js'
import {
  normalizeGuestRating,
  mapCashback,
  providerInitial,
  pickImages,
  ratesCheapestFirst,
} from './transform.js'

// 잔여객실 수 불명 시 폴백. 앱은 availableRooms<=3 일 때만 '잔여 N개' 배지를 띄우므로,
// 누락을 0 으로 두면 '잔여 0개'(=거짓 매진)로 표시된다 → 임계(3) 초과값으로 폴백해 배지 미노출.
const ROOMS_UNKNOWN = 99

/** 공급사별 요금 1건 → 앱 TopRate. (isCheapestRate 는 adaptOneHotel 에서 정렬 후 재계산.) */
function adaptRate(rate, providers) {
  const prov = providers[rate?.providerIndex] ?? {}
  const out = {
    providerName: prov.name ?? '',
    providerLogo: providerInitial(prov.name),
    totalRate: typeof rate?.totalRate === 'number' ? rate.totalRate : 0,
    isCheapestRate: !!rate?.isCheapestRate,
    inclusions: Array.isArray(rate?.inclusions) ? rate.inclusions : [],
    hasFreeCancellation: !!rate?.hasFreeCancellation,
    canPayLater: !!rate?.canPayLater,
    availableRooms: typeof rate?.availableRooms === 'number' ? rate.availableRooms : ROOMS_UNKNOWN,
    cashback: mapCashback(prov.cashback, prov.isDirect),
  }
  // 전방호환 추가 필드(앱 타입 외·런타임 무해): 딥링크 bookUri(S4)·공급사 로고 URL.
  if (rate?.bookUri) out.bookUri = String(rate.bookUri)
  if (prov.logo) out.providerLogoUrl = String(prov.logo)
  return out
}

/** 호텔 1건 → 앱 Hotel. */
function adaptOneHotel(r, providers, propertyType) {
  const rawRates = Array.isArray(r?.rates) ? r.rates : []
  // 최저가 우선 정렬 후 상위 4건(앱 카드 표시·rateOf 대표요금).
  const topRates = ratesCheapestFirst(rawRates).slice(0, 4).map((rate) => adaptRate(rate, providers))
  // 정렬로 topRates[0]=최저가가 되므로 KAYAK 원본 isCheapestRate 플래그를 정렬과 정합하게 재계산
  // (S02 가격비교가 isCheapestRate 로 최저가 테두리를 그림 → 엉뚱한 행 강조 방지).
  if (topRates.length) {
    const minRate = Math.min(...topRates.map((t) => t.totalRate))
    for (const t of topRates) t.isCheapestRate = t.totalRate === minRate
  }
  return {
    hotelId: String(r?.id ?? r?.key ?? ''),
    name: r?.translatedName || r?.name || '', // 한글 표시 우선(translatedName)
    starRating: typeof r?.starRating === 'number' && r.starRating > 0 ? r.starRating : 0,
    guestRating: normalizeGuestRating(r?.guestRating),
    numberOfReviews: typeof r?.numberOfReviews === 'number' && r.numberOfReviews > 0 ? r.numberOfReviews : 0,
    images: pickImages(r?.images),
    // 폴백은 표시용 topRates(최대4)가 아니라 원본 rates 의 distinct 공급사 수(과소표시 방지).
    numberOfProviders:
      typeof r?.numberOfProviders === 'number'
        ? r.numberOfProviders
        : new Set(rawRates.map((x) => x?.providerIndex)).size,
    location: r?.address || '',
    propertyType: propertyType || '',
    amenities: featuresToAmenities(r?.features),
    topRates,
  }
}

/**
 * @param {*} resp KAYAK 검색(다중) RAW 응답
 * @param {{languageCode?:string}} opts
 * @returns {Promise<{results:object[], totalCount:number, serverTotalResults?:number}>}
 */
export async function adaptHotels(resp, { languageCode = 'ko_KR' } = {}) {
  const results = Array.isArray(resp?.results) ? resp.results : []
  const providers = Array.isArray(resp?.providers) ? resp.providers : []

  // propertyType 라벨: 응답 패싯 1차(항상 최신·추가 호출 불필요).
  const facet = new Map(
    (Array.isArray(resp?.propertyTypes) ? resp.propertyTypes : [])
      .filter((p) => typeof p?.id === 'number')
      .map((p) => [p.id, p.name]),
  )

  const hotels = []
  for (const r of results) {
    let label = facet.get(r?.propertyType)
    // 패싯에 없으면 constants 캐시 폴백(적재 실패 시 undefined → 빈 문자열).
    if (label == null && typeof r?.propertyType === 'number') {
      label = await getPropertyLabel(r.propertyType, languageCode)
    }
    const hotel = adaptOneHotel(r, providers, label)
    // 상세(S3)는 단일응답에 propertyType 이 없어 보강이 필요하다 → 라벨이 있으면 적재(#20).
    if (label) rememberPropertyType(hotel.hotelId, label, languageCode)
    hotels.push(hotel)
  }

  const out = { results: hotels, totalCount: hotels.length }
  if (typeof resp?.totalResults === 'number') out.serverTotalResults = resp.totalResults
  return out
}
