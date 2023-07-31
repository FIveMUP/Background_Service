const fs = require('fs');
const path = require('path');
const util = require('util');
const axios = require('axios');

const readdir = util.promisify(fs.readdir);
const stat = util.promisify(fs.stat);

const skip_folders = [
    'node_modules',
]

const searchFileInDirectoryDeep = async (dir, pattern, result = []) => {
    const files = await readdir(dir);
    for (let f of files) {
        const filepath = path.join(dir, f);
        const stats = await stat(filepath);
        if (stats.isDirectory() && !skip_folders.includes(f)) {
            await searchFileInDirectoryDeep(filepath, pattern, result);
        }
        if (stats.isFile() && f === pattern) {
            console.log(`File ${pattern} found at path: ${filepath}`);
            result.push(filepath);
        }
    }
    return result;
};

const InitService = async () => {
    const rootPath = path.resolve(__dirname, '../../');
    console.log(`Searching in: ${rootPath}`);
    const results = await searchFileInDirectoryDeep(rootPath, 'server.cfg');
    results.forEach(async (result) => {
        console.log(`Found server.cfg at path: ${result}`);
    })
};

InitService();
