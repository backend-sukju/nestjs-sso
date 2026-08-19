/**
 * 세 개의 데모 앱이 공유하는 OIDC 클라이언트(RP) 구현.
 * 로그인/콜백/로그아웃/백채널 로그아웃 수신까지 여기서 처리하고,
 * 앱마다 다른 부분은 extraRoutes / renderExtra 로 끼워 넣는다.
 */
import crypto from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { esc, layout } from './ui.js';

const ISSUER = process.env.ISSUER ?? 'http://localhost:3000';

const b64 = (b) => b.toString('base64url');
/**
 * 액세스 토큰이 항상 JWT 인 것은 아니다.
 * oidc-provider 는 resource 가 지정되지 않은 토큰을 불투명(opaque) 문자열로 발급한다
 * — 리소스 서버가 없으니 검증할 주체도 없다는 관점. 그럴 땐 null 을 돌려준다.
 */
const decodeJwt = (t) => {
  const parts = String(t ?? '').split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
};

let metaCache = null;
let jwksCache = null;
async function discover() {
  if (!metaCache) {
    const r = await fetch(`${ISSUER}/.well-known/openid-configuration`);
    if (!r.ok) throw new Error(`discovery 실패: ${r.status}`);
    metaCache = await r.json();
    jwksCache = createRemoteJWKSet(new URL(metaCache.jwks_uri));
  }
  return metaCache;
}
const jwks = async () => (await discover(), jwksCache);

function createRp(cfg) {
  const {
    name, port, clientId, clientSecret, scope, resource, accent,
    extraRoutes, renderExtra,
  } = cfg;
  const self = `http://localhost:${port}`;
  const redirectUri = `${self}/callback`;

  /** rp 쿠키 -> 세션 */
  const sessions = new Map();
  /** SSO 의 sid -> 이 앱의 rp 쿠키 집합 (백채널 로그아웃 때 역방향으로 찾는다) */
  const bySsoSid = new Map();

  const basic = () => 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  /** 토큰 엔드포인트 호출 공통 */
  async function tokenRequest(params) {
    const meta = await discover();
    const r = await fetch(meta.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basic() },
      body: new URLSearchParams(params),
    });
    const json = await r.json();
    if (!r.ok) {
      const err = new Error(`${json.error}: ${json.error_description ?? ''}`);
      err.payload = json;
      throw err;
    }
    return json;
  }

  /**
   * 세션 쿠키 이름을 앱마다 다르게 둔다.
   * ★ 쿠키는 호스트로만 구분되고 포트는 무시된다 (RFC 6265 §8.5).
   *   세 앱이 전부 localhost 라서, 이름이 같으면 앱을 오갈 때마다 서로의
   *   세션 쿠키를 덮어써 로그인이 풀린다. 실제 배포처럼 도메인이 다르면
   *   생기지 않는 문제지만, 이름을 나눠두면 어느 쪽이든 안전하다.
   */
  const cookieName = `rp_sid_${clientId.replace(/[^A-Za-z0-9]/g, '_')}`;

  const app = express();
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: false }));

  app.use((req, res, next) => {
    let sid = req.cookies[cookieName];
    if (!sid || !sessions.has(sid)) {
      sid = crypto.randomBytes(16).toString('base64url');
      sessions.set(sid, {});
      res.cookie(cookieName, sid, { httpOnly: true, sameSite: 'lax', path: '/' });
    }
    req.sid = sid;
    req.session = sessions.get(sid);
    next();
  });

  // ---------------------------------------------------------------- 로그인
  app.get('/login', async (req, res) => {
    const meta = await discover();
    const codeVerifier = b64(crypto.randomBytes(32));
    const state = b64(crypto.randomBytes(16));
    const nonce = b64(crypto.randomBytes(16));
    Object.assign(req.session, { state, nonce, codeVerifier });

    const url = new URL(meta.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
      state,
      nonce,
      code_challenge: b64(crypto.createHash('sha256').update(codeVerifier).digest()),
      code_challenge_method: 'S256',
      // resource 를 주면 액세스 토큰의 aud 가 그 API 로 고정된다 (RFC 8707)
      ...(resource ? { resource } : {}),
      ...(req.query.prompt ? { prompt: String(req.query.prompt) } : {}),
    }).toString();
    res.redirect(url.toString());
  });

  app.get('/callback', async (req, res) => {
    try {
      if (req.query.error) throw new Error(`${req.query.error}: ${req.query.error_description ?? ''}`);
      if (!req.session.state || req.query.state !== req.session.state) {
        throw new Error('state 불일치 (CSRF 의심)');
      }

      const tokens = await tokenRequest({
        grant_type: 'authorization_code',
        code: String(req.query.code),
        redirect_uri: redirectUri,
        code_verifier: req.session.codeVerifier,
        // 인가 때뿐 아니라 토큰 교환 때도 대상 API 를 명시해야
        // 액세스 토큰이 그 API 에 묶인다 (RFC 8707)
        ...(resource ? { resource } : {}),
      });

      // id_token 은 반드시 JWKS 로 서명 검증까지 한다 (디코드만 하면 위조를 못 잡는다)
      const { payload: idClaims } = await jwtVerify(tokens.id_token, await jwks(), {
        issuer: ISSUER,
        audience: clientId,
      });
      if (idClaims.nonce !== req.session.nonce) throw new Error('nonce 불일치 (리플레이 의심)');

      // resource 를 지정한 앱의 액세스 토큰은 aud 가 자기 API 라서 /userinfo 에 못 쓴다
      let userinfo = null;
      if (!resource) {
        const r = await fetch((await discover()).userinfo_endpoint, {
          headers: { authorization: `Bearer ${tokens.access_token}` },
        });
        userinfo = await r.json();
      }

      Object.assign(req.session, { tokens, idClaims, userinfo, error: null });

      // SSO 세션(sid) 기준 역인덱스 — 백채널 로그아웃 때 사용
      const ssoSid = idClaims.sid;
      if (ssoSid) {
        if (!bySsoSid.has(ssoSid)) bySsoSid.set(ssoSid, new Set());
        bySsoSid.get(ssoSid).add(req.sid);
      }
      res.redirect('/');
    } catch (e) {
      req.session.error = e.message;
      res.redirect('/');
    }
  });

  // ---------------------------------------------------------------- 로그아웃
  app.get('/logout', async (req, res) => {
    const meta = await discover();
    const idToken = req.session.tokens?.id_token;
    sessions.set(req.sid, {});

    const url = new URL(meta.end_session_endpoint);
    if (idToken) {
      url.searchParams.set('id_token_hint', idToken);
      url.searchParams.set('post_logout_redirect_uri', `${self}/`);
    }
    res.redirect(url.toString());
  });

  /** SSO 가 서버-서버로 호출하는 백채널 로그아웃 수신부 */
  app.post('/backchannel-logout', async (req, res) => {
    try {
      const { payload } = await jwtVerify(req.body.logout_token, await jwks(), {
        issuer: ISSUER,
        audience: clientId,
      });
      if (!payload.events?.['http://schemas.openid.net/event/backchannel-logout']) {
        return res.status(400).json({ error: 'invalid_request' });
      }
      // logout_token 에는 nonce 가 있으면 안 된다 (id_token 재사용 방지)
      if (payload.nonce) return res.status(400).json({ error: 'invalid_request' });

      const killed = bySsoSid.get(payload.sid) ?? new Set();
      for (const rpSid of killed) sessions.set(rpSid, { loggedOutBySso: true });
      bySsoSid.delete(payload.sid);

      console.log(`[${name}] 백채널 로그아웃 수신 — sid=${String(payload.sid).slice(0, 8)}…, 세션 ${killed.size}개 종료`);
      res.status(200).json({ ok: true, terminated: killed.size });
    } catch (e) {
      console.warn(`[${name}] 백채널 로그아웃 검증 실패: ${e.message}`);
      res.status(400).json({ error: 'invalid_token' });
    }
  });

  // ---------------------------------------------------------------- 화면
  const ctx = { discover, tokenRequest, jwks, sessions, self, clientId, resource, ISSUER };

  app.get('/', async (req, res) => {
    const s = req.session;
    const profile = s.userinfo ?? s.idClaims;
    const body = !profile
      ? `${s.error ? `<div class="msg err">${esc(s.error)}</div>` : ''}
         ${s.loggedOutBySso ? '<div class="msg ok">다른 앱에서 로그아웃되어 이 앱 세션도 백채널로 종료되었습니다.</div>' : ''}
         <h1><span class="dot"></span>${esc(name)}</h1>
         <p class="sub">client_id: <code>${esc(clientId)}</code> · issuer: <code>${esc(ISSUER)}</code></p>
         <div class="card"><p style="margin:0 0 16px">아직 로그인하지 않았습니다.</p>
           <a class="btn" href="/login">SSO 로그인</a>
           <a class="btn ghost" href="/login?prompt=login">강제 재인증</a></div>`
      : `${s.error ? `<div class="msg err">${esc(s.error)}</div>` : ''}
         <h1><span class="dot"></span>${esc(name)}</h1>
         <p class="sub">client_id: <code>${esc(clientId)}</code>${resource ? ` · resource: <code>${esc(resource)}</code>` : ''}</p>
         <div class="card">
           <div class="who">
             ${profile.picture ? `<img src="${esc(profile.picture)}" alt="">` : ''}
             <div><b>${esc(profile.name ?? profile.sub)}</b>
               <span>${esc(profile.email ?? '')} · sub=<code>${esc(s.idClaims.sub)}</code></span></div>
           </div>
           <table style="margin-top:16px">
             <tr><td>SSO 세션 sid</td><td><code>${esc(s.idClaims.sid)}</code></td></tr>
             <tr><td>auth_time</td><td>${new Date(s.idClaims.auth_time * 1000).toLocaleString('ko-KR')}</td></tr>
             <tr><td>액세스 토큰 aud</td><td><code>${esc(
               decodeJwt(s.tokens.access_token)?.aud ?? 'opaque (aud 없음)',
             )}</code></td></tr>
             <tr><td>scope</td><td><code>${esc(s.tokens.scope)}</code></td></tr>
           </table>
           <div style="margin-top:16px"><a class="btn ghost" href="/logout">SSO 로그아웃</a></div>
         </div>
         ${renderExtra ? await renderExtra(req, ctx) : ''}`;

    res.type('html').send(layout({ title: name, accent, self, body }));
  });

  if (extraRoutes) extraRoutes(app, ctx);

  app.listen(port, () => console.log(`[${name}] ${self}`));
  return app;
}

export { createRp, discover, decodeJwt };
