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
      enviado INTEGER DEFAULT 0,
      tentativas INTEGER DEFAULT 0,
      ultima_tentativa TEXT,
      erro_definitivo INTEGER DEFAULT 0,
      erro_mensagem TEXT,
      created_at TEXT
    )
  `);

  // Tabela de funcionários
  db.run(`
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
    )
  `);

  // Tabela de feriados/calendário
  db.run(`
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
    )
  `);

  // Tabela de férias
  db.run(`
    CREATE TABLE IF NOT EXISTS ferias (
      id TEXT PRIMARY KEY,
      funcionarioId TEXT,
      data_inicio TEXT,
      data_fim TEXT,
      observacao TEXT,
      deletedAt TEXT,
      updatedAt TEXT
    )
  `);

  // Tabela de períodos extras
  db.run(`
    CREATE TABLE IF NOT EXISTS periodos_extras (
      id TEXT PRIMARY KEY,
      descricao TEXT,
      data_inicio TEXT,
      data_fim TEXT,
      escopo TEXT,
      deletedAt TEXT,
      updatedAt TEXT
    )
  `);

  // Tabela de controle da última sincronização
  db.run(`
    CREATE TABLE IF NOT EXISTS sincronizacao (
      municipioId TEXT PRIMARY KEY,
      ultimaSync TEXT
    )
  `);
});

export default db;
