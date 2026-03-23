import { NextResponse } from "next/server";

const PASSWORD = process.env.SITE_PASSWORD || "";
const COOKIE = "thisbe-gate";
const MAX_AGE = 604800;
const LOGIN = "/thisbe/login";
const VERIFY = "/thisbe/verify";

const enc = new TextEncoder();
const hmac = (s) =>
  crypto.subtle.importKey(
    "raw",
    enc.encode(s),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

async function signToken(val, secret) {
  const key = await hmac(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(val));
  return (
    val +
    "." +
    Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

async function checkToken(signed, secret) {
  try {
    const i = signed.lastIndexOf(".");
    if (i < 1) return false;
    const pairs = signed.slice(i + 1).match(/.{2}/g);
    if (!pairs) return false;
    const key = await hmac(secret);
    return crypto.subtle.verify(
      "HMAC",
      key,
      new Uint8Array(pairs.map((h) => parseInt(h, 16))),
      enc.encode(signed.slice(0, i)),
    );
  } catch {
    return false;
  }
}

const PAGE = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Meadowsyn</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,sans-serif;background:#09090b;color:#fafafa;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:1rem}.c{width:100%;max-width:380px;text-align:center}h1{font-size:1.25rem;font-weight:600;margin-bottom:.5rem}p{color:#a1a1aa;font-size:.875rem;margin-bottom:1.5rem}form{display:flex;flex-direction:column;gap:.75rem}input[type=password]{width:100%;padding:.625rem .875rem;background:#18181b;border:1px solid #27272a;border-radius:.5rem;color:#fafafa;font-size:.875rem;outline:none}input:focus{border-color:#fafafa}button{padding:.625rem;background:#fafafa;color:#09090b;border:none;border-radius:.5rem;font-size:.875rem;font-weight:500;cursor:pointer}button:hover{opacity:.9}.e{color:#ef4444;font-size:.8125rem;margin-bottom:.5rem}.f{margin-top:2rem;font-size:.75rem;color:#3f3f46}</style></head><body><div class="c"><h1>Meadowsyn is not yet public</h1><p>Enter the password to continue.</p><!--E--><form method="POST" action="/thisbe/verify"><input type="password" name="password" placeholder="Password" autofocus required/><input type="hidden" name="redirect" value="/"/><button type="submit">Enter</button></form><div class="f">Protected by Thisbe</div></div></body></html>`;

export async function middleware(req) {
  try {
    if (!PASSWORD) return NextResponse.next();
    const url = new URL(req.url);
    const p = url.pathname;
    if (p.startsWith("/_next/") || p === "/favicon.ico")
      return NextResponse.next();

    if (p === LOGIN) {
      const e = url.searchParams.get("error") === "1";
      const html = e
        ? PAGE.replace("<!--E-->", '<div class="e">Wrong password.</div>')
        : PAGE.replace("<!--E-->", "");
      return new NextResponse(html, {
        headers: { "content-type": "text/html;charset=utf-8" },
      });
    }

    if (p === VERIFY && req.method === "POST") {
      const fd = await req.formData();
      const pw = fd.get("password");
      const rd = fd.get("redirect") || "/";
      if (pw === PASSWORD) {
        const tok = await signToken(String(Date.now()), PASSWORD);
        const res = NextResponse.redirect(new URL(rd, req.url));
        res.cookies.set(COOKIE, tok, {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          maxAge: MAX_AGE,
          path: "/",
        });
        return res;
      }
      return NextResponse.redirect(new URL(LOGIN + "?error=1", req.url));
    }

    const c = req.cookies.get(COOKIE);
    if (c && (await checkToken(c.value, PASSWORD))) return NextResponse.next();
    return NextResponse.redirect(new URL(LOGIN, req.url));
  } catch (e) {
    return new NextResponse("Error: " + (e?.message || e), { status: 500 });
  }
}
