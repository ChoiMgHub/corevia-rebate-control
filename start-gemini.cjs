const readline = require('node:readline');
const { spawn } = require('node:child_process');
const path = require('node:path');

function readKey() {
  if (!process.stdin.isTTY) throw new Error('Run this command in an interactive CMD or PowerShell window.');
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write('Gemini API key (hidden input): ');
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = (error) => {
      process.stdin.removeListener('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      error ? reject(error) : resolve(value.trim());
    };
    const onKey = (text, key = {}) => {
      if (key.ctrl && key.name === 'c') return finish(new Error('Cancelled.'));
      if (key.name === 'return' || key.name === 'enter') return finish();
      if (key.name === 'backspace') { value = value.slice(0, -1); return; }
      if (key.ctrl || key.meta || key.name === 'escape') return;
      if (text && !/[\x00-\x1f\x7f]/.test(text)) value += text;
    };
    process.stdin.on('keypress', onKey);
  });
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY || await readKey();
  if (!apiKey.trim()) throw new Error('API key is empty. Run again and paste the key, then press Enter.');
  console.log('Model: Gemini 3.5 Flash-Lite');
  console.log('The key stays in process memory and is not saved to a file.');
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    stdio: 'inherit',
    env: { ...process.env, AI_PROVIDER: 'gemini', GEMINI_MODEL: 'gemini-3.5-flash-lite', GEMINI_API_KEY: apiKey }
  });
  child.on('error', () => { console.error('Unable to start the server.'); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 0; });
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { readKey };
