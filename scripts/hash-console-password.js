import { readFileSync } from 'node:fs';
import { hashConsolePassword } from '../src/auth/console-session.js';

const password = readFileSync(0, 'utf8').replace(/[\r\n]+$/, '');
if (!password) throw new Error('Provide the console password through standard input');
console.log(hashConsolePassword(password));
