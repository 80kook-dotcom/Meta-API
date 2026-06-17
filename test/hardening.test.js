/**
 * 리뷰 워크플로 확정 발견 수정 회귀 테스트 (#5 로그 스크럽·#7 캐시 크기 상한).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scrubSecrets } from '../src/middleware/errorHandler.js'
import { dedupe, _resetDedupe, _doneSize } from '../src/lib/dedupe.js'

test('scrubSecrets: apiKey= 흔적을 ***로 가림(문자열·객체)', () => {
  assert.match(scrubSecrets('error at https://x/api?apiKey=ABCD-1234&foo=1'), /apiKey=\*\*\*/)
  assert.ok(!/ABCD-1234/.test(scrubSecrets('apiKey=ABCD-1234')))
  assert.match(scrubSecrets({ url: 'https://x?apiKey=SECRET123' }), /apiKey=\*\*\*/)
  assert.equal(scrubSecrets(null), '')
  assert.equal(scrubSecrets(undefined), '')
})

test('scrubSecrets: apiKey 없는 본문은 그대로', () => {
  assert.equal(scrubSecrets('{"errorCode":"MISSING_USER_TRACK_ID"}'), '{"errorCode":"MISSING_USER_TRACK_ID"}')
})

test('scrubSecrets: sig= (캐시백 라벨 서명) 흔적도 ***로 가림 (S6)', () => {
  assert.match(scrubSecrets('GET /api/cashback?labels=m1&exp=1700000000&sig=DEADBEEF1234'), /sig=\*\*\*/)
  assert.ok(!/DEADBEEF1234/.test(scrubSecrets('sig=DEADBEEF1234')))
  // labels(비PII·공개값)·exp 는 보존, sig 만 가림.
  const scrubbed = scrubSecrets('labels=m1&exp=1700000000&sig=ABCDEF')
  assert.match(scrubbed, /labels=m1/)
  assert.match(scrubbed, /exp=1700000000/)
  assert.match(scrubbed, /sig=\*\*\*/)
})

test('dedupe done 캐시: 크기 상한(기본 200) 초과 시 오래된 것부터 제거', async () => {
  _resetDedupe()
  // 250개 distinct 키를 긴 TTL 로 적재 → 상한(200) 이하로 유지되어야 함.
  for (let i = 0; i < 250; i++) {
    await dedupe(`key-${i}`, async () => ({ i }), { ttlMs: 60_000 })
  }
  assert.ok(_doneSize() <= 200, `done size=${_doneSize()} ≤ 200`)
})
