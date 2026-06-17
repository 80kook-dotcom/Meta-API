/**
 * 검색 폴링 transient 재시도 단위 테스트 (S6·#22·S2 적대리뷰 이관).
 * global.fetch 를 스텁해 일시오류/terminal/미완료 경로를 결정적으로 검증한다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callKayak, KayakError } from '../src/kayak/client.js'
import { config } from '../src/config.js'

const URL = 'https://ko-kr.kayakaffiliates.com/api/3.0/hotels?apiKey=K&userTrackId=u'

/** 빠른 폴링 설정으로 fn 실행 후 config·fetch 원복. */
async function withFastPoll(pollOverride, fn) {
  const origPoll = config.poll
  const origReq = config.requestTimeoutMs
  const origFetch = globalThis.fetch
  config.poll = { intervalMs: 1, maxAttempts: 8, timeoutMs: 3000, maxTransientRetries: 3, ...pollOverride }
  config.requestTimeoutMs = 1000
  try {
    return await fn()
  } finally {
    config.poll = origPoll
    config.requestTimeoutMs = origReq
    globalThis.fetch = origFetch
  }
}

const ok = (obj) => ({ ok: true, status: 200, text: async () => JSON.stringify(obj) })
const httpErr = (status) => ({ ok: false, status, text: async () => `err ${status}` })

test('네트워크 일시오류 2회 후 성공(isComplete) → 재시도로 성공', async () => {
  await withFastPoll({}, async () => {
    let calls = 0
    globalThis.fetch = async () => {
      calls++
      if (calls <= 2) throw new Error('ECONNRESET') // 네트워크 오류 → retryable
      return ok({ isComplete: true, totalResults: 5 })
    }
    const r = await callKayak(URL, { poll: true })
    assert.equal(r.isComplete, true)
    assert.equal(calls, 3, '2회 재시도 후 3번째 성공')
  })
})

test('업스트림 5xx 일시오류 후 성공 → 재시도', async () => {
  await withFastPoll({}, async () => {
    let calls = 0
    globalThis.fetch = async () => {
      calls++
      if (calls === 1) return httpErr(503)
      return ok({ isComplete: true })
    }
    const r = await callKayak(URL, { poll: true })
    assert.equal(r.isComplete, true)
    assert.equal(calls, 2)
  })
})

test('연속 일시오류가 상한(3) 초과 → 포기하고 throw', async () => {
  await withFastPoll({ maxTransientRetries: 3 }, async () => {
    let calls = 0
    globalThis.fetch = async () => {
      calls++
      throw new Error('down')
    }
    await assert.rejects(
      () => callKayak(URL, { poll: true }),
      (e) => e instanceof KayakError && e.code === 'KAYAK_NETWORK_ERROR',
    )
    // 1,2,3 누적 후 4번째에서 상한 초과 → throw. (정확히 4회 호출)
    assert.equal(calls, 4)
  })
})

test('terminal 4xx(400)는 재시도 없이 즉시 실패', async () => {
  await withFastPoll({}, async () => {
    let calls = 0
    globalThis.fetch = async () => {
      calls++
      return httpErr(400)
    }
    await assert.rejects(
      () => callKayak(URL, { poll: true }),
      (e) => e instanceof KayakError && e.code === 'KAYAK_HTTP_400',
    )
    assert.equal(calls, 1, '4xx 는 1회로 종료')
  })
})

test('계속 미완료(isComplete=false) → KAYAK_SEARCH_INCOMPLETE(504)', async () => {
  await withFastPoll({ maxAttempts: 3 }, async () => {
    globalThis.fetch = async () => ok({ isComplete: false, totalResults: 9 })
    await assert.rejects(
      () => callKayak(URL, { poll: true }),
      (e) => e instanceof KayakError && e.code === 'KAYAK_SEARCH_INCOMPLETE' && e.status === 504,
    )
  })
})
