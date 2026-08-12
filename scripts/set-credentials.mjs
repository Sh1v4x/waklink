#!/usr/bin/env node
/**
 * Génère assets/auth.json à partir d'un identifiant et d'un mot de passe.
 *
 *   node scripts/set-credentials.mjs Sayshara Wakfu
 *
 * Le fichier ne contient jamais le mot de passe : seulement le sel, le nombre
 * d'itérations et la clé dérivée (PBKDF2-SHA256), que le navigateur recalcule
 * pour comparer. Changer les identifiants invalide les sessions ouvertes.
 *
 * ⚠ Rappel : un site statique ne peut pas garder un secret. Cette porte
 * dissuade, elle ne protège pas — les fichiers de media/ restent joignables
 * par leur URL directe.
 */

import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ITERATIONS = 310000;
const KEY_LENGTH = 32; // 256 bits
const OUT_FILE = fileURLToPath(new URL('../assets/auth.json', import.meta.url));

const [username, password, hint] = process.argv.slice(2);

if (!username || !password) {
  console.error('Usage : node scripts/set-credentials.mjs <identifiant> <mot-de-passe> ["mention affichée"]');
  process.exit(1);
}

/** Doit rester identique à la version navigateur (assets/auth.js). */
function material(user, pass) {
  return `${user.trim().toLowerCase().normalize('NFKC')}:${pass.normalize('NFKC')}`;
}

const salt = randomBytes(16);
const hash = pbkdf2Sync(material(username, password), salt, ITERATIONS, KEY_LENGTH, 'sha256');

const payload = {
  version: 1,
  algorithm: 'PBKDF2-SHA256',
  iterations: ITERATIONS,
  keyLength: KEY_LENGTH * 8,
  salt: salt.toString('base64'),
  hash: hash.toString('base64'),
  // Mention affichée sous le formulaire. Volontairement muette sur
  // l'identifiant : le fichier est public.
  hint: hint ?? 'Chroniques du Krosmoz · accès privé',
};

await writeFile(OUT_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');

console.log(`✓ assets/auth.json écrit pour « ${username.trim()} »`);
console.log(`  PBKDF2-SHA256 · ${ITERATIONS} itérations · sel de 16 octets`);
console.log('  Les sessions déjà ouvertes devront se reconnecter.');
