// 🚀 Runner.gs
// Wires Drive → GitHub → TikTok for the daily comic post.
// Uses constants and helpers from Code.gs (OUTPUT_FOLDER_ID, getRandomComics, etc.).

const TIKTOK_IMAGE_EXT_ALLOW = ['jpg', 'jpeg', 'png', 'webp'];

/**
 * Find an existing AM/PM Drive folder for today. Returns null if none.
 * @param {"AM"|"PM"} slot
 */
function runner_findTodaysFolder_(slot) {
  const output = DriveApp.getFolderById(OUTPUT_FOLDER_ID);
  const dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM dd, yyyy');
  const name = (slot === 'AM' ? 'Morning' : 'Evening') + ' Upload - ' + dateStr;
  const it = output.getFoldersByName(name);
  return it.hasNext() ? it.next() : null;
}

/**
 * Take a Drive folder (AM/PM Upload), upload its images to GitHub Pages,
 * then post them as a TikTok photo carousel via Direct Post.
 * @param {GoogleAppsScript.Drive.Folder} folder
 * @param {"AM"|"PM"} slot
 */
function runner_stageFolder_(folder, slot) {
  if (!folder) throw new Error("No folder provided");

  // 1. Collect images, sorted by name
  const images = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const ext = (f.getName().split(".").pop() || "").toLowerCase();
    if (TIKTOK_IMAGE_EXT_ALLOW.indexOf(ext) !== -1) images.push(f);
  }
  images.sort((a, b) => a.getName().localeCompare(b.getName()));
  if (images.length === 0) throw new Error("No images in folder " + folder.getName());

  const props = PropertiesService.getScriptProperties();
  const owner = props.getProperty("GITHUB_OWNER");
  const repo = props.getProperty("GITHUB_REPO");
  const branch = props.getProperty("GITHUB_BRANCH");
  const pagesBase = props.getProperty("GITHUB_PAGES_BASE");
  const pat = props.getProperty("GITHUB_PAT");
  if (!owner || !repo || !branch || !pagesBase || !pat) throw new Error("Missing GitHub script properties");

  const ymd = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const ttUrls = [];

  // 2. For each image: convert -> upload source -> weserv resize -> upload resized.
  //    No per-image Pages waits. Whole site rebuilds once after the last commit.
  for (let i = 0; i < images.length; i++) {
    const f = images[i];
    const baseName = f.getName().replace(/\.[^.]+$/, "");
    Logger.log("[" + (i + 1) + "/" + images.length + "] " + f.getName());
    try {
      const srcJpegBlob = f.getBlob().getAs("image/jpeg");
      srcJpegBlob.setName(baseName + ".jpg");
      const srcPath = "comics/" + ymd + "/" + slot + "/" + baseName + ".jpg";
      uploadBlobToGitHub_(srcJpegBlob, srcPath, "src " + slot + " " + baseName + " " + ymd);
      const rawUrl = "https://raw.githubusercontent.com/" + owner + "/" + repo + "/" + branch + "/" + srcPath;
      const weservUrl = "https://images.weserv.nl/?url=" + encodeURIComponent(rawUrl.replace(/^https?:\/\//, "")) + "&w=1080&h=1920&fit=inside&output=jpg&q=85";
      const resp = UrlFetchApp.fetch(weservUrl, {muteHttpExceptions: true, followRedirects: true});
      if (resp.getResponseCode() !== 200) {
        Logger.log("  SKIP (weserv " + resp.getResponseCode() + ")");
        continue;
      }
      const resizedBlob = resp.getBlob().setContentType("image/jpeg");
      resizedBlob.setName(baseName + "_tt.jpg");
      const ttPath = "comics/" + ymd + "/" + slot + "/" + baseName + "_tt.jpg";
      uploadBlobToGitHub_(resizedBlob, ttPath, "tt " + slot + " " + baseName + " " + ymd);
      const ttPagesUrl = pagesBase.replace(/\/$/, "") + "/" + ttPath;
      ttUrls.push(ttPagesUrl);
      Logger.log("  ok: " + resizedBlob.getBytes().length + " bytes -> " + ttPagesUrl);
    } catch (e) {
      Logger.log("  SKIP (" + (e && e.message ? e.message : e) + ")");
      continue;
    }
  }

  if (ttUrls.length === 0) throw new Error("No images successfully uploaded for " + slot);

  // 3. Save staged data to Script Properties for the Step2 publish run to consume.
  const titleStr = "Daily comics " + ymd + " (" + slot + ")";
  const description = "Your daily dose of comics! #comics #dailycomics #funny #webcomic";
  const stagedKey = "STAGED_" + slot;
  const stagedPayload = JSON.stringify({ymd: ymd, slot: slot, urls: ttUrls, title: titleStr, description: description, stagedAt: new Date().toISOString()});
  props.setProperty(stagedKey, stagedPayload);
  Logger.log("Staged " + ttUrls.length + " URLs under property " + stagedKey);
  return {urls: ttUrls, title: titleStr, description: description};
}

/** Step 2: read staged URLs for the slot and post to TikTok. */
function runner_postStaged_(slot) {
  const props = PropertiesService.getScriptProperties();
  const stagedKey = "STAGED_" + slot;
  const raw = props.getProperty(stagedKey);
  if (!raw) throw new Error("No staged data found for slot " + slot + " (run stage first)");
  const staged = JSON.parse(raw);
  Logger.log("Loaded staged " + slot + " from " + staged.stagedAt + " with " + staged.urls.length + " URLs");
  // Wait for each staged URL to be served by GitHub Pages before handing to TikTok.
  for (let k = 0; k < staged.urls.length; k++) {
    Logger.log("verifying live: " + staged.urls[k]);
    waitForUrlLive_(staged.urls[k], 180000, 5000);
  }

  const publishId = tiktokPostPhotoCarousel_(staged.urls, { title: staged.title, description: staged.description });
  props.setProperty("LAST_PUBLISH_ID", publishId);
  props.deleteProperty(stagedKey);
  Logger.log("publish_id: " + publishId);
  return publishId;
}

/** Helper: schedule a one-shot trigger to fire functionName ~minutes from now. */
function scheduleOneShot_(functionName, minutesFromNow) {
  // Clean up any existing triggers for this function so we do not stack them.
  const all = ScriptApp.getProjectTriggers();
  for (const t of all) {
    if (t.getHandlerFunction() === functionName) ScriptApp.deleteTrigger(t);
  }
  const when = new Date(Date.now() + minutesFromNow * 60 * 1000);
  ScriptApp.newTrigger(functionName).timeBased().at(when).create();
  Logger.log("Scheduled " + functionName + " for " + when.toISOString());
}

/** Helper: delete all triggers for the given function name (for self-cleanup at end of step2). */
function deleteOwnTriggers_(functionName) {
  const all = ScriptApp.getProjectTriggers();
  for (const t of all) {
    if (t.getHandlerFunction() === functionName) ScriptApp.deleteTrigger(t);
  }
}

/** Run the morning STAGE: Drive -> GitHub. Schedules step2 ~5 min later for the TikTok post. */
function runMorningPublish() {
  let folder = runner_findTodaysFolder_("AM");
  if (!folder) {
    createDailyComicFolder();
    folder = runner_findTodaysFolder_("AM");
  }
  if (!folder) throw new Error("Could not find/create morning folder");
  runner_stageFolder_(folder, "AM");
  scheduleOneShot_("runMorningPublishStep2", 5);
}

/** Run the morning POST: read staged URLs and call TikTok. Auto-deletes own trigger. */
function runMorningPublishStep2() {
  try {
    runner_postStaged_("AM");
  } finally {
    deleteOwnTriggers_("runMorningPublishStep2");
  }
}

/** Run the evening STAGE: Drive -> GitHub. Schedules step2 ~5 min later for the TikTok post. */
function runEveningPublish() {
  let folder = runner_findTodaysFolder_("PM");
  if (!folder) {
    createEveningComicFolder();
    folder = runner_findTodaysFolder_("PM");
  }
  if (!folder) throw new Error("Could not find/create evening folder");
  runner_stageFolder_(folder, "PM");
  scheduleOneShot_("runEveningPublishStep2", 5);
}

/** Run the evening POST: read staged URLs and call TikTok. Auto-deletes own trigger. */
function runEveningPublishStep2() {
  try {
    runner_postStaged_("PM");
  } finally {
    deleteOwnTriggers_("runEveningPublishStep2");
  }
}

/** Pre-flight check: confirms every Script Property is set and APIs respond. */
function preflight() {
  console.log('--- GitHub ---');
  testGitHubAuth();
  console.log('--- TikTok ---');
  testTikTokToken();
  console.log('Preflight OK');
}


/** Diagnostic: list whatever Script Properties actually exist on the server. */
function diagListProperties() {
  const p = PropertiesService.getScriptProperties();
  const keys = p.getKeys();
  console.log('Total keys:', keys.length);
  keys.sort().forEach(k => {
    const v = p.getProperty(k) || '';
    const masked = (k.toUpperCase().indexOf('SECRET') !== -1 || k.toUpperCase().indexOf('PAT') !== -1 || k.toUpperCase().indexOf('TOKEN') !== -1)
      ? ('<' + v.length + ' chars hidden>')
      : v.length > 80 ? (v.substring(0, 60) + '... [' + v.length + ' chars]') : v;
    console.log(k + ' = ' + masked);
  });
  return keys;
}


/**
 * Set the 5 non-secret script properties from code (works around UI persistence bug).
 * Run this once. Secrets must still be added via the UI.
 */
function setupNonSecretProperties() {
  const props = PropertiesService.getScriptProperties();
  props.setProperties({
    GITHUB_OWNER: 'dogsica',
    GITHUB_REPO: 'dogsica.github.io',
    GITHUB_BRANCH: 'main',
    GITHUB_PAGES_BASE: 'https://dogsica.github.io',
    TIKTOK_REDIRECT_URI: 'https://dogsica.github.io/oauth/callback.html'
  });
  Logger.log('Wrote 5 non-secret properties.');
  const all = props.getProperties();
  Logger.log('Now stored: ' + Object.keys(all).join(', '));
}


/**
 * Paste your three secret values between the quotes below, save (Ctrl+S),
 * then run this function ONCE. After it succeeds, blank the values back out
 * and save again so they're not stored in source.
 */
function setupSecrets() {
  const GITHUB_PAT          = ''; // <-- paste GitHub Personal Access Token
  const TIKTOK_CLIENT_KEY   = ''; // <-- paste TikTok Client Key
  const TIKTOK_CLIENT_SECRET= ''; // <-- paste TikTok Client Secret

  if (!GITHUB_PAT || !TIKTOK_CLIENT_KEY || !TIKTOK_CLIENT_SECRET) {
    throw new Error('Fill in all three secret values before running.');
  }
  const props = PropertiesService.getScriptProperties();
  props.setProperties({
    GITHUB_PAT: GITHUB_PAT,
    TIKTOK_CLIENT_KEY: TIKTOK_CLIENT_KEY,
    TIKTOK_CLIENT_SECRET: TIKTOK_CLIENT_SECRET
  });
  Logger.log('Stored 3 secrets.');
  Logger.log('All keys now: ' + Object.keys(props.getProperties()).join(', '));
}


/**
 * Manually fetch status of a known publish_id.
 */
function checkPublishStatus() {
  const publishId = PropertiesService.getScriptProperties().getProperty("LAST_PUBLISH_ID");
  if (!publishId) throw new Error("No LAST_PUBLISH_ID stored");
  Logger.log("Checking publish_id: " + publishId);
  const accessToken = tiktokGetAccessToken_();
  const r = UrlFetchApp.fetch("https://open.tiktokapis.com/v2/post/publish/status/fetch/", {
    method: "post",
    contentType: "application/json; charset=UTF-8",
    headers: { Authorization: "Bearer " + accessToken },
    payload: JSON.stringify({ publish_id: publishId }),
    muteHttpExceptions: true
  });
  Logger.log("Status (" + r.getResponseCode() + "): " + r.getContentText());
}


function diagCheckImageHeaders() {
  const url = "https://dogsica.github.io/comics/2026-05-01/AM/AM_01.PNG";
  const r = UrlFetchApp.fetch(url, { method: "get", muteHttpExceptions: true, followRedirects: true });
  Logger.log("HTTP " + r.getResponseCode());
  const headers = r.getAllHeaders();
  Logger.log("Content-Type: " + (headers["Content-Type"] || headers["content-type"]));
  Logger.log("Content-Length: " + (headers["Content-Length"] || headers["content-length"]));
  const blob = r.getBlob();
  const bytes = blob.getBytes();
  Logger.log("Bytes length: " + bytes.length);
  Logger.log("Magic bytes: " + bytes.slice(0,8).map(b => (b<0?b+256:b).toString(16).padStart(2,"0")).join(" "));
}


/**
 * Polls a public URL until it returns HTTP 200 or until timeoutMs elapses.
 * Used after a GitHub Pages upload to make sure the asset is actually live
 * before TikTok tries to pull it.
 */
function waitForUrlLive_(url, timeoutMs, intervalMs) {
  timeoutMs = timeoutMs || 180000;
  intervalMs = intervalMs || 3000;
  const start = Date.now();
  let lastCode = -1;
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = UrlFetchApp.fetch(url, { method: "get", muteHttpExceptions: true, followRedirects: true });
      lastCode = resp.getResponseCode();
      if (lastCode >= 200 && lastCode < 300) {
        Logger.log("Live (" + lastCode + "): " + url + " after " + (Date.now() - start) + "ms");
        return true;
      }
    } catch (e) {
      lastCode = "err:" + e;
    }
    Utilities.sleep(intervalMs);
  }
  throw new Error("URL never went live within " + timeoutMs + "ms (last code " + lastCode + "): " + url);
}


/**
 * Inspect every file in todays Morning Upload folder.
 * Logs name, mime, size in bytes/MB, and tries getAs("image/jpeg") to see which one fails.
 */
function diagInspectTodaysImages() {
  const folder = runner_findTodaysFolder_("AM");
  if (!folder) throw new Error("No AM folder found for today");
  Logger.log("Folder: " + folder.getName() + " (id " + folder.getId() + ")");
  const it = folder.getFiles();
  const files = [];
  while (it.hasNext()) files.push(it.next());
  files.sort(function(a, b) { return a.getName().localeCompare(b.getName()); });
  Logger.log("Total files: " + files.length);
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const blob = f.getBlob();
    const sizeBytes = blob.getBytes().length;
    const sizeMB = (sizeBytes / 1048576).toFixed(2);
    const mime = blob.getContentType();
    let dims = "n/a";
    let aspect = "n/a";
    let aspectFlag = "";
    /* Parse PNG dimensions from IHDR (bytes 16..23, big-endian) */
    if (mime === "image/png") {
      const bytes = blob.getBytes();
      if (bytes.length >= 24) {
        const u = b => (b < 0 ? b + 256 : b);
        const w = (u(bytes[16]) << 24) | (u(bytes[17]) << 16) | (u(bytes[18]) << 8) | u(bytes[19]);
        const h = (u(bytes[20]) << 24) | (u(bytes[21]) << 16) | (u(bytes[22]) << 8) | u(bytes[23]);
        dims = w + "x" + h;
        const ratio = w / h;
        aspect = ratio.toFixed(3) + " (w/h)";
        /* TikTok carousel: roughly 0.5625 <= w/h <= 1.91, long side <= ~4096 */
        const flags = [];
        if (ratio < 0.5625) flags.push("TOO_TALL");
        if (ratio > 1.91) flags.push("TOO_WIDE");
        if (Math.max(w, h) > 4096) flags.push("LONG_SIDE_>4096");
        if (Math.min(w, h) < 360) flags.push("SHORT_SIDE_<360");
        aspectFlag = flags.length ? " *** " + flags.join(",") : " ok";
      }
    }
    let convertResult = "ok";
    let jpegBytes = -1;
    try {
      const j = blob.getAs("image/jpeg");
      jpegBytes = j.getBytes().length;
    } catch (e) {
      convertResult = "FAIL: " + e.message;
    }
    Logger.log((i + 1) + ". " + f.getName()
      + " | mime=" + mime
      + " | size=" + sizeMB + " MB"
      + " | dims=" + dims
      + " | aspect=" + aspect + aspectFlag
      + " | jpegConvert=" + convertResult
      + (jpegBytes > 0 ? " (jpegBytes=" + jpegBytes + ")" : ""));
  }
}

/**
 * One-time setup: install daily Time-driven triggers for the morning and evening posts.
 * Re-running this function deletes any existing triggers for runMorningPublish/runEveningPublish
 * before creating fresh ones, so it's safe to call repeatedly when you want to change the times.
 * Times are interpreted in the project's timezone (Eastern Time).
 */
function setupDailyTriggers() {
  const handlers = ['runMorningPublish', 'runEveningPublish'];
  const all = ScriptApp.getProjectTriggers();
  for (let i = 0; i < all.length; i++) {
    const h = all[i].getHandlerFunction();
    if (handlers.indexOf(h) !== -1) {
      Logger.log('Deleting existing trigger for ' + h);
      ScriptApp.deleteTrigger(all[i]);
    }
  }

  // Daily 9–10 AM ET window for the morning post.
  ScriptApp.newTrigger('runMorningPublish')
    .timeBased()
    .atHour(9)
    .everyDays(1)
    .inTimezone('America/New_York')
    .create();
  Logger.log('Created daily trigger: runMorningPublish at 9–10 AM ET');

  // Daily 6–7 PM ET window for the evening post.
  ScriptApp.newTrigger('runEveningPublish')
    .timeBased()
    .atHour(18)
    .everyDays(1)
    .inTimezone('America/New_York')
    .create();
  Logger.log('Created daily trigger: runEveningPublish at 6–7 PM ET');
}
