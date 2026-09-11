import fs from 'fs';
import path from 'path';
import https from 'https';
import fetch from 'node-fetch'; // need to install node-fetch or use native Node.js fetch if version >= 18

// Use Native Fetch if available (Node 18+)
const __dirname = path.resolve();
const SOUNDS_JSON_PATH = path.join(__dirname, 'src/lib/libraries/sounds.json');
const SOUNDS_DIR = path.join(__dirname, 'public/assets/sounds');

// Ensure directory exists
if (!fs.existsSync(SOUNDS_DIR)) {
    fs.mkdirSync(SOUNDS_DIR, { recursive: true });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function downloadFile(url, dest) {
    if (fs.existsSync(dest)) {
        // console.log(`Skipping ${path.basename(dest)}, already exists.`);
        return true;
    }

    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            if (response.statusCode === 200) {
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve(true);
                });
            } else {
                file.close();
                fs.unlink(dest, () => { }); // Delete the file async.
                reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
            }
        }).on('error', (err) => {
            fs.unlink(dest, () => { }); // Delete the file async.
            reject(err);
        });
    });
}

async function main() {
    console.log('Loading sounds.json...');
    const data = fs.readFileSync(SOUNDS_JSON_PATH, 'utf-8');
    const sounds = JSON.parse(data);

    console.log(`Found ${sounds.length} sounds to download.`);

    let downloaded = 0;
    let failed = 0;

    // Use a small concurrent pool or sequential downloading to avoid overwhelming the server
    for (let i = 0; i < sounds.length; i++) {
        const sound = sounds[i];
        const md5 = sound.md5ext || sound.md5; // leap-gui sometimes uses md5ext
        if (!md5) {
            console.error(`Sound index ${i} has no md5 string. Skipping.`);
            continue;
        }

        const url = `https://assets.leap.mit.edu/internalapi/asset/${md5}/get/`;
        // Use lowercase md5 for consistent local storage
        const dest = path.join(SOUNDS_DIR, `${md5}`);

        try {
            await downloadFile(url, dest);
            downloaded++;
            if (downloaded % 50 === 0) {
                console.log(`Progress: ${downloaded}/${sounds.length}`);
            }
        } catch (e) {
            console.error(`Failed to download ${sound.name} (${md5}):`, e.message);
            failed++;
        }

        // Small throttle to be courteous
        await sleep(50);
    }

    console.log(`\nFinished! Downloaded: ${downloaded}, Failed: ${failed}`);
}

main().catch(console.error);
