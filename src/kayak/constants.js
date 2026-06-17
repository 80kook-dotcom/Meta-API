/**
 * constants-mapping(정적 라벨) 캐시 — S2 (#18).
 *
 * KAYAK 숫자 ID → 한글 라벨 매핑(facility / property)을 가져와 메모리에 캐시한다.
 * 설계(codex #18 권고):
 *   - lazy: 처음 필요할 때 1회 적재(기동 블로킹 X).
 *   - TTL: 기본 24h. 만료 시 다음 요청에서 재적재.
 *   - single-flight: 동시 다발 요청이 와도 적재 promise 1개만 공유(thundering herd 방지).
 *   - cold-start 내성: 적재 실패해도 던지지 않고 빈 맵 반환 → 호출부가 폴백(검색 라우트는
 *     응답 내 propertyTypes 패싯을 1차 소스로 쓰므로 constants 실패해도 목록은 정상).
 *
 * ⚠ facility 라벨은 매우 세분(≈298종)이라 검색 카드의 편의시설 필터로 직접 쓰기엔 부적합.
 *    카드 amenities 는 adapters/amenities.js 의 정적 버킷 맵을 쓴다. 이 캐시는
 *    ① propertyType 라벨 폴백 ② S3 상세의 시설 라벨 원천 으로 쓰인다.
 */
import { getConstantsMapping } from './endpoints.js'

const TTL_MS = Number(process.env.CONSTANTS_TTL_MS ?? 24 * 60 * 60 * 1000)

/** 언어별 캐시 엔트리: { property: Map<id,name>, facility: Map<id,name>, expires }. */
const cacheByLang = new Map()
/** 언어별 진행 중 적재 promise(single-flight). */
const inflightByLang = new Map()

/** NDJSON 행들에서 facility/property 라벨 맵을 만든다. */
function buildMaps(rows) {
  const property = new Map()
  const facility = new Map()
  for (const row of rows) {
    // property: { property: [{id,name}, ...] }
    if (Array.isArray(row?.property)) {
      for (const p of row.property) if (typeof p?.id === 'number') property.set(p.id, p.name)
    }
    // facility: { facility: { features: [{id,name,type}], tags: [...] } }
    const features = row?.facility?.features
    if (Array.isArray(features)) {
      for (const f of features) if (typeof f?.id === 'number') facility.set(f.id, f.name)
    }
  }
  return { property, facility }
}

/** 캐시 적재(또는 진행 중 promise 공유). 실패 시 빈 맵으로 폴백(throw 안 함). */
async function load(languageCode) {
  const existing = cacheByLang.get(languageCode)
  if (existing && existing.expires > Date.now()) return existing

  const inflight = inflightByLang.get(languageCode)
  if (inflight) return inflight

  const p = (async () => {
    try {
      const rows = await getConstantsMapping({ types: 'facility,property', languageCode })
      const { property, facility } = buildMaps(rows)
      const entry = { property, facility, expires: Date.now() + TTL_MS }
      cacheByLang.set(languageCode, entry)
      return entry
    } catch (e) {
      console.error('[meta-api] constants-mapping 적재 실패(폴백=빈 맵):', e?.code ?? '', e?.message ?? e)
      // 실패는 짧게만 캐시(다음 요청에서 재시도하도록 만료 임박).
      const entry = { property: new Map(), facility: new Map(), expires: Date.now() + 30_000 }
      cacheByLang.set(languageCode, entry)
      return entry
    } finally {
      inflightByLang.delete(languageCode)
    }
  })()
  inflightByLang.set(languageCode, p)
  return p
}

/** propertyType 숫자 → 한글 라벨(없으면 undefined). 적재 실패 시에도 throw 안 함. */
export async function getPropertyLabel(id, languageCode = 'ko_KR') {
  const { property } = await load(languageCode)
  return property.get(id)
}

/** facility 숫자 → 한글 라벨(없으면 undefined). S3 상세 시설 라벨용. */
export async function getFacilityLabel(id, languageCode = 'ko_KR') {
  const { facility } = await load(languageCode)
  return facility.get(id)
}

/** facility 전체 맵(Map<id,name>). S3 에서 여러 id 를 한 번에 변환할 때. */
export async function getFacilityMap(languageCode = 'ko_KR') {
  const { facility } = await load(languageCode)
  return facility
}

/** 테스트/운영 reset 용(캐시 비우기). */
export function _resetConstantsCache() {
  cacheByLang.clear()
  inflightByLang.clear()
}
