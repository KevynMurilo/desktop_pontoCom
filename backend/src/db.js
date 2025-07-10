import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Usa APP_DB_PATH (definido no main.js) ou fallback local
const dbPath = process.env.APP_DB_PATH || path.join(__dirname, 'registros.db');

// Garante que a pasta do banco existe
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
  console.log(`📁 Pasta do banco criada: ${dbDir}`);
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Erro ao conectar ao SQLite:', err.message);
  } else {
    console.log('✅ Conectado ao banco SQLite local.');
  }
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS registros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cpf TEXT NOT NULL,
      imagemPath TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      deviceIdentifier TEXT,
      type TEXT,
      enviado INTEGER DEFAULT 0,
      tentativas INTEGER DEFAULT 0,
      ultima_tentativa TEXT,
      erro_definitivo INTEGER DEFAULT 0,
      erro_mensagem TEXT,
      created_at TEXT
    )
  `);
});

export default db;
