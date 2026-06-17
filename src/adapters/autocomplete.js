/**
 * 자동완성 어댑터 — KAYAK HotelsAutocompleteRecordResponse → 앱 AutocompleteItem[].
 *
 * 실측(2026-06-17) 응답 필드: entityKey·primaryPlaceType·fullName(대문자 N)·hotelName·cityName 등.
 * ⚠ 앱 필드명은 fullname(소문자) — 이름이 다르므로 명시 변환.
 * 정렬: 앱 정책 city→region→hotel→neighborhood→airport (KAYAK 은 호텔을 앞에 주는 경향) → 중계에서 정렬.
 * 최대 6건.
 */
import { mapPlaceType } from './transform.js'

/** 앱 PlaceType 정렬 우선순위(mocks/handlers.ts PLACE_ORDER 와 동일). */
const PLACE_ORDER = { city: 0, region: 1, hotel: 2, neighborhood: 3, airport: 4 }

/** KAYAK 응답에서 후보 배열을 꺼낸다(배열이거나 {records|results|data:[...]} 형태 대비). */
function extractItems(resp) {
  if (Array.isArray(resp)) return resp
  if (resp && typeof resp === 'object') {
    for (const v of Object.values(resp)) if (Array.isArray(v)) return v
  }
  return []
}

/**
 * @param {*} kayakResp KAYAK 자동완성 RAW 응답
 * @returns {Array<{entityKey:string, primaryPlaceType:string, fullname?:string, hotelName?:string, cityName?:string}>}
 */
export function adaptAutocomplete(kayakResp) {
  const items = extractItems(kayakResp)
  const mapped = items
    .filter((it) => it && it.entityKey)
    .map((it) => {
      const type = mapPlaceType(it.primaryPlaceType)
      const out = {
        entityKey: String(it.entityKey),
        primaryPlaceType: type,
      }
      if (it.fullName) out.fullname = String(it.fullName)
      if (type === 'hotel' && it.hotelName) out.hotelName = String(it.hotelName)
      if (it.cityName) out.cityName = String(it.cityName)
      return out
    })

  // 안정 정렬: 동일 타입 내 KAYAK 관련도 순서 유지.
  mapped.sort((a, b) => (PLACE_ORDER[a.primaryPlaceType] ?? 9) - (PLACE_ORDER[b.primaryPlaceType] ?? 9))
  return mapped.slice(0, 6)
}
