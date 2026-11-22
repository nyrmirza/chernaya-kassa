// Генерирует Secret Key для входа через Apple в Supabase.
// Запуск:  node tools/apple-secret.js C:\путь\к\AuthKey_PY5995TU32.p8
// Скопируйте выведенную длинную строку в Supabase → Authentication → Sign In / Providers → Apple → Secret Key.
// Секрет действует ~6 месяцев (максимум у Apple). Потом просто запустите скрипт ещё раз.
// Ключ .p8 никуда не отправляется — всё считается на этом компьютере.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TEAM_ID = '9PQF683C2B';
const KEY_ID = 'PY5995TU32';
const SERVICES_ID = 'kz.nurbakyt.chernayakassa.signin';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error('Укажите путь к файлу .p8, например:\n  node tools/apple-secret.js C:\\Users\\Вы\\Downloads\\AuthKey_' + KEY_ID + '.p8');
  process.exit(1);
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const now = Math.floor(Date.now() / 1000);
const exp = now + 15777000; // ~182 дня

const header = b64url(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }));
const payload = b64url(JSON.stringify({ iss: TEAM_ID, iat: now, exp, aud: 'https://appleid.apple.com', sub: SERVICES_ID }));
const data = `${header}.${payload}`;
const signature = crypto.sign('sha256', Buffer.from(data), {
  key: fs.readFileSync(path.resolve(file), 'utf8'),
  dsaEncoding: 'ieee-p1363',
});

console.log('\nSecret Key для Supabase (скопируйте строку целиком):\n');
console.log(`${data}.${b64url(signature)}`);
console.log(`\nДействует до: ${new Date(exp * 1000).toLocaleDateString('ru-RU')}. После этой даты запустите скрипт снова.\n`);
