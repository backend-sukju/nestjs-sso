const esc = (v) =>
  String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** 세 앱이 공유하는 상단 네비게이션 — 클릭만으로 SSO 동작을 확인할 수 있게 한다 */
const APPS = [
  { name: '사내 포털', url: 'http://localhost:4000' },
  { name: '메모 앱', url: 'http://localhost:4100' },
  { name: '관리 콘솔', url: 'http://localhost:4200' },
];

const STYLE = `
 :root{--bg:#f4f5f7;--card:#fff;--fg:#1a1c20;--muted:#6b7280;--line:#e4e6eb;--ok:#2f9e44;--warn:#e8590c;--err:#c92a2a}
 @media(prefers-color-scheme:dark){:root{--bg:#15171c;--card:#1e2128;--fg:#e8eaed;--muted:#9aa1ac;--line:#2e323b;--ok:#51cf66;--warn:#ff922b;--err:#ff8787}}
 *{box-sizing:border-box}
 body{margin:0;padding:0 20px 60px;background:var(--bg);color:var(--fg);
   font:15px/1.6 -apple-system,BlinkMacSystemFont,"Pretendard","Apple SD Gothic Neo",Segoe UI,sans-serif}
 nav{position:sticky;top:0;display:flex;gap:6px;align-items:center;flex-wrap:wrap;
   margin:0 -20px 28px;padding:12px 20px;background:var(--card);border-bottom:1px solid var(--line)}
 nav a{padding:6px 12px;border-radius:7px;text-decoration:none;color:var(--muted);font-size:13.5px;font-weight:600}
 nav a.on{background:var(--accent);color:#fff}
 nav .sp{flex:1}
 main{max-width:760px;margin:0 auto}
 h1{font-size:23px;margin:0 0 4px} h1 .dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--accent);margin-right:9px}
 h2{font-size:13px;margin:0 0 10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
 p.sub{margin:0 0 26px;color:var(--muted);font-size:13.5px}
 .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px;margin-bottom:16px}
 a.btn,button.btn{display:inline-block;padding:9px 16px;border:0;border-radius:8px;background:var(--accent);color:#fff;
   text-decoration:none;font-weight:600;font-size:13.5px;margin:0 6px 6px 0;cursor:pointer;font-family:inherit}
 a.btn.ghost{background:transparent;color:var(--muted);border:1px solid var(--line)}
 pre{margin:0;padding:13px;background:var(--bg);border-radius:8px;overflow-x:auto;font-size:12.5px;line-height:1.5}
 code{font-size:12.5px}
 .who{display:flex;align-items:center;gap:14px}
 .who img{width:50px;height:50px;border-radius:50%}
 .who b{display:block;font-size:17px} .who span{color:var(--muted);font-size:13px}
 .badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:11.5px;font-weight:700;vertical-align:middle}
 .badge.ok{background:color-mix(in srgb,var(--ok) 18%,transparent);color:var(--ok)}
 .badge.err{background:color-mix(in srgb,var(--err) 18%,transparent);color:var(--err)}
 .note{padding:12px 14px;border:1px solid var(--line);border-radius:9px;margin-bottom:8px}
 .note b{display:block;font-size:14px} .note span{color:var(--muted);font-size:12.5px}
 .msg{padding:12px 14px;border-radius:9px;font-size:13.5px;margin-bottom:16px}
 .msg.err{background:color-mix(in srgb,var(--err) 12%,transparent);color:var(--err)}
 .msg.ok{background:color-mix(in srgb,var(--ok) 12%,transparent);color:var(--ok)}
 table{width:100%;border-collapse:collapse;font-size:13px}
 td{padding:6px 0;border-top:1px solid var(--line);vertical-align:top}
 td:first-child{width:130px;color:var(--muted)}
`;

function layout({ title, accent, self, body }) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>:root{--accent:${accent}}${STYLE}</style></head><body>
<nav>${APPS.map((a) => `<a class="${a.url === self ? 'on' : ''}" href="${a.url}">${esc(a.name)}</a>`).join('')}
 <span class="sp"></span><a href="http://localhost:3000/" style="font-size:12px">SSO :3000</a></nav>
<main>${body}</main></body></html>`;
}

export { esc, layout, APPS };
