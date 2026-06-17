import { Router } from 'express'
import { config } from '../config.js'
import { autocomplete } from '../kayak/endpoints.js'
import { adaptAutocomplete } from '../adapters/autocomplete.js'
import { dedupe } from '../lib/dedupe.js'

const router = Router()

/**
 * GET /api/autocomplete?q=  →  앱 AutocompleteItem[] (city→region→hotel 정렬, 최대 6)
 * KAYAK: GET {HOST}/api/affiliate/autocomplete/v1/hotels?apiKey=&searchTerm={q} (헤더 불필요)
 * q 빈 값이면 빈 배열(앱 MSW 와 동일 동작).
 *
 * S6·#22: 디바운스 타이핑은 같은 prefix 를 반복 호출하므로 단기 캐시(autocompleteCacheTtlMs)로
 *   KAYAK 호출 쿼터를 절감한다. 자동완성은 IP/market 무관(헤더 불필요)이라 손님 간 공유 안전 →
 *   키는 정규화된 q 만(market IP 미포함). dedupe 가 in-flight 도 합친다.
 */
router.get('/autocomplete', async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim()
    if (!q) return res.json([])
    // 캐시 키: 자동완성 네임스페이스 + 소문자 정규화 q(market 무관).
    const key = `ac:${q.toLowerCase()}`
    const items = await dedupe(
      key,
      async () => adaptAutocomplete(await autocomplete({ q })),
      { ttlMs: config.autocompleteCacheTtlMs },
    )
    res.json(items)
  } catch (e) {
    next(e)
  }
})

export default router
