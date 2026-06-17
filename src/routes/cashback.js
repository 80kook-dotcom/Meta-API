import { Router } from 'express'

const router = Router()

/**
 * GET /api/cashback?labels=  →  앱 CashbackTxn[]
 * 매핑(S5): GET {KAYAK_REPORTING_HOST}/api/transactions/hotels
 *   ?apiKey={reportingKey}&startDate=&endDate=&labels={회원라벨}&pageSize=
 *   헤더 X-Version: 2.0. IP + Reporting Key 둘 다 필요.
 * 상태 매핑: transactionStatus(Active 1 / Cancelled 11) + paymentMonth → Approved/Waiting/Cancelled.
 */
router.get('/cashback', (_req, res) => {
  res.status(501).json({
    error: 'NOT_IMPLEMENTED',
    phase: 'S0',
    note: 'KAYAK Reporting 연동은 S5 에서 구현됩니다.',
    willMapTo: 'GET {KAYAK_REPORTING_HOST}/api/transactions/hotels',
  })
})

export default router
