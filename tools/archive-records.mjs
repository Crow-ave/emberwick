// Keep your own copy of Emberwick's daily village records, independent of the game server.
// Usage: node tools/archive-records.mjs [HOST] [FOLDER]
//   HOST   default http://localhost:3000 (for example https://emberwick-xcf8.onrender.com)
//   FOLDER default ./village-records
// Each record is saved as day-N.json with its exact bytes, and its SHA-256 is checked before saving.
// Compare the hash with the memo of that day's 0.01 EMWK record on NEAR (treasury -> newcomer fund):
// if they match, the copy is exactly what the server committed to on chain that day. Run it now and then
// (the server keeps about 60 village days); files you already have are left alone.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const host = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const dir = process.argv[3] || 'village-records';
fs.mkdirSync(dir, { recursive: true });
const r = await fetch(host + '/api/state-records');
if (!r.ok) { console.log('Could not read', host + '/api/state-records', r.status); process.exit(1); }
const { days = [] } = await r.json();
let added = 0, kept = 0, bad = 0;
const index = [];
for (const d of days) {
  const hash = crypto.createHash('sha256').update(d.json, 'utf8').digest('hex');
  if (hash !== d.sha256) { bad++; console.log(`day ${d.day}: hash does not match (${hash.slice(0, 12)} vs ${String(d.sha256).slice(0, 12)}), not saved`); continue; }
  const f = path.join(dir, `day-${d.day}.json`);
  if (fs.existsSync(f)) {
    const old = crypto.createHash('sha256').update(fs.readFileSync(f, 'utf8'), 'utf8').digest('hex');
    if (old !== hash) console.log(`day ${d.day}: the server now sends a DIFFERENT record than your saved copy (${old.slice(0, 12)} -> ${hash.slice(0, 12)}). Your copy is kept; compare both with the memo on NEAR.`);
    kept++;
  } else { fs.writeFileSync(f, d.json); added++; }
  index.push({ day: d.day, sha256: hash });
}
const idxFile = path.join(dir, 'index.json');
let all = [];
try { all = JSON.parse(fs.readFileSync(idxFile, 'utf8')); } catch {}
for (const x of index) if (!all.some((y) => y.day === x.day)) all.push(x);
all.sort((a, b) => a.day - b.day);
fs.writeFileSync(idxFile, JSON.stringify(all, null, 1));
console.log(`${added} new record(s) saved, ${kept} already kept, ${bad} rejected. ${all.length} day(s) in ${dir}/ (index.json lists each day's SHA-256 to compare with its memo on NEAR).`);
