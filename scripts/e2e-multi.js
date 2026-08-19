import crypto from 'node:crypto';
/**
 * 다중 클라이언트 + 클라이언트 간 API 호출 검증.
 * 브라우저처럼 오리진별 쿠키를 관리하며 리다이렉트를 따라간다.
 *   node scripts/e2e-multi.js   (SSO 와 앱 3개가 떠 있어야 함)
 */
const SSO = 'http://localhost:3000';
const PORTAL = 'http://localhost:4000';
const NOTES = 'http://localhost:4100';
const ADMIN = 'http://localhost:4200';
const NOTES_API = `${NOTES}/api`;

/**
 * 쿠키 저장소. ★ 브라우저와 똑같이 호스트로만 구분한다 — 포트는 무시.
 * 오리진(포트 포함)으로 나누면 실제 브라우저보다 관대해져서,
 * 같은 호스트의 앱끼리 쿠키가 충돌하는 버그를 놓친다.
 */
const jars = new Map(); // hostname -> "k=v; k=v"
const jwt = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());

/** 렌더된 폼의 action 을 그대로 따라간다 (직접 구현 / oidc-provider 양쪽 지원) */
const formAction = (html, fallback) =>
  html.match(/<form method="post" action="([^"]+)"/)?.[1] ?? fallback;

function remember(host, res) {
  const jar = new Map((jars.get(host) ?? '').split('; ').filter(Boolean).map((c) => {
    const i = c.indexOf('='); return [c.slice(0, i), c.slice(i + 1)];
  }));
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [kv] = c.split(';');
    const i = kv.indexOf('=');
    const name = kv.slice(0, i).trim(), value = kv.slice(i + 1);
    if (/max-age=0/i.test(c) || value === '') jar.delete(name);
    else jar.set(name, value);
  }
  jars.set(host, [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
}

async function raw(url, opts = {}) {
  const host = new URL(url).hostname; // 포트 제외 — 브라우저와 동일
  const cookie = jars.get(host);
  const res = await fetch(url, {
    ...opts,
    redirect: 'manual',
    headers: { ...(opts.headers ?? {}), ...(cookie ? { cookie } : {}) },
  });
  remember(host, res);
  return res;
}

/** 리다이렉트를 끝까지 따라가고, SSO 로그인/동의 화면이 나오면 처리한다 */
async function browse(url, creds) {
  let current = url;
  for (let i = 0; i < 20; i++) {
    const res = await raw(current);
    if (res.status >= 300 && res.status < 400) {
      current = new URL(res.headers.get('location'), current).toString();
      continue;
    }
    const html = await res.text();

    // oidc-provider 의 로그아웃 확인 폼은 자동 제출한다 (브라우저에서는 JS 가 한다)
    if (html.includes('op.logoutForm')) {
      const action = html.match(/<form[^>]*action="([^"]+)"/)?.[1];
      const body = new URLSearchParams({ logout: 'yes' });
      for (const [, n, v] of html.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)) body.set(n, v);
      const r2 = await raw(new URL(action, current).toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
      current = r2.status >= 300 && r2.status < 400
        ? new URL(r2.headers.get('location'), current).toString()
        : current;
      continue;
    }

    const id = html.match(/name="auth_request_id" value="([^"]+)"/)?.[1];
    if (id && /로그인<\/h1>/.test(html)) {
      if (!creds) throw new Error('로그인 화면이 떴는데 자격증명이 없음');
      const r = await raw(SSO + formAction(html, '/login'), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ auth_request_id: id, ...creds }),
      });
      current = r.status >= 300 ? new URL(r.headers.get('location'), SSO).toString() : SSO;
      if (r.status < 300) {
        const h = await r.text();
        const cid = h.match(/name="auth_request_id" value="([^"]+)"/)?.[1];
        const rc = await raw(SSO + formAction(h, '/consent'), {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ auth_request_id: cid, decision: 'allow' }),
        });
        current = new URL(rc.headers.get('location'), SSO).toString();
      }
      continue;
    }
    if (id && /권한 요청/.test(html)) {
      const rc = await raw(SSO + formAction(html, '/consent'), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ auth_request_id: id, decision: 'allow' }),
      });
      current = new URL(rc.headers.get('location'), SSO).toString();
      continue;
    }
    return { status: res.status, html, url: current, sawLogin: !!id };
  }
  throw new Error('리다이렉트가 끝나지 않음');
}

/** 화면에 로그인 화면이 한 번이라도 떴는지 추적하는 버전 */
async function browseTrackingLogin(url) {
  let loginShown = false;
  let current = url;
  for (let i = 0; i < 20; i++) {
    const res = await raw(current);
    if (res.status >= 300 && res.status < 400) {
      current = new URL(res.headers.get('location'), current).toString();
      continue;
    }
    const html = await res.text();
    const id = html.match(/name="auth_request_id" value="([^"]+)"/)?.[1];
    if (id && /로그인<\/h1>/.test(html)) { loginShown = true; return { html, loginShown }; }
    if (id && /권한 요청/.test(html)) {
      const rc = await raw(SSO + formAction(html, '/consent'), {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ auth_request_id: id, decision: 'allow' }),
      });
      current = new URL(rc.headers.get('location'), SSO).toString();
      continue;
    }
    return { html, loginShown };
  }
  throw new Error('리다이렉트가 끝나지 않음');
}

/** 화면에 찍힌 JSON 은 HTML 이스케이프되어 있으므로 되돌린 뒤 검사한다 */
const unesc = (h) => h.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/** SSO 내부 리다이렉트만 따라간다 (oidc-provider 는 /authorize → /interaction 으로 튕긴다) */
async function followSso(res) {
  let cur = res;
  for (let i = 0; i < 10; i++) {
    if (cur.status < 300 || cur.status >= 400) return cur;
    const loc = cur.headers.get('location');
    if (!loc || loc === 'null') return cur;
    const abs = new URL(loc, SSO).toString();
    if (!abs.startsWith(SSO)) return cur;
    cur = await raw(abs);
  }
  return cur;
}

const sub = (html) => html.match(/sub=<code>([^<]+)<\/code>/)?.[1];
const sid = (html) => html.match(/SSO 세션 sid<\/td><td><code>([^<]+)<\/code>/)?.[1];

(async () => {
  let pass = 0, fail = 0;
  const t = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${m}`); };

  console.log('\n[1] 포털(:4000)에서 최초 로그인');
  let r = await browse(`${PORTAL}/login`, { username: 'alice', password: 'password123' });
  t(/사내 포털/.test(r.html) && /앨리스/.test(r.html), '포털 로그인 완료');
  const portalSub = sub(r.html), portalSid = sid(r.html);
  t(!!portalSub && !!portalSid, `sub=${portalSub} sid=${portalSid?.slice(0, 10)}…`);

  console.log('\n[2] ★ SSO — 나머지 두 앱은 로그인 화면 없이 진입');
  r = await browseTrackingLogin(`${NOTES}/login`);
  t(!r.loginShown, '메모 앱(:4100): 로그인 화면 없이 통과');
  t(/메모 앱/.test(r.html) && /앨리스/.test(r.html), '메모 앱 로그인 상태');
  const notesSub = sub(r.html), notesSid = sid(r.html);

  r = await browseTrackingLogin(`${ADMIN}/login`);
  t(!r.loginShown, '관리 콘솔(:4200): 로그인 화면 없이 통과');
  const adminSub = sub(r.html), adminSid = sid(r.html);

  t(portalSub === notesSub && notesSub === adminSub, `세 앱이 같은 사용자로 인식 (sub=${portalSub})`);
  // sid 의 의미는 구현마다 다르다. OIDC 스펙상 sid 는 "RP 별 세션 식별자" 라
  // 클라이언트마다 다른 값을 주는 편이 RP 간 사용자 상관관계를 막는다.
  t(!!portalSid && !!notesSid && !!adminSid, '세 앱 모두 SSO 세션 식별자(sid) 수령');
  console.log(
    `     ↳ sid 방식: ${portalSid === notesSid ? '전 클라이언트 공용' : '클라이언트별로 다름 (RP 간 상관관계 차단)'}`,
  );

  console.log('\n[3] 앱을 오가도 각자의 로그인이 유지된다 (쿠키 충돌 회귀)');
  // 쿠키는 호스트로만 구분되고 포트는 무시된다. 세 앱이 전부 localhost 라서
  // 세션 쿠키 이름이 같으면 앱을 방문할 때마다 서로의 쿠키를 덮어써 로그인이 풀린다.
  {
    const names = [...(jars.get('localhost') ?? '').matchAll(/(^|; )([^=]+)=/g)].map((m) => m[2]);
    const rpCookies = names.filter((n) => n.startsWith('rp_sid'));
    t(new Set(rpCookies).size === rpCookies.length && rpCookies.length >= 3,
      `앱마다 세션 쿠키 이름이 다름 (${rpCookies.join(', ')})`);

    // 세 앱을 한 바퀴 돈 뒤에도 전부 로그인 상태여야 한다
    for (const [label, url] of [['포털', PORTAL], ['메모 앱', NOTES], ['관리 콘솔', ADMIN]]) {
      await raw(`${url}/`);
      void label;
    }
    for (const [label, url] of [['포털', PORTAL], ['메모 앱', NOTES], ['관리 콘솔', ADMIN]]) {
      const html = await (await raw(`${url}/`)).text();
      t(/앨리스/.test(html), `${label}: 다른 앱 방문 후에도 로그인 유지`);
    }
  }

  console.log('\n[4] 각 앱이 받은 액세스 토큰의 aud 는 서로 다르다');
  r = await raw(`${PORTAL}/`); const portalHtml = await r.text();
  r = await raw(`${NOTES}/`); const notesHtml = await r.text();
  const audOf = (h) => h.match(/액세스 토큰 aud<\/td><td><code>([^<]+)<\/code>/)?.[1];
  // 로그인용 토큰의 표현은 구현마다 다르다 — 직접 짠 버전은 aud=/userinfo 인 JWT,
  // oidc-provider 는 resource 가 없으면 불투명 토큰. 어느 쪽이든 "메모 API 용이 아니다" 가 요점.
  t(audOf(portalHtml) !== NOTES_API, `포털 토큰은 메모 API 용이 아님 (aud = ${audOf(portalHtml)})`);
  t(audOf(notesHtml) === NOTES_API, `메모 앱 토큰 aud = ${audOf(notesHtml)} (resource 파라미터로 지정)`);

  console.log('\n[5] ★ 포털 → 메모 앱 API 호출 (토큰 교환 RFC 8693)');
  r = await browse(`${PORTAL}/fetch-notes`);
  t(/메모 앱이 <code>/.test(r.html), '포털이 메모 앱 API 호출 성공');
  t(/위임: portal-app/.test(r.html), '메모 앱이 "portal-app 의 위임 호출" 로 인식');
  t(/스프린트 회고/.test(r.html), '앨리스의 메모가 포털 화면에 표시됨');
  const shown = unesc(r.html);
  const actMatch = shown.match(/"act": \{[\s\S]*?"sub": "([^"]+)"/);
  t(actMatch?.[1] === 'portal-app', `교환된 토큰에 act.sub=${actMatch?.[1]} (위임 체인 기록)`);
  t(/"aud": "http:\/\/localhost:4100\/api"/.test(shown), '교환된 토큰의 aud 가 메모 API 로 좁혀짐');
  t(/"client_id": "portal-app"/.test(shown), '교환된 토큰의 client_id 는 호출자(portal-app)');
  t(new RegExp(`"sub": "${portalSub}"`).test(shown), '교환된 토큰의 sub 은 원래 사용자 그대로 (앱이 아니라 사람)');

  console.log('\n[6] 교환하지 않은 토큰으로는 남의 API 를 못 부른다');
  r = await browse(`${PORTAL}/fetch-notes-raw`);
  t(/401/.test(r.html) && /invalid_token/.test(r.html), '메모 앱이 aud 불일치로 401 거부');

  console.log('\n[7] 교환은 원본 토큰의 scope 를 넘을 수 없다 (권한 상승 차단)');
  {
    // notes:read 없이 로그인한 토큰으로 교환에서 notes:read 를 요구해본다
    const v = crypto.randomBytes(32).toString('base64url');
    const ch = crypto.createHash('sha256').update(v).digest('base64url');
    const saved = new Map(jars); jars.clear();
    let rr = await followSso(await raw(`${SSO}/oauth2/authorize?` + new URLSearchParams({
      response_type: 'code', client_id: 'portal-app', redirect_uri: `${PORTAL}/callback`,
      scope: 'openid profile', state: 's', nonce: 'n', code_challenge: ch, code_challenge_method: 'S256' })));
    let h = await rr.text();
    let aid = h.match(/name="auth_request_id" value="([^"]+)"/)[1];
    rr = await followSso(await raw(SSO + formAction(h, '/login'), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ auth_request_id: aid, username: 'alice', password: 'password123' }) }));
    h = await rr.text();
    aid = h.match(/name="auth_request_id" value="([^"]+)"/)[1];
    rr = await followSso(await raw(SSO + formAction(h, '/consent'), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ auth_request_id: aid, decision: 'allow' }) }));
    const code = new URL(rr.headers.get('location')).searchParams.get('code');
    const basic = 'Basic ' + Buffer.from('portal-app:portal-secret').toString('base64');
    const tok = await (await fetch(`${SSO}/oauth2/token`, { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basic },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: `${PORTAL}/callback`, code_verifier: v }) })).json();
    // 액세스 토큰은 JWT 일 수도 불투명 문자열일 수도 있으므로 응답의 scope 를 본다
    t(!(tok.scope ?? '').includes('notes:read'), '로그인 토큰에 notes:read 없음 (사용자 미동의)');
    const ex = await fetch(`${SSO}/oauth2/token`, { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basic },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: tok.access_token,
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        audience: NOTES_API, scope: 'notes:read' }) });
    t(ex.status === 400 && (await ex.json()).error === 'invalid_scope',
      '교환으로 notes:read 를 새로 만들어낼 수 없음 → invalid_scope');
    jars.clear(); for (const [k, val] of saved) jars.set(k, val);
  }

  console.log('\n[8] 허용되지 않은 클라이언트는 교환 자체가 막힌다');
  r = await browse(`${ADMIN}/try-notes`);
  t(/SSO 가 거부/.test(r.html), '관리 콘솔의 메모 API 토큰 교환 요청 거부됨');

  console.log('\n[9] 메모 앱 API 를 직접 호출 (토큰 없음 / scope 부족)');
  let res = await fetch(`${NOTES_API}/notes`);
  t(res.status === 401, '토큰 없이 호출 → 401');
  const bad = await fetch(`${NOTES_API}/notes`, { headers: { authorization: 'Bearer forged.token.here' } });
  t(bad.status === 401, '위조 토큰 → 401');

  console.log('\n[10] 다른 사용자의 메모는 보이지 않는다');
  const bobJars = new Map(jars); jars.clear();
  r = await browse(`${NOTES}/login`, { username: 'bob', password: 'password123' });
  t(/밥/.test(r.html), '밥으로 별도 로그인');
  r = await browse(`${NOTES}/`);
  t(/밥의 메모/.test(r.html) && !/스프린트 회고/.test(r.html), '밥에게는 밥의 메모만 노출');
  jars.clear(); for (const [k, v] of bobJars) jars.set(k, v);

  console.log('\n[11] ★ 백채널 로그아웃 — 한 앱에서 로그아웃하면 전부 종료');
  r = await browse(`${PORTAL}/logout`);
  t(/아직 로그인하지 않았습니다/.test(r.html), '포털 로그아웃됨');
  r = await raw(`${NOTES}/`); const nh = await r.text();
  t(/아직 로그인하지 않았습니다/.test(nh), '메모 앱 세션도 백채널로 종료됨');
  t(/다른 앱에서 로그아웃되어/.test(nh), '메모 앱이 백채널 로그아웃 사유를 표시');
  r = await raw(`${ADMIN}/`); const ah = await r.text();
  t(/아직 로그인하지 않았습니다/.test(ah), '관리 콘솔 세션도 종료됨');

  console.log(`\n───────────────\n통과 ${pass} / 실패 ${fail}\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('실행 오류:', e); process.exit(1); });
