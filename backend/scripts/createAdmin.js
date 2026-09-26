// Creates an admin account, or promotes an existing account to admin.
//
//   npm run create-admin -- admin@example.com
//
// The password is typed at a hidden prompt (twice), so it never appears in
// the terminal, shell history or any file. Run from the backend folder so
// backend/.env (MONGO_URI) is picked up.
import '../loadEnv.js';
import readline from 'node:readline';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { connectDB } from '../db.js';
import User from '../models/User.js';

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    const write = rl._writeToOutput.bind(rl);
    // Echo the question, then hide everything typed after it.
    rl._writeToOutput = (text) => { if (!muted) write(text); };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('Usage: npm run create-admin -- admin@example.com');
    process.exit(1);
  }

  await connectDB();
  if (mongoose.connection.readyState !== 1) {
    console.error('Could not connect to MongoDB - check MONGO_URI in backend/.env.');
    process.exit(1);
  }

  const existing = await User.findOne({ email });
  const prompt = existing ? `Set a new password for ${email} (leave empty to keep the current one): ` : `Password for ${email}: `;
  const password = await askHidden(prompt);
  if (password || !existing?.passwordHash) {
    if (password.length < 8) {
      console.error('Password must be at least 8 characters.');
      process.exit(1);
    }
    const again = await askHidden('Type it again: ');
    if (again !== password) {
      console.error('The passwords did not match.');
      process.exit(1);
    }
  }

  if (existing) {
    existing.role = 'admin';
    existing.status = 'active';
    if (password) {
      existing.passwordHash = await bcrypt.hash(password, 10);
      if (!existing.authProviders.includes('local')) existing.authProviders.push('local');
    }
    await existing.save();
    console.log(`${email} is now an admin.`);
  } else {
    await User.create({
      email,
      passwordHash: await bcrypt.hash(password, 10),
      name: 'Admin',
      authProviders: ['local'],
      role: 'admin',
    });
    console.log(`Admin account ${email} created.`);
  }
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
