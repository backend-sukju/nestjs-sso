const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

const layout = (title: string, body: string): string => `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root{--bg:#f4f5f7;--card:#fff;--fg:#1a1c20;--muted:#6b7280;--line:#e4e6eb;--accent:#3b5bdb;--accent-fg:#fff;--danger:#c92a2a}
  @media (prefers-color-scheme:dark){:root{--bg:#15171c;--card:#1e2128;--fg:#e8eaed;--muted:#9aa1ac;--line:#2e323b;--accent:#5c7cfa;--danger:#ff8787}}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
    background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Pretendard","Apple SD Gothic Neo",Segoe UI,sans-serif}
  .card{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px}
  h1{margin:0 0 4px;font-size:20px}
  .sub{margin:0 0 22px;color:var(--muted);font-size:13px}
  label{display:block;margin:14px 0 6px;font-size:13px;font-weight:600}
  input[type=text],input[type=password]{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;
    background:transparent;color:var(--fg);font-size:15px}
  input:focus{outline:2px solid var(--accent);outline-offset:-1px;border-color:transparent}
  button{width:100%;margin-top:18px;padding:11px;border:0;border-radius:8px;background:var(--accent);color:var(--accent-fg);
    font-size:15px;font-weight:600;cursor:pointer}
  button.ghost{background:transparent;color:var(--muted);border:1px solid var(--line);margin-top:8px}
  .err{margin:0 0 16px;padding:10px 12px;border-radius:8px;background:color-mix(in srgb,var(--danger) 12%,transparent);
    color:var(--danger);font-size:13px}
  .scopes{margin:0;padding:0;list-style:none;border:1px solid var(--line);border-radius:10px;overflow:hidden}
  .scopes li{padding:11px 14px;border-top:1px solid var(--line)}
  .scopes li:first-child{border-top:0}
  .scopes code{font-size:12px;color:var(--accent)}
  .scopes p{margin:2px 0 0;font-size:13px;color:var(--muted)}
  .hint{margin-top:20px;padding-top:16px;border-top:1px dashed var(--line);font-size:12px;color:var(--muted)}
  .hint code{background:var(--bg);padding:1px 5px;border-radius:4px}
  .row{display:flex;gap:8px}.row button{margin-top:18px}
</style></head><body><main class="card">${body}</main></body></html>`;

export const loginPage = (opts: {
  authRequestId: string;
  clientName: string;
  error?: string;
  username?: string;
  /** 폼 제출 경로 (상호작용 라우트) */
  action: string;
}): string =>
  layout(
    '로그인 · SSO',
    `<h1>로그인</h1>
     <p class="sub"><strong>${esc(opts.clientName)}</strong> 이(가) 로그인을 요청했습니다.</p>
     ${opts.error ? `<p class="err">${esc(opts.error)}</p>` : ''}
     <form method="post" action="${esc(opts.action)}">
       <input type="hidden" name="auth_request_id" value="${esc(opts.authRequestId)}">
       <label for="username">아이디</label>
       <input id="username" name="username" type="text" autocomplete="username" autofocus value="${esc(opts.username)}">
       <label for="password">비밀번호</label>
       <input id="password" name="password" type="password" autocomplete="current-password">
       <button type="submit">로그인</button>
     </form>
     <p class="hint">목업 계정 — <code>alice / password123</code>, <code>bob / password123</code></p>`,
  );

export const consentPage = (opts: {
  authRequestId: string;
  clientName: string;
  userName: string;
  scopes: string[];
  action: string;
  /** scope 설명 — 정의를 소유한 레지스트리에서 주입한다 */
  labels: Record<string, string>;
}): string =>
  layout(
    '동의 · SSO',
    `<h1>권한 요청</h1>
     <p class="sub"><strong>${esc(opts.clientName)}</strong> 이(가) ${esc(opts.userName)} 님의 계정에 접근하려 합니다.</p>
     <ul class="scopes">
       ${opts.scopes
         .map(
           (s) =>
             `<li><code>${esc(s)}</code><p>${esc(opts.labels[s] ?? '추가 권한')}</p></li>`,
         )
         .join('')}
     </ul>
     <form method="post" action="${esc(opts.action)}">
       <input type="hidden" name="auth_request_id" value="${esc(opts.authRequestId)}">
       <div class="row">
         <button type="submit" name="decision" value="deny" class="ghost">거부</button>
         <button type="submit" name="decision" value="allow">허용</button>
       </div>
     </form>`,
  );

export const errorPage = (error: string, description: string): string =>
  layout(
    '오류 · SSO',
    `<h1>요청을 처리할 수 없습니다</h1>
     <p class="sub">인가 요청이 잘못되어 클라이언트로 되돌려 보낼 수 없습니다.</p>
     <p class="err"><strong>${esc(error)}</strong><br>${esc(description)}</p>`,
  );

export const loggedOutPage = (notified: string[] = []): string =>
  layout(
    '로그아웃 · SSO',
    `<h1>로그아웃되었습니다</h1>
     <p class="sub">SSO 세션과 이 세션에서 발급된 리프레시 토큰이 모두 폐기되었습니다.</p>
     ${
       notified.length
         ? `<h2 style="font-size:13px;color:var(--muted);margin:0 0 8px">백채널 로그아웃 통지</h2>
            <ul class="scopes">${notified.map((n) => `<li><code>${esc(n)}</code></li>`).join('')}</ul>`
         : ''
     }`,
  );
