import fs from 'fs';
import path from 'path';
import https from 'https';

const ASSETS_DIR = path.join(__dirname, '../public/assets/sprites/leap');
if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

const TS_FILE = path.join(__dirname, '../src/components/generated_leap_sprites.ts');

const downloadFile = (url: string, dest: string): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        if (fs.existsSync(dest)) return resolve(true);
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve(true);
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => { });
            reject(err);
        });
    });
};

export interface CostumeData {
    name: string;
    md5ext?: string;
    dataFormat?: string;
}

export interface SpriteData {
    name: string;
    isStage?: boolean;
    costumes?: CostumeData[];
    tags?: string[];
}

export interface LeapSpriteEntry {
    id: string;
    name: string;
    emoji: string;
    image: string;
    costumes: string[];
    tags: string[];
    category: string;
}

async function main(): Promise<void> {
    const tmpSpritesPath = 'd:/tmp_sprites.json';
    if (!fs.existsSync(tmpSpritesPath)) {
        console.warn(`File ${tmpSpritesPath} not found. Skipping sprite fetch.`);
        return;
    }

    const data: SpriteData[] = JSON.parse(fs.readFileSync(tmpSpritesPath, 'utf-8'));
    const entries: LeapSpriteEntry[] = [];

    console.log(`Found ${data.length} sprites. Downloading with concurrency 20...`);

    const tasks: Array<() => Promise<void>> = [];

    for (let i = 0; i < data.length; i++) {
        const s = data[i];
        if (s.isStage) continue;
        if (!s.costumes || s.costumes.length === 0) continue;

        const localCostumes: string[] = [];

        for (const c of s.costumes) {
            if (!c.md5ext) continue;

            const url = `https://cdn.assets.leap.mit.edu/internalapi/asset/${c.md5ext}/get/`;
            const safeSpriteName = s.name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
            const safeCostumeName = c.name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
            const ext = path.extname(c.md5ext) || '.' + (c.dataFormat || 'svg');
            const filename = `${safeSpriteName}_${safeCostumeName}${ext}`;
            const dest = path.join(ASSETS_DIR, filename);

            tasks.push(async () => {
                try {
                    await downloadFile(url, dest);
                } catch (e) {
                    console.error(`Failed to download ${url}`);
                }
            });
            localCostumes.push(`assets/sprites/leap/${filename}`);
        }

        if (localCostumes.length > 0) {
            entries.push({
                id: `leap_${s.name.replace(/\s+/g, '_').toLowerCase()}`,
                name: s.name,
                emoji: '🤖',
                image: localCostumes[0],
                costumes: localCostumes,
                tags: s.tags || [],
                category: 'leap'
            });
        }
    }

    fs.writeFileSync(TS_FILE, `export const leapSprites: any[] = ${JSON.stringify(entries, null, 2)};`);

    const CONCURRENCY = 20;
    let active = 0;
    let index = 0;
    let completed = 0;

    await new Promise<void>((resolve) => {
        function next() {
            if (completed === tasks.length) return resolve();
            while (active < CONCURRENCY && index < tasks.length) {
                const task = tasks[index++];
                active++;
                task().then(() => {
                    active--;
                    completed++;
                    if (completed % 100 === 0) console.log(`Downloaded ${completed}/${tasks.length} SVGs...`);
                    next();
                });
            }
        }
        next();
    });

    console.log('All downloads complete!');
}

main().catch(console.error);
