import { Router } from 'express'

const router = Router()

/**
 * GET /api/autocomplete?q=  →  앱 AutocompleteItem[] (최대 6, city→region→hotel 정렬)
 * 매핑(S2): GET {KAYAK_HOST}/api/affiliate/autocomplete/v1/hotels?apiKey=&searchTerm={q}
 *           헤더 불필요. primaryPlaceType enum 축약 매핑 필요.
 */
router.get('/autocomplete', (_req, res) => {
  res.status(501).json({
    error: 'NOT_IMPLEMENTED',
    phase: 'S0',
    note: 'KAYAK Autocomplete 연동은 S2 에서 구현됩니다.',
    willMapTo: 'GET {KAYAK_HOST}/api/affiliate/autocomplete/v1/hotels',
  })
})

export default router
