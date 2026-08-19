/**
 * 관리 콘솔 (:4200)
 * 세 번째 클라이언트. SSO 로 로그인 화면 없이 들어오는 것과,
 * 허용되지 않은 앱은 남의 API 토큰을 받아갈 수 없다는 것을 보여준다.
 */
import { createRp } from './lib/rp.js';
import { esc } from './lib/ui.js';

const NOTES_API = 'http://localhost:4100/api';

createRp({
  name: '관리 콘솔',
  port: 4200,
  clientId: 'admin-app',
  clientSecret: 'admin-secret',
  scope: 'openid profile email',
  accent: '#9c36b5',

  extraRoutes: (app, ctx) => {
    /** 메모 API 토큰을 요구해본다 — 이 클라이언트는 허용 목록에 없어 거부된다 */
    app.get('/try-notes', async (req, res) => {
      const s = req.session;
      if (!s.tokens) return res.redirect('/');
      try {
        await ctx.tokenRequest({
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          subject_token: s.tokens.access_token,
          subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          audience: NOTES_API,
          scope: 'notes:read',
        });
        s.tryResult = { ok: true, message: '토큰이 발급되었습니다 (기대와 다름)' };
      } catch (e) {
        s.tryResult = { ok: false, message: e.message };
      }
      res.redirect('/');
    });
  },

  renderExtra: async (req) => {
    const s = req.session;
    return `
      <div class="card">
        <h2>권한 경계 확인</h2>
        <p class="sub" style="margin-bottom:16px">관리 콘솔은 클라이언트 등록 정보에 메모 API 가 없습니다.
          같은 사용자로 로그인해도 남의 앱 API 토큰은 받을 수 없습니다.</p>
        <a class="btn" href="/try-notes">메모 API 토큰 교환 시도</a>
        ${
          s.tryResult
            ? `<div class="msg ${s.tryResult.ok ? 'ok' : 'err'}" style="margin-top:16px">
                 ${s.tryResult.ok ? '' : 'SSO 가 거부: '}${esc(s.tryResult.message)}</div>`
            : ''
        }
      </div>`;
  },
});
