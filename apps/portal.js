/**
 * 사내 포털 (:4000)
 * 로그인한 사용자를 대신해서 **다른 앱(메모 앱 :4100)의 API** 를 호출한다.
 * 자기 로그인 토큰을 그대로 쓰지 않고, SSO 에서 메모 API 전용 토큰으로 교환(RFC 8693)해서 쓴다.
 */
import { createRp, decodeJwt } from './lib/rp.js';
import { esc } from './lib/ui.js';

const NOTES_API = 'http://localhost:4100/api';
const TOKEN_EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange';

createRp({
  name: '사내 포털',
  port: 4000,
  clientId: 'portal-app',
  clientSecret: 'portal-secret',
  scope: 'openid profile email offline_access notes:read',
  accent: '#3b5bdb',

  extraRoutes: (app, ctx) => {
    /** ★ 핵심: 토큰 교환 → 다른 앱 API 호출 */
    app.get('/fetch-notes', async (req, res) => {
      const s = req.session;
      if (!s.tokens) return res.redirect('/');
      const trace = [];
      try {
        // 1) 내 로그인 토큰을 내밀고 메모 API 용 토큰을 받아온다
        const exchanged = await ctx.tokenRequest({
          grant_type: TOKEN_EXCHANGE,
          subject_token: s.tokens.access_token,
          subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          audience: NOTES_API,
          scope: 'notes:read',
        });
        const claims = decodeJwt(exchanged.access_token);
        trace.push({
          step: '1. SSO 토큰 교환',
          detail: claims
            ? `aud=${claims.aud} · scope=${exchanged.scope} · act.sub=${claims.act?.sub}`
            : `scope=${exchanged.scope} (불투명 토큰)`,
        });

        // 2) 받은 토큰으로 다른 앱의 API 를 호출한다
        const r = await fetch(`${NOTES_API}/notes`, {
          headers: { authorization: `Bearer ${exchanged.access_token}` },
        });
        const json = await r.json();
        trace.push({ step: '2. 메모 앱 API 호출', detail: `GET ${NOTES_API}/notes → ${r.status}` });
        if (!r.ok) throw new Error(`${json.error}: ${json.error_description ?? ''}`);

        s.notes = { items: json.notes, calledBy: json.calledBy, claims, trace };
        s.notesError = null;
      } catch (e) {
        s.notes = null;
        s.notesError = { message: e.message, trace };
      }
      res.redirect('/');
    });

    /** 대조군: 교환하지 않은 로그인 토큰으로 그대로 호출해 본다 → aud 불일치로 거부 */
    app.get('/fetch-notes-raw', async (req, res) => {
      const s = req.session;
      if (!s.tokens) return res.redirect('/');
      const claims = decodeJwt(s.tokens.access_token);
      const audLabel = claims?.aud ?? 'opaque (aud 없음)';
      const r = await fetch(`${NOTES_API}/notes`, {
        headers: { authorization: `Bearer ${s.tokens.access_token}` },
      });
      const json = await r.json().catch(() => ({}));
      s.notes = null;
      s.notesError = {
        message: `${r.status} ${json.error ?? ''} — ${json.error_description ?? ''}`,
        trace: [
          { step: '교환 없이 로그인 토큰 그대로 사용', detail: `aud=${audLabel}` },
          { step: '메모 앱이 aud 검사에서 거부', detail: `기대한 aud=${NOTES_API}` },
        ],
      };
      res.redirect('/');
    });
  },

  renderExtra: async (req) => {
    const s = req.session;
    return `
      <div class="card">
        <h2>다른 앱(메모 :4100)의 API 호출</h2>
        <p class="sub" style="margin-bottom:16px">
          포털은 메모 앱의 DB를 직접 보지 않습니다. SSO 에서 <b>메모 API 전용 토큰</b>으로 교환한 뒤
          HTTP 로 요청합니다.</p>
        <a class="btn" href="/fetch-notes">토큰 교환 → 메모 가져오기</a>
        <a class="btn ghost" href="/fetch-notes-raw">교환 없이 호출해보기 (거부됨)</a>

        ${
          s.notesError
            ? `<div class="msg err" style="margin-top:16px">${esc(s.notesError.message)}</div>
               ${s.notesError.trace.map((t) => `<div class="note"><b>${esc(t.step)}</b><span>${esc(t.detail)}</span></div>`).join('')}`
            : ''
        }
        ${
          s.notes
            ? `<div class="msg ok" style="margin-top:16px">메모 앱이 <code>${esc(s.notes.calledBy)}</code> 의 호출로 인식했습니다.</div>
               ${s.notes.trace.map((t) => `<div class="note"><b>${esc(t.step)}</b><span>${esc(t.detail)}</span></div>`).join('')}
               <h2 style="margin:20px 0 10px">받아온 메모</h2>
               ${s.notes.items.map((n) => `<div class="note"><b>${esc(n.title)}</b><span>${esc(n.body)}</span></div>`).join('')}
               ${s.notes.claims ? `<h2 style="margin:20px 0 10px">교환된 토큰의 클레임</h2>
               <pre>${esc(JSON.stringify(s.notes.claims, null, 2))}</pre>` : ''}`
            : ''
        }
      </div>`;
  },
});
