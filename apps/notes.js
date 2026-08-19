/**
 * 메모 앱 (:4100)
 * - OIDC 클라이언트(RP)이면서
 * - 동시에 자기 데이터를 내주는 API 서버(리소스 서버)다.
 * 포털은 이 앱의 /api/notes 를 SSO 에서 교환받은 토큰으로 호출한다.
 */
import { jwtVerify } from 'jose';
import { createRp } from './lib/rp.js';
import { esc } from './lib/ui.js';

const PORT = 4100;
const API_AUDIENCE = `http://localhost:${PORT}/api`;
const ISSUER = process.env.ISSUER ?? 'http://localhost:3000';

/** 사용자별 메모 (인메모리) */
const notes = new Map([
  ['user-1001', [
    { id: 'n1', title: '스프린트 회고', body: '토큰 교환 도입 검토 — aud 분리 효과 확인' },
    { id: 'n2', title: '장보기', body: '커피 원두, 우유' },
  ]],
  ['user-1002', [{ id: 'n3', title: '밥의 메모', body: '앨리스 토큰으로는 보이면 안 되는 내용' }]],
]);

/** API 호출 기록 — 포털이 대신 호출한 게 눈에 보이도록 */
const accessLog = [];

createRp({
  name: '메모 앱',
  port: PORT,
  clientId: 'notes-app',
  clientSecret: 'notes-secret',
  scope: 'openid profile email notes:read notes:write',
  // 자기 API 용 토큰을 인가 시점에 바로 받는다 (RFC 8707)
  resource: API_AUDIENCE,
  accent: '#0ca678',

  extraRoutes: (app, ctx) => {
    /** 액세스 토큰 검증 미들웨어 — 리소스 서버의 본체 */
    const requireToken = (requiredScope) => async (req, res, next) => {
      const header = req.headers.authorization;
      if (!header?.startsWith('Bearer ')) {
        res.setHeader('WWW-Authenticate', `Bearer realm="notes-api"`);
        return res.status(401).json({ error: 'invalid_token', error_description: 'Bearer 토큰이 필요합니다' });
      }
      try {
        const { payload } = await jwtVerify(header.slice(7), await ctx.jwks(), {
          issuer: ISSUER,
          // ★ aud 검사: 이 API 용으로 발급된 토큰만 받는다.
          //   포털의 로그인 토큰(aud=/userinfo)은 여기서 걸러진다.
          audience: API_AUDIENCE,
        });
        const scopes = String(payload.scope ?? '').split(/\s+/).filter(Boolean);
        if (!scopes.includes(requiredScope)) {
          res.setHeader('WWW-Authenticate', `Bearer error="insufficient_scope", scope="${requiredScope}"`);
          return res.status(403).json({ error: 'insufficient_scope', error_description: `${requiredScope} 가 필요합니다` });
        }
        req.token = payload;
        next();
      } catch (e) {
        res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
        return res.status(401).json({ error: 'invalid_token', error_description: e.message });
      }
    };

    app.get('/api/notes', requireToken('notes:read'), (req, res) => {
      const t = req.token;
      // act 가 있으면 다른 클라이언트가 사용자를 대신해 호출한 것
      const caller = t.act ? `${t.act.sub} (위임: ${t.client_id})` : t.client_id;
      accessLog.unshift({
        at: new Date().toLocaleTimeString('ko-KR'),
        caller,
        delegated: !!t.act,
        sub: t.sub,
        scope: t.scope,
      });
      accessLog.length = Math.min(accessLog.length, 8);

      // 토큰의 sub 에 해당하는 사용자의 메모만 내려준다
      res.json({
        owner: t.sub,
        calledBy: caller,
        notes: notes.get(String(t.sub)) ?? [],
      });
    });
  },

  renderExtra: async (req, ctx) => {
    const s = req.session;
    let mine = null;
    let error = null;
    try {
      // 자기 API 도 토큰으로 호출한다 (같은 프로세스라고 특별 대우하지 않는다)
      const r = await fetch(`${API_AUDIENCE}/notes`, {
        headers: { authorization: `Bearer ${s.tokens.access_token}` },
      });
      const json = await r.json();
      if (!r.ok) throw new Error(`${json.error}: ${json.error_description}`);
      mine = json.notes;
    } catch (e) {
      error = e.message;
    }

    return `
      <div class="card">
        <h2>내 메모 — 자기 API 호출</h2>
        <p class="sub" style="margin-bottom:14px">로그인 때 <code>resource=${esc(API_AUDIENCE)}</code> 를 함께 요청해서
          받은 토큰(aud 가 이 API)으로 호출했습니다.</p>
        ${error ? `<div class="msg err">${esc(error)}</div>` : ''}
        ${(mine ?? []).map((n) => `<div class="note"><b>${esc(n.title)}</b><span>${esc(n.body)}</span></div>`).join('') || '<p class="sub">메모 없음</p>'}
      </div>
      <div class="card">
        <h2>API 호출 기록</h2>
        <p class="sub" style="margin-bottom:14px">포털에서 <b>메모 가져오기</b> 를 누르면 여기에 위임 호출이 찍힙니다.</p>
        ${
          accessLog.length
            ? accessLog.map((l) => `<div class="note"><b>${esc(l.at)} · ${esc(l.caller)}
                 ${l.delegated ? '<span class="badge err">위임 호출</span>' : '<span class="badge ok">직접 호출</span>'}</b>
                 <span>sub=${esc(l.sub)} · scope=${esc(l.scope)}</span></div>`).join('')
            : '<p class="sub">아직 호출 없음</p>'
        }
      </div>`;
  },
});
