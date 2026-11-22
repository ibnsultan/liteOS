// Copies third-party libraries into public/assets/vendor. Run after changing their versions: npm run vendor
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';

const version = (pkg) => JSON.parse(readFileSync('node_modules/' + pkg + '/package.json', 'utf8')).version;

const pdfjs = version('pdfjs-dist');
const pdfOut = 'public/assets/vendor/pdfjs-' + pdfjs;
rmSync(pdfOut, { recursive: true, force: true });
mkdirSync(pdfOut, { recursive: true });

// .mjs renamed to .js so every web server sends them as JavaScript
for (const [from, to] of [['build/pdf.min.mjs', 'pdf.min.js'], ['build/pdf.worker.min.mjs', 'pdf.worker.min.js'], ['web/pdf_viewer.mjs', 'pdf_viewer.js'], ['web/pdf_viewer.css', 'pdf_viewer.css'], ['LICENSE', 'LICENSE']]) {
    cpSync('node_modules/pdfjs-dist/' + from, pdfOut + '/' + to);
}
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs', 'web/images']) {
    cpSync('node_modules/pdfjs-dist/' + dir, pdfOut + '/' + dir.replace('web/', ''), { recursive: true });
}
console.log('copied pdf.js ' + pdfjs);

const pdflib = version('pdf-lib');
cpSync('node_modules/pdf-lib/dist/pdf-lib.min.js', 'public/assets/vendor/pdf-lib-' + pdflib + '.min.js');
console.log('copied pdf-lib ' + pdflib);

cpSync('node_modules/hls.js/dist/hls.min.js', 'public/assets/vendor/hls.min.js');
console.log('copied hls.js ' + version('hls.js'));
