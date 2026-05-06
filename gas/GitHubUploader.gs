// 📤 GitHubUploader.gs
// Uploads files to the dogsica/dogsica.github.io repo via the GitHub Contents API
// so they are publicly served at https://dogsica.github.io/<path>.
// Required Script Properties:
//   GITHUB_PAT      — fine-grained personal access token (Contents: Read & write on dogsica/dogsica.github.io)
//   GITHUB_OWNER    — "dogsica"
//   GITHUB_REPO     — "dogsica.github.io"
//   GITHUB_BRANCH   — "main"
//   GITHUB_PAGES_BASE — "https://dogsica.github.io" (no trailing slash)

function gh_props_() {
  const p = PropertiesService.getScriptProperties();
  const need = ['GITHUB_PAT', 'GITHUB_OWNER', 'GITHUB_REPO', 'GITHUB_BRANCH', 'GITHUB_PAGES_BASE'];
  const out = {};
  need.forEach(k => {
    const v = p.getProperty(k);
    if (!v) throw new Error('Missing Script Property: ' + k);
    out[k] = v;
  });
  return out;
}

/**
 * Upload (or overwrite) a Drive file to GitHub at the given repo path.
 * Returns the public Pages URL.
 *
 * @param {DriveApp.File} driveFile
 * @param {string} repoPath e.g. "comics/2026-04-30/AM_02.png"
 * @param {string} [commitMessage]
 * @return {string} public URL on dogsica.github.io
 */
function uploadDriveFileToGitHub_(driveFile, repoPath, commitMessage) {
  const cfg = gh_props_();
  const blob = driveFile.getBlob();
  const b64 = Utilities.base64Encode(blob.getBytes());

  const apiUrl = 'https://api.github.com/repos/' + cfg.GITHUB_OWNER + '/' + cfg.GITHUB_REPO +
                 '/contents/' + repoPath.split('/').map(encodeURIComponent).join('/');

  // Get current sha if file already exists (so we can overwrite)
  let existingSha = null;
  const headResp = UrlFetchApp.fetch(apiUrl + '?ref=' + encodeURIComponent(cfg.GITHUB_BRANCH), {
    method: 'get',
    muteHttpExceptions: true,
    headers: {
      'Authorization': 'Bearer ' + cfg.GITHUB_PAT,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
  if (headResp.getResponseCode() === 200) {
    existingSha = JSON.parse(headResp.getContentText()).sha;
  } else if (headResp.getResponseCode() !== 404) {
    throw new Error('GitHub HEAD failed (' + headResp.getResponseCode() + '): ' + headResp.getContentText());
  }

  const payload = {
    message: commitMessage || ('Upload ' + repoPath),
    content: b64,
    branch: cfg.GITHUB_BRANCH
  };
  if (existingSha) payload.sha = existingSha;

  const putResp = UrlFetchApp.fetch(apiUrl, {
    method: 'put',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {
      'Authorization': 'Bearer ' + cfg.GITHUB_PAT,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    payload: JSON.stringify(payload)
  });
  const code = putResp.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('GitHub PUT failed (' + code + '): ' + putResp.getContentText());
  }

  return cfg.GITHUB_PAGES_BASE + '/' + repoPath.split('/').map(encodeURIComponent).join('/');
}

/**
 * Delete a file from the repo (best-effort cleanup).
 */
function deleteFileFromGitHub_(repoPath, commitMessage) {
  const cfg = gh_props_();
  const apiUrl = 'https://api.github.com/repos/' + cfg.GITHUB_OWNER + '/' + cfg.GITHUB_REPO +
                 '/contents/' + repoPath.split('/').map(encodeURIComponent).join('/');
  const headResp = UrlFetchApp.fetch(apiUrl + '?ref=' + encodeURIComponent(cfg.GITHUB_BRANCH), {
    method: 'get',
    muteHttpExceptions: true,
    headers: {
      'Authorization': 'Bearer ' + cfg.GITHUB_PAT,
      'Accept': 'application/vnd.github+json'
    }
  });
  if (headResp.getResponseCode() !== 200) return false;
  const sha = JSON.parse(headResp.getContentText()).sha;
  const delResp = UrlFetchApp.fetch(apiUrl, {
    method: 'delete',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {
      'Authorization': 'Bearer ' + cfg.GITHUB_PAT,
      'Accept': 'application/vnd.github+json'
    },
    payload: JSON.stringify({
      message: commitMessage || ('Delete ' + repoPath),
      sha: sha,
      branch: cfg.GITHUB_BRANCH
    })
  });
  return delResp.getResponseCode() >= 200 && delResp.getResponseCode() < 300;
}

/** Quick connectivity test — call from the Run dropdown. */
function testGitHubAuth() {
  const cfg = gh_props_();
  const r = UrlFetchApp.fetch('https://api.github.com/repos/' + cfg.GITHUB_OWNER + '/' + cfg.GITHUB_REPO, {
    method: 'get',
    muteHttpExceptions: true,
    headers: {
      'Authorization': 'Bearer ' + cfg.GITHUB_PAT,
      'Accept': 'application/vnd.github+json'
    }
  });
  console.log('Status:', r.getResponseCode());
  const j = JSON.parse(r.getContentText());
  console.log('Repo full_name:', j.full_name, 'private:', j.private);
}


/**
 * Upload an arbitrary blob (already-encoded bytes) to GitHub at repoPath.
 * Mirrors uploadDriveFileToGitHub_ but skips the Drive read.
 */
function uploadBlobToGitHub_(blob, repoPath, commitMessage) {
  const cfg = gh_props_();
  const url = "https://api.github.com/repos/" + cfg.GITHUB_OWNER + "/" + cfg.GITHUB_REPO + "/contents/" + encodeURI(repoPath);
  const headers = {
    "Authorization": "Bearer " + cfg.GITHUB_PAT,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  let sha = null;
  try {
    const get = UrlFetchApp.fetch(url + "?ref=" + encodeURIComponent(cfg.GITHUB_BRANCH), { method: "get", headers: headers, muteHttpExceptions: true });
    if (get.getResponseCode() === 200) { const j = JSON.parse(get.getContentText()); sha = j.sha || null; }
  } catch (e) {}
  const b64 = Utilities.base64Encode(blob.getBytes());
  const body = { message: commitMessage || ("Upload " + repoPath), content: b64, branch: cfg.GITHUB_BRANCH };
  if (sha) body.sha = sha;
  const r = UrlFetchApp.fetch(url, {
    method: "put",
    contentType: "application/json; charset=UTF-8",
    headers: headers,
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  if (r.getResponseCode() < 200 || r.getResponseCode() >= 300) {
    throw new Error("GitHub upload failed (" + r.getResponseCode() + "): " + r.getContentText());
  }
}
