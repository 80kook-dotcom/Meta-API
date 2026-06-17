/**
 * S5 캐시백 프로브 — KAYAK Reporting transactions/hotels 실제 응답 '형태'를 확인한다.
 * (어댑터의 배열 정규화 가정 검증용 · 키 누출 없이 타입/길이/키만 출력)
 * 실행: node scripts/probe-cashback.mjs [label]
 */
import { getTransactions } from '../src/kayak/endpoints.js'
import { config } from '../src/config.js'

const L = (s = '') => process.stdout.write(s + '\n')
const label = process.argv[2] || 'route-test-label'

function describe(raw) {
  if (Array.isArray(raw)) return `Array(len=${raw.length})`
  if (raw && typeof raw === 'object') return `Object(keys=${Object.keys(raw).join(',')})`
  return `${typeof raw}: ${String(raw).slice(0, 60)}`
}

async function main() {
  const now = new Date()
  const end = new Date(now); end.setUTCDate(end.getUTCDate() + 1)
  const start = new Date(now); start.setUTCDate(start.getUTCDate() - config.cashback.lookbackDays)
  const startDate = start.toISOString().slice(0, 10)
  const endDate = end.toISOString().slice(0, 10)

  L('═'.repeat(56))
  L(`  캐시백 리포팅 프로브  label="${label}"  ${startDate}~${endDate}`)
  L('═'.repeat(56))
  try {
    const raw = await getTransactions({ startDate, endDate, labels: label, pageSize: config.cashback.pageSize })
    L(`응답 형태: ${describe(raw)}`)
    const sample = Array.isArray(raw) ? raw[0] : raw
    if (sample) {
      const s = JSON.stringify(sample)
      L(`키 누출 검사(apiKey): ${/apiKey/i.test(s) ? '⚠ 발견' : '없음'}`)
      L(`첫 거래 키: ${Object.keys(sample).join(', ')}`)
      L(`첫 거래(앞 400자): ${s.slice(0, 400)}`)
    } else {
      L('거래 0건 — 테스트 예약이 없으면 정상(빈 배열).')
    }
  } catch (e) {
    L(`❌ ${e?.code ?? ''} ${e?.message ?? e}`)
    process.exitCode = 1
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1 })
