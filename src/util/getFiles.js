const { promisify } = require('util');
const { resolve } = require('path');
const fs = require('fs');
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

module.exports.getFiles = async function getFiles(dir, fileFilter) {
    const subdirs = await readdir(dir);
    const files = await Promise.all(subdirs.map(async (subdir) => {
        const res = resolve(dir, subdir);
        return (await stat(res)).isDirectory() ? getFiles(res, fileFilter) : res;
    }));
    return files
        .reduce((a, f) => a.concat(f), [])
        .filter(fileFilter);
};