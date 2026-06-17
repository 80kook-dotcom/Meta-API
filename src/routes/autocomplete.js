import { Router } from 'express'
import { autocomplete } from '../kayak/endpoints.js'
import { adaptAutocomplete } from '../adapters/autocomplete.js'

const router = Router()

/**
 * GET /api/autocomplete?q=  →  앱 AutocompleteItem[] (city→region→hotel 정렬, 최대 6)
 * KAYAK: GET {HOST}/api/affiliate/autocomplete/v1/hotels?apiKey=&searchTerm={q} (헤더 불필요)
 * q 빈 값이면 빈 배열(앱 MSW 와 동일 동작).
 */
router.get('/autocomplete', async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim()
    if (!q) return res.json([])
    const raw = await autocomplete({ q })
    res.json(adaptAutocomplete(raw))
  } catch (e) {
    next(e)
  }
})

export default router
