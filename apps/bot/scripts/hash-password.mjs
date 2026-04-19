#!/usr/bin/env node
import argon2 from 'argon2';
import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

const main = async () => {
  const pw = await ask('Dashboard password: ');
  rl.close();
  const hash = await argon2.hash(pw, { type: argon2.argon2id });
  console.log('\nDASHBOARD_PASSWORD_HASH=' + hash);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
