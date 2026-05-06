// 🔥 CONFIG
const ARCHIVE_FOLDER_ID = "1TQtvtl_4rFR_vW60RpS5Jao4JKnmWibC";
const OUTPUT_FOLDER_ID = "1qHNlrLElLAcJTaA9GKmtJPcAKXJHWo-2";
const FRONT_BACK_FOLDER_ID = "19Wh39BTAXiZnaxc5psaq5xOlpDuD1V54";


// 🔥 GET COMICS FROM KNOWN STRUCTURE
function getRandomComics(count) {
  const archiveFolder = DriveApp.getFolderById(ARCHIVE_FOLDER_ID);
  archiveFolder.getName();

  let fileArray = [];
  const seriesFolderIter = archiveFolder.getFolders();

  while (seriesFolderIter.hasNext()) {
    const seriesFolder = seriesFolderIter.next();
    const finishedFolders = seriesFolder.getFoldersByName("Finished Comics");
    if (!finishedFolders.hasNext()) continue;
    const finishedFolder = finishedFolders.next();
    const files = finishedFolder.getFiles();
    while (files.hasNext()) {
      fileArray.push(files.next());
    }
  }

  if (fileArray.length === 0) {
    throw new Error("No comics found in any Finished Comics folders.");
  }

  const props = PropertiesService.getScriptProperties();
  let history = JSON.parse(props.getProperty("usedComics") || "{}");

  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  const nowTime = new Date().getTime();

  for (let fileId in history) {
    if (nowTime - history[fileId] > THIRTY_DAYS) {
      delete history[fileId];
    }
  }

  fileArray.sort((a, b) => {
    const aTime = history[a.getId()] || 0;
    const bTime = history[b.getId()] || 0;
    return aTime - bTime;
  });

  const unused = fileArray.filter(f => !history[f.getId()]);
  const used = fileArray.filter(f => history[f.getId()]);

  unused.sort(() => Math.random() - 0.5);

  const pool = [...unused, ...used];
  const selected = pool.slice(0, count);

  const nowTimeStamp = new Date().getTime();
  selected.forEach(file => {
    history[file.getId()] = nowTimeStamp;
  });

  props.setProperty("usedComics", JSON.stringify(history));

  return selected;
}


// 🔧 HELPERS
function getNextFrontFile(frontFolder) {
  if (!frontFolder) return null;

  // Collect all files from FRONT folder, sorted by name
  let frontFiles = [];
  const files = frontFolder.getFiles();
  while (files.hasNext()) {
    frontFiles.push(files.next());
  }

  if (frontFiles.length === 0) return null;

  // Sort alphabetically by name so 01, 02, 03... cycle in order
  frontFiles.sort((a, b) => a.getName().localeCompare(b.getName()));

  // Get the last used front index from script properties
  const props = PropertiesService.getScriptProperties();
  let lastIndex = parseInt(props.getProperty("lastFrontIndex") || "-1");

  // Advance to the next image, looping back to 0 at the end
  const nextIndex = (lastIndex + 1) % frontFiles.length;
  props.setProperty("lastFrontIndex", nextIndex.toString());

  console.log(`Front image: using index ${nextIndex} → ${frontFiles[nextIndex].getName()}`);
  return frontFiles[nextIndex];
}

function getFirstFile(folder) {
  if (!folder) return null;
  const files = folder.getFiles();
  return files.hasNext() ? files.next() : null;
}

function getSubfolder(parent, name) {
  const folders = parent.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : null;
}

function getExtension(file) {
  return file.getName().split('.').pop();
}


// ☀️ MORNING
function createDailyComicFolder() {
  const now = new Date();
  if (now.getHours() < 6) return;

  const output = DriveApp.getFolderById(OUTPUT_FOLDER_ID);
  const fb = DriveApp.getFolderById(FRONT_BACK_FOLDER_ID);

  const dateStr = Utilities.formatDate(now, Session.getScriptTimeZone(), "MMM dd, yyyy");
  const name = `Morning Upload - ${dateStr}`;

  let folder;
  const existing = output.getFoldersByName(name);

  if (existing.hasNext()) {
    folder = existing.next();
    if (folder.getFiles().hasNext()) {
      console.log(`Skipping morning — folder "${name}" already has files.`);
      return;
    }
  } else {
    folder = output.createFolder(name);
  }

  const comics = getRandomComics(5);
  console.log(`Morning: selected ${comics.length} comics for "${name}"`);
  comics.forEach(f => console.log(`  - ${f.getName()}`));

  // ✅ Cycles through FRONT images
  const front = getNextFrontFile(getSubfolder(fb, "FRONT"));
  const back = getFirstFile(getSubfolder(fb, "BACK"));

  let i = 1;

  if (front) {
    front.makeCopy(`AM_${String(i++).padStart(2, "0")}.${getExtension(front)}`, folder);
  }

  comics.forEach(file => {
    file.makeCopy(`AM_${String(i++).padStart(2, "0")}.${getExtension(file)}`, folder);
  });

  if (back) {
    back.makeCopy(`AM_${String(i).padStart(2, "0")}.${getExtension(back)}`, folder);
  }

  const caption = comics.map((file, index) => {
    const parts = file.getName().replace(/\.[^/.]+$/, "").split("_");
    const number = parts[0] || "";
    const title  = parts[1] || "";
    return `${index + 1}. ${title} ${number}`;
  }).join("\n") + "\n#comics #stickers #fun";
  folder.createFile("caption.txt", caption);

  console.log(`Morning folder "${name}" created successfully.`);
}


// 🌙 EVENING
function createEveningComicFolder() {
  const now = new Date();
  if (now.getHours() < 16) return;

  const output = DriveApp.getFolderById(OUTPUT_FOLDER_ID);
  const fb = DriveApp.getFolderById(FRONT_BACK_FOLDER_ID);

  const dateStr = Utilities.formatDate(now, Session.getScriptTimeZone(), "MMM dd, yyyy");
  const name = `Evening Upload - ${dateStr}`;

  let folder;
  const existing = output.getFoldersByName(name);

  if (existing.hasNext()) {
    folder = existing.next();
    if (folder.getFiles().hasNext()) {
      console.log(`Skipping evening — folder "${name}" already has files.`);
      return;
    }
  } else {
    folder = output.createFolder(name);
  }

  const comics = getRandomComics(5);
  console.log(`Evening: selected ${comics.length} comics for "${name}"`);
  comics.forEach(f => console.log(`  - ${f.getName()}`));

  // ✅ Cycles through FRONT images
  const front = getNextFrontFile(getSubfolder(fb, "FRONT"));
  const back = getFirstFile(getSubfolder(fb, "BACK"));

  let i = 1;

  if (front) {
    front.makeCopy(`PM_${String(i++).padStart(2, "0")}.${getExtension(front)}`, folder);
  }

  comics.forEach(file => {
    file.makeCopy(`PM_${String(i++).padStart(2, "0")}.${getExtension(file)}`, folder);
  });

  if (back) {
    back.makeCopy(`PM_${String(i).padStart(2, "0")}.${getExtension(back)}`, folder);
  }

  const caption = comics.map((file, index) => {
    const parts = file.getName().replace(/\.[^/.]+$/, "").split("_");
    const number = parts[0] || "";
    const title  = parts[1] || "";
    return `${index + 1}. ${title} ${number}`;
  }).join("\n") + "\n#comics #stickers #fun";
  folder.createFile("caption.txt", caption);

  console.log(`Evening folder "${name}" created successfully.`);
}


// 🧹 DELETE
function deleteTodayMorningFolder() {
  const now = new Date();
  if (now.getHours() < 23) return;

  const output = DriveApp.getFolderById(OUTPUT_FOLDER_ID);
  const dateStr = Utilities.formatDate(now, Session.getScriptTimeZone(), "MMM dd, yyyy");
  const name = `Morning Upload - ${dateStr}`;

  const folders = output.getFoldersByName(name);
  if (folders.hasNext()) {
    folders.next().setTrashed(true);
    console.log(`Trashed morning folder: ${name}`);
  } else {
    console.log(`No morning folder found to trash: ${name}`);
  }
}

function deleteEveningFolder() {
  const now = new Date();
  if (now.getHours() < 23) return;

  const output = DriveApp.getFolderById(OUTPUT_FOLDER_ID);
  const dateStr = Utilities.formatDate(now, Session.getScriptTimeZone(), "MMM dd, yyyy");
  const name = `Evening Upload - ${dateStr}`;

  const folders = output.getFoldersByName(name);
  if (folders.hasNext()) {
    folders.next().setTrashed(true);
    console.log(`Trashed evening folder: ${name}`);
  } else {
    console.log(`No evening folder found to trash: ${name}`);
  }
}
