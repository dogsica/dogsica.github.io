// 🎬 TikTokPublisher.gs
// Calls TikTok's Content Posting API to publish a photo carousel directly.
// Uses pull_by_url, which requires the source domain to be a verified URL prefix
// (we have https://dogsica.github.io/ verified for the Dogsica Comic Bot app).
//
// API reference (sandbox): https://developers.tiktok.com/doc/content-posting-api-reference-direct-post-photo
//
// Required Script Properties (in addition to the TikTok auth ones):
//   (none extra — uses the access token from TikTokAuth.gs)

const TIKTOK_PHOTO_INIT_URL   = 'https://open.tiktokapis.com/v2/post/publish/content/init/';
const TIKTOK_STATUS_FETCH_URL = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/';

/**
 * Publish a photo carousel as a Direct Post on the authorized creator's profile.
 *
 * @param {string[]} photoUrls Public HTTPS URLs of each photo (max 35; first is cover by default).
 * @param {object}   opts
 * @param {string}   opts.title         Caption / title (TikTok-photo title is the visible caption).
 * @param {string}   [opts.description] Optional description.
 * @param {number}   [opts.coverIndex]  Index of the cover image (default 0).
 * @param {boolean}  [opts.disableComment]
 * @param {boolean}  [opts.autoAddMusic]
 * @param {string}   [opts.privacyLevel] One of TikTok's PRIVACY_LEVEL_* values; sandbox typically requires SELF_ONLY.
 * @return {string}  publish_id from TikTok (poll status with tiktokPollStatus_)
 */
function tiktokPostPhotoCarousel_(photoUrls, opts) {
  opts = opts || {};
  const accessToken = tiktokGetAccessToken_();
  let title = (opts.title && String(opts.title).trim()) || "Daily Comic";
  title = title.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (title.length > 90) title = title.substring(0, 87) + "...";
  const description = opts.description || "";
  const privacyLevel = opts.privacy_level || "SELF_ONLY";
  const coverIdx = (typeof opts.photo_cover_index === "number") ? opts.photo_cover_index : 0;
  const body = {
    media_type: "PHOTO",
    post_mode: "DIRECT_POST",
    post_info: {
      title: title,
      description: description,
      privacy_level: privacyLevel,
      disable_comment: !!opts.disable_comment,
      auto_add_music: opts.auto_add_music !== false
    },
    source_info: {
      source: "PULL_FROM_URL",
      photo_cover_index: coverIdx,
      photo_images: photoUrls
    }
  };
  Logger.log("TikTok init request body: " + JSON.stringify(body));
  const r = UrlFetchApp.fetch("https://open.tiktokapis.com/v2/post/publish/content/init/", {
    method: "post",
    contentType: "application/json; charset=UTF-8",
    headers: { Authorization: "Bearer " + accessToken },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  const code = r.getResponseCode();
  const txt = r.getContentText();
  Logger.log("TikTok init response (" + code + "): " + txt);
  if (code < 200 || code >= 300) throw new Error("TikTok init failed (" + code + "): " + txt);
  const j = JSON.parse(txt);
  if (j.error && j.error.code && j.error.code !== "ok") {
    throw new Error("TikTok init error: " + JSON.stringify(j.error));
  }
  const publishId = j.data && j.data.publish_id;
  if (!publishId) throw new Error("No publish_id in response: " + txt);
  return publishId;
}


/** Poll publish status. Call once or in a loop. */
function tiktokPollStatus_(publishId) {
  const accessToken = tiktokGetAccessToken_();
  const r = UrlFetchApp.fetch(TIKTOK_STATUS_FETCH_URL, {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    muteHttpExceptions: true,
    headers: { 'Authorization': 'Bearer ' + accessToken },
    payload: JSON.stringify({ publish_id: publishId })
  });
  const code = r.getResponseCode();
  const body = r.getContentText();
  if (code < 200 || code >= 300) throw new Error('Status fetch failed (' + code + '): ' + body);
  return JSON.parse(body);
}
