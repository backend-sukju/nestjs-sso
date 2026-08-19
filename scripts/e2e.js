import crypto from 'node:crypto';
const ISS = 'http://localhost:3000';
const b64 = (b) => b.toString('base64url');
const ok = (c, m) => console.log(`${c ? '  ✅' : '  ❌'} ${m}`);
const jwt = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());

/** 렌더된 폼의 action 을 그대로 따라간다 (직접 구현 / oidc-provider 양쪽 지원) */
const formAction = (html, fallback) =>
  html.match(/<form method="post" action="([^"]+)"/)?.[1] ?? fallback;

/**
 * 인가 요청이 거부됐는지 확인한다.
 * 거부 방식은 구현마다 다르다 — redirect_uri 로 error 를 붙여 302 하거나,
 * 400 에러 화면을 그린다. 둘 다 "거부" 이므로 어느 쪽이든 통과시키고,
 * 어떤 방식이었는지만 라벨에 남긴다.
 */
/**
 * SSO 내부 리다이렉트만 따라간다.
 * oidc-provider 는 /authorize → /interaction 으로 한 번 튕기고,
 * 직접 짠 버전은 곧바로 화면을 그린다. 클라이언트로 돌아가는 리다이렉트
 * (인가 코드를 실은)는 따라가지 않고 그대로 돌려준다.
 */
async function followInternal(res) {
  let cur = res;
  for (let i = 0; i < 10; i++) {
    if (cur.status < 300 || cur.status >= 400) {
      // oidc-provider 의 로그아웃 확인 폼은 자동 제출한다 (브라우저에서는 JS 가 한다)
      const ct = cur.headers.get('content-type') ?? '';
      if (cur.status === 200 && ct.includes('html')) {
        const html = await cur.clone().text();
        if (html.includes('op.logoutForm')) {
          const action = html.match(/<form[^>]*id="op\.logoutForm"[^>]*action="([^"]+)"/)?.[1]
            ?? html.match(/<form[^>]*action="([^"]+)"[^>]*id="op\.logoutForm"/)?.[1];
          const body = new URLSearchParams({ logout: 'yes' });
          for (const [, n, v] of html.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)) body.set(n, v);
          cur = await req(new URL(action, ISS).toString(), {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body,
          });
          continue;
        }
      }
      return cur;
    }
    const loc = cur.headers.get('location');
    if (!loc || loc === 'null') return cur;
    const abs = new URL(loc, ISS).toString();
    if (!abs.startsWith(ISS)) return cur;
    cur = await req(abs);
  }
  return cur;
}

function rejected(res, expectedError) {
  const loc = res.headers.get('location');
  if (res.status >= 300 && res.status < 400 && loc && loc !== 'null') {
    const u = new URL(loc);
    // response_type=token 계열은 에러도 query 가 아니라 fragment 로 온다
    const frag = new URLSearchParams(u.hash.replace(/^#/, ''));
    const err = u.searchParams.get('error') ?? frag.get('error');
    return { ok: err === expectedError, how: `${res.status} ${err}` };
  }
  return { ok: res.status >= 400, how: `${res.status} 에러 화면` };
}

/** 브라우저처럼 모든 쿠키를 보관한다 (oidc-provider 는 상호작용 쿠키도 쓴다) */
const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
function remember(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [kv, ...attrs] = c.split(';');
    const i = kv.indexOf('=');
    const name = kv.slice(0, i).trim();
    const value = kv.slice(i + 1);
    const expired = /max-age=0/i.test(c) || value === '';
    if (expired) jar.delete(name);
    else jar.set(name, value);
  }
}
async function req(url, opts = {}) {
  const ck = cookieHeader();
  const r = await fetch(url, {
    ...opts,
    redirect: 'manual',
    headers: { ...(opts.headers || {}), ...(ck ? { cookie: ck } : {}) },
  });
  remember(r);
  return r;
}
const form = (o) => new URLSearchParams(o);
const basic = (id, s) => 'Basic ' + Buffer.from(`${id}:${s}`).toString('base64');

(async () => {
let pass = 0, fail = 0;
const t = (c, m) => { c ? pass++ : fail++; ok(c, m); };

console.log('\n[1] Discovery / JWKS');
const meta = await (await req(`${ISS}/.well-known/openid-configuration`)).json();
t(meta.issuer === ISS && meta.token_endpoint === `${ISS}/oauth2/token`, 'openid-configuration 발급');
t(meta.code_challenge_methods_supported.includes('S256'), 'S256 PKCE 지원 광고');
const jwks = await (await req(`${ISS}/.well-known/jwks.json`)).json();
t(jwks.keys.length === 1 && jwks.keys[0].kty === 'RSA' && !!jwks.keys[0].kid, 'JWKS 공개키 노출 (개인키 미포함: ' + (jwks.keys[0].d === undefined) + ')');

console.log('\n[2] 검증 실패 케이스');
let r = await req(`${ISS}/oauth2/authorize?client_id=nope&redirect_uri=http://evil.com/cb&response_type=code&scope=openid`);
t(r.status === 400, '알 수 없는 client_id → 400 화면 (리다이렉트 안 함)');
r = await req(`${ISS}/oauth2/authorize?client_id=portal-app&redirect_uri=http://evil.com/cb&response_type=code&scope=openid`);
t(r.status === 400, '미등록 redirect_uri → 400 (open redirect 차단)');
r = await req(`${ISS}/oauth2/authorize?client_id=portal-app&redirect_uri=http://localhost:4000/callback&response_type=token&scope=openid`);
let v = rejected(r, 'unsupported_response_type');
t(v.ok, `response_type=token 거부 (${v.how})`);
r = await req(`${ISS}/oauth2/authorize?client_id=portal-app&redirect_uri=http://localhost:4000/callback&response_type=code&scope=openid`);
v = rejected(r, 'invalid_request');
t(v.ok, `PKCE 없는 요청 거부 (${v.how})`);
r = await req(`${ISS}/oauth2/authorize?client_id=portal-app&redirect_uri=http://localhost:4000/callback&response_type=code&scope=profile&code_challenge=x&code_challenge_method=S256`);
v = rejected(r, 'invalid_scope');
t(v.ok || v.how.includes('invalid_request'), `openid scope 누락 거부 (${v.how})`);

console.log('\n[3] 로그인 → 동의 → 인가 코드 (portal-app)');
const verifier = b64(crypto.randomBytes(32));
const challenge = b64(crypto.createHash('sha256').update(verifier).digest());
const state = 'st-' + b64(crypto.randomBytes(8)), nonce = 'no-' + b64(crypto.randomBytes(8));
const authUrl = `${ISS}/oauth2/authorize?` + form({
  response_type:'code', client_id:'portal-app', redirect_uri:'http://localhost:4000/callback',
  scope:'openid profile email offline_access', state, nonce,
  code_challenge:challenge, code_challenge_method:'S256' });
r = await followInternal(await req(authUrl));
let html = await r.text();
t(r.status === 200 && html.includes('로그인'), '세션 없음 → 로그인 화면');
const arid = html.match(/name="auth_request_id" value="([^"]+)"/)[1];
const LOGIN = ISS + formAction(html, '/login');

r = await req(LOGIN, { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'},
  body: form({ auth_request_id: arid, username:'alice', password:'wrong' }) });
t(r.status === 401, '잘못된 비밀번호 → 401 재표시');

r = await followInternal(await req(LOGIN, { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'},
  body: form({ auth_request_id: arid, username:'alice', password:'password123' }) }));
html = await r.text();
const CONSENT = ISS + formAction(html, '/consent');
t(r.status === 200 && html.includes('권한 요청'), '로그인 성공 → 동의 화면');
t(jar.has('sso_session'), 'SSO 세션 쿠키 발급');

r = await followInternal(await req(CONSENT, { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'},
  body: form({ auth_request_id: arid, decision:'allow' }) }));
const cb = new URL(r.headers.get('location'));
t([302, 303].includes(r.status) && cb.origin === 'http://localhost:4000', `동의 → redirect_uri 로 ${r.status}`);
t(cb.searchParams.get('state') === state, 'state 원본 그대로 반환');
const code = cb.searchParams.get('code');
t(!!code, '인가 코드 발급');

console.log('\n[4] 토큰 교환 (PKCE)');
const tokUrl = `${ISS}/oauth2/token`;
const H = { 'content-type':'application/x-www-form-urlencoded', authorization: basic('portal-app','portal-secret') };
r = await fetch(tokUrl, { method:'POST', headers:H, body: form({ grant_type:'authorization_code', code, redirect_uri:'http://localhost:4000/callback', code_verifier: b64(crypto.randomBytes(32)) }) });
t(r.status === 400 && (await r.json()).error === 'invalid_grant', '틀린 code_verifier → invalid_grant');

// 위에서 코드가 소모됐으므로 새 코드 발급
async function freshCode(scope='openid profile email offline_access', clientId='portal-app', redirect='http://localhost:4000/callback') {
  const v = b64(crypto.randomBytes(32)), c = b64(crypto.createHash('sha256').update(v).digest());
  const rr = await followInternal(await req(`${ISS}/oauth2/authorize?` + form({ response_type:'code', client_id:clientId, redirect_uri:redirect, scope, state:'s', nonce:'n-'+c.slice(0,6), code_challenge:c, code_challenge_method:'S256' })));
  if (rr.status === 200) { // 동의 화면
    const h = await rr.text();
    const id = h.match(/name="auth_request_id" value="([^"]+)"/)[1];
    const rc = await followInternal(await req(ISS + formAction(h, '/consent'), { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body: form({auth_request_id:id, decision:'allow'}) }));
    return { code: new URL(rc.headers.get('location')).searchParams.get('code'), verifier: v, nonce:'n-'+c.slice(0,6), status: rr.status };
  }
  return { code: new URL(rr.headers.get('location')).searchParams.get('code'), verifier: v, nonce:'n-'+c.slice(0,6), status: rr.status };
}
const f1 = await freshCode();
t([302, 303].includes(f1.status), '2번째 요청은 동의 화면 없이 통과 (동의 기억)');
r = await fetch(tokUrl, { method:'POST', headers:H, body: form({ grant_type:'authorization_code', code:f1.code, redirect_uri:'http://localhost:4000/callback', code_verifier:f1.verifier }) });
const tokens = await r.json();
t(r.ok && !!tokens.access_token && !!tokens.id_token, '토큰 발급 성공');
t(r.headers.get('cache-control') === 'no-store', 'Cache-Control: no-store');
const idc = jwt(tokens.id_token);
t(idc.iss === ISS && idc.aud === 'portal-app' && idc.sub === 'user-1001', 'id_token iss/aud/sub 정확');
t(idc.nonce === f1.nonce, 'nonce 반사');
t(idc.email === 'alice@example.com' && idc.name === '앨리스', 'profile/email 클레임 포함');
t(typeof idc.auth_time === 'number' && !!idc.sid, 'auth_time / sid 클레임');
t(!!tokens.refresh_token, 'offline_access → refresh_token 발급');

r = await fetch(tokUrl, { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded', authorization: basic('portal-app','WRONG')}, body: form({grant_type:'authorization_code', code:'x'}) });
t(r.status === 401 && (await r.json()).error === 'invalid_client', '잘못된 client_secret → 401 invalid_client');

console.log('\n[5] UserInfo');
r = await fetch(`${ISS}/oauth2/userinfo`, { headers: { authorization: `Bearer ${tokens.access_token}` } });
const ui = await r.json();
t(r.ok && ui.sub === 'user-1001' && ui.email === 'alice@example.com', 'userinfo 조회 성공');
r = await fetch(`${ISS}/oauth2/userinfo`, { headers: { authorization: 'Bearer garbage' } });
t(r.status === 401 && r.headers.get('www-authenticate')?.includes('invalid_token'), '위조 토큰 → 401 + WWW-Authenticate');

console.log('\n[6] Introspection');
r = await fetch(`${ISS}/oauth2/introspect`, { method:'POST', headers:H, body: form({ token: tokens.access_token }) });
const intro = await r.json();
t(intro.active === true && intro.client_id === 'portal-app', 'active=true + client_id');
r = await fetch(`${ISS}/oauth2/introspect`, { method:'POST', headers:H, body: form({ token: 'garbage' }) });
t((await r.json()).active === false, '무효 토큰 → active=false');

console.log('\n[7] 리프레시 토큰 회전');
r = await fetch(tokUrl, { method:'POST', headers:H, body: form({ grant_type:'refresh_token', refresh_token: tokens.refresh_token }) });
const t2 = await r.json();
t(r.ok && !!t2.access_token && t2.refresh_token !== tokens.refresh_token, '갱신 성공 + 리프레시 토큰 회전됨');
r = await fetch(tokUrl, { method:'POST', headers:H, body: form({ grant_type:'refresh_token', refresh_token: tokens.refresh_token }) });
t(r.status === 400, '이전 리프레시 토큰 재사용 차단');

console.log('\n[8] ★ SSO — 두 번째 클라이언트는 재로그인 없이 통과');
const f2 = await freshCode('openid profile', 'demo-spa', 'http://localhost:4000/callback');
t([302, 303].includes(f2.status) && !!f2.code, 'demo-spa: 로그인 화면 없이 즉시 인가 코드 (같은 세션 쿠키)');
r = await fetch(tokUrl, { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'},
  body: form({ grant_type:'authorization_code', code:f2.code, redirect_uri:'http://localhost:4000/callback', code_verifier:f2.verifier, client_id:'demo-spa' }) });
const spaTok = await r.json();
t(r.ok && jwt(spaTok.id_token).aud === 'demo-spa', 'public 클라이언트(secret 없음) 토큰 발급 성공');
t(spaTok.refresh_token === undefined, 'offline_access 미요청 → refresh_token 없음');
r = await fetch(`${ISS}/oauth2/userinfo`, { headers:{ authorization:`Bearer ${spaTok.access_token}` } });
const spaUi = await r.json();
t(spaUi.name === '앨리스' && spaUi.email === undefined, 'scope=openid profile → email 클레임 제외');

console.log('\n[9] prompt 파라미터');
r = await followInternal(await req(`${ISS}/oauth2/authorize?` + form({ response_type:'code', client_id:'portal-app', redirect_uri:'http://localhost:4000/callback', scope:'openid', state:'s', code_challenge:challenge, code_challenge_method:'S256', prompt:'login' })));
t(r.status === 200 && (await r.clone().text()).includes('로그인'), 'prompt=login → 세션이 있어도 재인증 화면');
r = await followInternal(await req(`${ISS}/oauth2/authorize?` + form({ response_type:'code', client_id:'portal-app', redirect_uri:'http://localhost:4000/callback', scope:'openid', state:'s', code_challenge:challenge, code_challenge_method:'S256', max_age:'0' })));
t(r.status === 200 && (await r.clone().text()).includes('로그인'), 'max_age=0 → 재인증 요구');

console.log('\n[10] 인가 코드 재사용');
{
  const fr = await freshCode();
  const first = await fetch(tokUrl, { method:'POST', headers:H, body: form({ grant_type:'authorization_code', code:fr.code, redirect_uri:'http://localhost:4000/callback', code_verifier:fr.verifier }) });
  const issued = await first.json();
  t(first.ok, '재사용 검증용 코드로 토큰 발급');
  const replay = await fetch(tokUrl, { method:'POST', headers:H, body: form({ grant_type:'authorization_code', code:fr.code, redirect_uri:'http://localhost:4000/callback', code_verifier:fr.verifier }) });
  t(replay.status === 400, '인가 코드 재사용 차단 (1회용)');
  // 구현 차이: 재사용 감지 시 그 grant 의 토큰까지 폐기하는지
  const after = await fetch(`${ISS}/oauth2/userinfo`, { headers: { authorization: `Bearer ${issued.access_token}` } });
  console.log(`     ↳ 재사용 감지 후 기존 액세스 토큰: ${after.status === 200 ? '유효 (코드만 거부)' : '폐기됨 (grant 전체 무효화)'}`);
}

console.log('\n[11] 로그아웃');
r = await followInternal(await req(`${ISS}/oauth2/logout?` + form({ id_token_hint: tokens.id_token, post_logout_redirect_uri: 'http://localhost:4000/' })));
t([302, 303].includes(r.status) && (r.headers.get('location') ?? '').startsWith('http://localhost:4000/'), 'post_logout_redirect_uri 로 리다이렉트');
r = await fetch(tokUrl, { method:'POST', headers:H, body: form({ grant_type:'refresh_token', refresh_token: t2.refresh_token }) });
t(r.status === 400, '로그아웃 후 리프레시 토큰 무효화');
jar.clear();
r = await followInternal(await req(`${ISS}/oauth2/authorize?` + form({ response_type:'code', client_id:'portal-app', redirect_uri:'http://localhost:4000/callback', scope:'openid', state:'s', code_challenge:challenge, code_challenge_method:'S256' })));
t(r.status === 200, '세션 종료 후 재접근 → 다시 로그인 화면');

console.log(`\n───────────────\n통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
})();
