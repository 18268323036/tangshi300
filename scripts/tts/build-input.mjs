import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const htmlPath = path.join(projectRoot, 'index.html');
const outputPath = path.join(projectRoot, 'scripts', 'tts', 'poems-for-audio.json');

export function linesToStrings(lines) {
  return lines.map((line) => line.map((char) => char.c).join(''));
}

export function buildTtsText(poem) {
  const bodyLines = linesToStrings(poem.lines);
  const bodyText = bodyLines
    .map((line, index) => `${line}${index % 2 === 0 ? '，' : '。'}`)
    .join('');
  return `《${poem.title}》。${poem.author}。${bodyText}`;
}

export function buildPoemAudioInput(poem, id) {
  return {
    id,
    title: poem.title,
    author: poem.author,
    bodyLines: linesToStrings(poem.lines),
    ttsText: buildTtsText(poem),
  };
}

export function extractPoemsFromHtml(html) {
  const match = html.match(/const poems = (\[[\s\S]*?\n\]);/);
  if (!match) {
    throw new Error('poems data block not found in index.html');
  }
  return vm.runInNewContext(`(${match[1]})`);
}

export async function buildInputFile() {
  const html = await fs.readFile(htmlPath, 'utf8');
  const poems = extractPoemsFromHtml(html);
  const items = poems.map((poem, index) => buildPoemAudioInput(poem, index));
  const payload = {
    generatedAt: new Date().toISOString(),
    items,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  return {
    count: items.length,
    outputPath,
  };
}

if (process.argv[1] === __filename) {
  const { count, outputPath } = await buildInputFile();
  console.log(`wrote ${count} items to ${path.relative(projectRoot, outputPath)}`);
}
