import Database from 'better-sqlite3-multiple-ciphers';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getOrCreateMaster } from './security/keys.js'; // EXTENSÃO .js obrigatória

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Usa APP_DB_PATH (definido no main.js) ou fallback local
const dbPath = process.env.APP_DB_PATH || path.join(__dirname, 'registros.db');

// 🔒 Garante pasta com permissão restrita
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true, mode: 0o700 });
  console.log(`📁 Pasta do banco criada: ${dbDir}`);
}

// 🔑 Chave do keytar
const { key } = await getOrCreateMaster();

// Abre o DB e aplica SQLCipher
const db = new Database(dbPath);
db.pragma(`cipher = 'sqlcipher'`);
db.pragma(`legacy = 4`);
db.pragma(`key = "x'${key.toString('hex')}'"`);

// Valida abertura
try {
  db.pragma('user_version'); // força acesso
  console.log('✅ Banco SQLite com SQLCipher aberto com sucesso.');
} catch (e) {
  console.error('❌ Falha ao abrir o banco com a chave atual. Se o DB era plaintext, rode a migração.');
  throw e;
}

/* =========================================================================
   SHIM de compatibilidade (sqlite3 style) → db.get/db.all/db.run (callback)
   Mantém this.lastID no callback de db.run, como no sqlite3.
   ========================================================================= */
function _prep(sql) {
  return db.prepare(sql);
}

// db.get(sql, [params], cb)
db.get = (sql, params, cb) => {
  if (typeof params === 'function') { cb = params; params = []; }
  try {
    const row = _prep(sql).get(params || []);
    if (cb) cb(null, row);
    return row;
  } catch (e) {
    if (cb) cb(e);
    else throw e;
  }
};

// db.all(sql, [params], cb)
db.all = (sql, params, cb) => {
  if (typeof params === 'function') { cb = params; params = []; }
  try {
    const rows = _prep(sql).all(params || []);
    if (cb) cb(null, rows);
    return rows;
  } catch (e) {
    if (cb) cb(e);
    else throw e;
  }
};

// db.run(sql, [params], cb) — expõe this.lastID no callback
db.run = (sql, params, cb) => {
  if (typeof params === 'function') { cb = params; params = []; }
  try {
    const info = _prep(sql).run(params || []);
    if (cb) cb.call({ lastID: Number(info.lastInsertRowid ?? 0) }, null);
    return info;
  } catch (e) {
    if (cb) cb(e);
    else throw e;
  }
};

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS registros (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cpf TEXT NOT NULL,
    imagemPath TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    deviceIdentifier TEXT,
    enviado INTEGER DEFAULT 0,
    tentativas INTEGER DEFAULT 0,
    ultima_tentativa TEXT,
    erro_definitivo INTEGER DEFAULT 0,
    erro_mensagem TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS funcionarios (
    id TEXT PRIMARY KEY,
    nome TEXT,
    taxId TEXT,
    pisPasep TEXT,
    tipo TEXT,
    ativo INTEGER,
    deletedAt TEXT,
    updatedAt TEXT,
    setorId TEXT,
    workDays TEXT
  );

  CREATE TABLE IF NOT EXISTS calendario_municipal (
    id TEXT PRIMARY KEY,
    data TEXT,
    tipo TEXT,
    escopo TEXT,
    descricao TEXT,
    hora_inicio TEXT,
    hora_fim TEXT,
    deletedAt TEXT,
    updatedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS ferias (
    id TEXT PRIMARY KEY,
    funcionarioId TEXT,
    data_inicio TEXT,
    data_fim TEXT,
    observacao TEXT,
    deletedAt TEXT,
    updatedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS periodos_extras (
    id TEXT PRIMARY KEY,
    descricao TEXT,
    data_inicio TEXT,
    data_fim TEXT,
    escopo TEXT,
    deletedAt TEXT,
    updatedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS sincronizacao (
    municipioId TEXT PRIMARY KEY,
    ultimaSync TEXT
  );
`);

export default db;
