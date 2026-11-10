// Assemble public/index.html à partir de app.html (le même fichier sert d'aperçu).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const body = fs.readFileSync(path.join(DIR, 'app.html'), 'utf8');
const head = '<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style>\n';
const i = body.indexOf('<header');
fs.writeFileSync(path.join(DIR, '..', 'public', 'index.html'), head + body.slice(0, i) + '</head>\n<body>\n' + body.slice(i) + '\n</body>\n</html>\n');
console.log('✓ public/index.html');
