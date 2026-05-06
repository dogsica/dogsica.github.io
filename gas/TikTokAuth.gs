// 🔐 TikTokAuth.gs
// OAuth 2.0 helpers for the TikTok "Dogsica Comic Bot" app (Sandbox: First Sandbox).
// Required Script Properties:
//   TIKTOK_CLIENT_KEY       — from the TikTok Developer Portal
//   TIKTOK_CLIENT_SECRET    — from the TikTok Developer Portal
//   TIKTOK_REDIRECT_URI     — "https://dogsica.github.io/oauth/callback.html"
// Stored automatically (do not set by hand):
//   TIKTOK_ACCESS_TOKEN
//   TIKTOK_ACCESS_TOKEN_EXP — epoch ms
//   TIKTOK_REFRESH_TOKEN
//   TIKTOK_REFRESH_TOKEN_EXP — epoch ms
//   TIKTOK_OPEN_ID
//   TIKTOK_PKCE_VERIFIER     — temporary, used during initial auth

const TIKTOK_AUTH_URL  = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const TIKTOK_SCOPES    = 'user.info.basic,video.upload,video.publish';

function tt_props_() { return PropertiesService.getScriptProperties(); }

function tt_required_(keys) {
  const p = tt_props_();
  const out = {};
  keys.forEach(k => {
    const v = p.getProperty(k);
    if (!v) throw new Error('Missing Script Property: ' + k);
    out[k] = v;
  });
  return out;
}

// --- PKCE helpers ---
function tt_b64url_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}
function tt_makeVerifier_() {
  const bytes = [];
  for (let i = 0; i < 64; i++) bytes.push(Math.floor(Math.random() * 256));
  return tt_b64url_(bytes).slice(0, 96);
}
function tt_codeChallenge_(verifier) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, verifier, Utilities.Charset.US_ASCII);
  return tt_b64url_(digest);
}

/**
 * STEP 1 of the one-time setup.
 * Run this from the Apps Script editor; it logs an authorization URL.
 * Open that URL in a browser logged into the @dogsica TikTok account,
 * approve, and TikTok redirects to https://dogsica.github.io/oauth/callback.html?code=...
 * Copy the "code" query-string value, then call tiktokExchangeCode_('THE_CODE') below.
 */
function tiktokStartAuth() {
  const cfg = tt_required_(['TIKTOK_CLIENT_KEY', 'TIKTOK_REDIRECT_URI']);
  const verifier  = tt_makeVerifier_();
  const challenge = tt_codeChallenge_(verifier);
  const state     = Utilities.getUuid();
  tt_props_().setProperty('TIKTOK_PKCE_VERIFIER', verifier);
  tt_props_().setProperty('TIKTOK_AUTH_STATE', state);

  const url = TIKTOK_AUTH_URL +
    '?client_key='    + encodeURIComponent(cfg.TIKTOK_CLIENT_KEY) +
    '&response_type=code' +
    '&scope='         + encodeURIComponent(TIKTOK_SCOPES) +
    '&redirect_uri='  + encodeURIComponent(cfg.TIKTOK_REDIRECT_URI) +
    '&state='         + encodeURIComponent(state) +
    '&code_challenge='        + encodeURIComponent(challenge) +
    '&code_challenge_method=S256';

  console.log('Open this URL while signed in to the @dogsica TikTok account:');
  console.log(url);
  console.log('After approving, copy the ?code=... value and run tiktokExchangeCode_(\'THAT_CODE\').');
}

/**
 * STEP 2 of the one-time setup. Pass the "code" you got back on the redirect.
 * Edit this function temporarily to paste your code, then run it once.
 */
function tiktokExchangeCode_(authCode) {
  const cfg = tt_required_(['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REDIRECT_URI']);
  const verifier = tt_props_().getProperty('TIKTOK_PKCE_VERIFIER');
  if (!verifier) throw new Error('No PKCE verifier on file. Run tiktokStartAuth() first.');

  const r = UrlFetchApp.fetch(TIKTOK_TOKEN_URL, {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    muteHttpExceptions: true,
    headers: { 'Cache-Control': 'no-cache' },
    payload: {
      client_key: cfg.TIKTOK_CLIENT_KEY,
      client_secret: cfg.TIKTOK_CLIENT_SECRET,
      code: authCode,
      grant_type: 'authorization_code',
      redirect_uri: cfg.TIKTOK_REDIRECT_URI,
      code_verifier: verifier
    }
  });
  const code = r.getResponseCode();
  const body = r.getContentText();
  if (code < 200 || code >= 300) throw new Error('Token exchange failed (' + code + '): ' + body);
  tt_storeTokens_(JSON.parse(body));
  tt_props_().deleteProperty('TIKTOK_PKCE_VERIFIER');
  console.log('TikTok tokens stored. open_id:', tt_props_().getProperty('TIKTOK_OPEN_ID'));
}

function tt_storeTokens_(j) {
  const now = Date.now();
  const p = tt_props_();
  if (j.access_token)  p.setProperty('TIKTOK_ACCESS_TOKEN', j.access_token);
  if (j.refresh_token) p.setProperty('TIKTOK_REFRESH_TOKEN', j.refresh_token);
  if (j.open_id)       p.setProperty('TIKTOK_OPEN_ID', j.open_id);
  if (j.expires_in)         p.setProperty('TIKTOK_ACCESS_TOKEN_EXP',  String(now + (Number(j.expires_in)         - 60)  * 1000));
  if (j.refresh_expires_in) p.setProperty('TIKTOK_REFRESH_TOKEN_EXP', String(now + (Number(j.refresh_expires_in) - 600) * 1000));
}

/** Returns a valid access token, refreshing if needed. */
function tiktokGetAccessToken_() {
  const p = tt_props_();
  const access = p.getProperty('TIKTOK_ACCESS_TOKEN');
  const expStr = p.getProperty('TIKTOK_ACCESS_TOKEN_EXP');
  const exp = expStr ? Number(expStr) : 0;
  if (access && Date.now() < exp) return access;
  return tiktokRefreshAccessToken_();
}

function tiktokRefreshAccessToken_() {
  const cfg = tt_required_(['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET']);
  const refresh = tt_props_().getProperty('TIKTOK_REFRESH_TOKEN');
  if (!refresh) throw new Error('No TikTok refresh token. Run tiktokStartAuth() then tiktokExchangeCode_().');

  const r = UrlFetchApp.fetch(TIKTOK_TOKEN_URL, {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    muteHttpExceptions: true,
    headers: { 'Cache-Control': 'no-cache' },
    payload: {
      client_key: cfg.TIKTOK_CLIENT_KEY,
      client_secret: cfg.TIKTOK_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refresh
    }
  });
  const code = r.getResponseCode();
  const body = r.getContentText();
  if (code < 200 || code >= 300) throw new Error('Refresh failed (' + code + '): ' + body);
  const j = JSON.parse(body);
  tt_storeTokens_(j);
  return j.access_token;
}

/** Quick smoke-test you can Run from the dropdown. */
function testTikTokToken() {
  const t = tiktokGetAccessToken_();
  console.log('Access token length:', t ? t.length : 0);
  console.log('open_id:', tt_props_().getProperty('TIKTOK_OPEN_ID'));
}


/**
 * 🔧 ONE-TIME: paste the auth code you got back from
 * https://dogsica.github.io/oauth/callback.html?code=...
 * between the quotes below, save, then click ▶ Run on this function.
 */
function completeOAuth() {
  const AUTH_CODE = ""; // <-- paste a fresh auth code here, save, then run
  if (!AUTH_CODE) throw new Error("Paste the authorization code into AUTH_CODE.");
  const result = tiktokExchangeCode_(AUTH_CODE);
  Logger.log("Token exchange OK. Open ID: " + (result && result.open_id ? result.open_id : "(none)"));
}
