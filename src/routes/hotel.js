import { Router } from 'express'

const router = Router()

/**
 * GET /api/hotel/:id  →  앱 HotelDetail
 * 매핑(S3): GET {KAYAK_HOST}/api/3.0/hotel
 *   ?apiKey=&userTrackId=&hotel=khotel:{id}&checkin=&checkout=&rooms=
 *   &responseOptions=features,featureTags,featureSummary,images,place,reviews,description,rateBreakdown
 *   &includeTaxesInTotal=true
 * 🔴 필수 헤더: User-Agent + x-original-client-ip. isComplete 폴링.
 */
router.get('/hotel/:id', (_req, res) => {
  res.status(501).json({
    error: 'NOT_IMPLEMENTED',
    phase: 'S0',
    note: 'KAYAK Hotel Search(단일) 연동은 S3 에서 구현됩니다.',
    willMapTo: 'GET {KAYAK_HOST}/api/3.0/hotel',
  })
})

export default router
