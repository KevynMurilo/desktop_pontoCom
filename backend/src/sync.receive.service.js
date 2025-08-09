import axios from 'axios';
import db from './db.js';
import fs from 'fs';
import path from 'path';

// ⏱ timeout padrão p/ chamadas HTTP
const HTTP_TIMEOUT = 30_000;

const API_SYNC_URL = 'https://backpontocerto.formosa.go.gov.br/api/sync/municipality';
const DEVICE_API_URL = 'https://backpontocerto.formosa.go.gov.br/api/device/identifier';
const PAGE_SIZE = 50;

// ───────────────────────── Logs ─────────────────────────
const logsDir = process.env.APP_LOGS_DIR || path.join('.', 'logs');
if (!fs.existsSync(logsDir)) {
  try {
    fs.mkdirSync(logsDir, { recursive: true, mode: 0o700 });
  } catch (e) {
    // se falhar, continua com console padrão
  }
}
try {
  const logFile = fs.createWriteStream(path.join(logsDir, 'sync-receive.log'), { flags: 'a' });
  const errFile = fs.createWriteStream(path.join(logsDir, 'sync-receive-error.log'), { flags: 'a' });

  const origLog = console.log.bind(console);
  const origErr = console.error.bind(console);

  console.log = (...args) => {
    const msg = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
    try { logFile.write(msg); } catch {}
    origLog(...args);
  };

  console.error = (...args) => {
    const msg = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
    try { errFile.write(msg); } catch {}
    origErr(...args);
  };
} catch {
  // se não conseguir abrir arquivos, mantém console normal
}

// ───────────────────────── Helpers DB ─────────────────────────
function runInTransaction(fn) {
  db.exec('BEGIN');
  try {
    fn();
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    throw e;
  }
}

// ───────────────────────── Sync principal ─────────────────────────
export async function syncDadosRecebidosComProgresso(municipioId, onProgress = () => {}) {
  const since = await obterUltimaSync(municipioId);
  console.log(`📡 Iniciando sync de recebimento p/ município ${municipioId} desde ${since || 'início'}`);

  // cursores de página por tipo
  let page = { employees: 0, calendars: 0, vacations: 0, extras: 0 };
  let registrosSincronizados = 0;
  let totalRegistros = 0;
  let temMais = true;
  let maiorUpdatedAt = since || null;
  let totalCalculado = false;

  while (temMais) {
    console.log(`➡️ Buscando página: emp=${page.employees}, cal=${page.calendars}, fer=${page.vacations}, ext=${page.extras}`);

    const params = {
      employeePage: page.employees,
      calendarPage: page.calendars,
      vacationPage: page.vacations,
      extraPage: page.extras,
      size: PAGE_SIZE,
      lastSync: since
    };

    let payload;
    try {
      const response = await axios.get(`${API_SYNC_URL}/${municipioId}`, { params, timeout: HTTP_TIMEOUT });
      payload = response?.data?.data;
      if (!payload) {
        console.error('Resposta inválida da API de sync (sem .data.data)');
        break;
      }
    } catch (e) {
      console.error('Erro ao chamar API de sync:', e?.message || e);
      // sai do loop para não ficar preso
      break;
    }

    const employees = Array.isArray(payload.employees) ? payload.employees : [];
    const calendars = Array.isArray(payload.calendars) ? payload.calendars : [];
    const vacations = Array.isArray(payload.vacations) ? payload.vacations : [];
    const extraWorkPeriods = Array.isArray(payload.extraWorkPeriods) ? payload.extraWorkPeriods : [];

    const totalEmployees = payload.totalEmployees ?? 0;
    const totalCalendars = payload.totalCalendars ?? 0;
    const totalVacations = payload.totalVacations ?? 0;
    const totalExtraWork = payload.totalExtraWork ?? 0;

    console.log(`📥 Recebidos: ${employees.length} func, ${calendars.length} feriados, ${vacations.length} férias, ${extraWorkPeriods.length} extras`);

    const totalPagina = employees.length + calendars.length + vacations.length + extraWorkPeriods.length;
    registrosSincronizados += totalPagina;

    if (!totalCalculado) {
      totalRegistros = totalEmployees + totalCalendars + totalVacations + totalExtraWork;
      console.log(`📊 Total estimado a sincronizar: ${totalRegistros}`);
      totalCalculado = true;
    }

    // maior updatedAt desta página
    const todosUpdated = [
      ...employees.map(e => e.updatedAt),
      ...calendars.map(c => c.updatedAt),
      ...vacations.map(v => v.updatedAt),
      ...extraWorkPeriods.map(e => e.updatedAt)
    ].filter(d => typeof d === 'string' && d.length >= 10);

    const maxDate = todosUpdated.length ? todosUpdated.reduce((a, b) => (a > b ? a : b)) : null;
    if (maxDate && (!maiorUpdatedAt || maxDate > maiorUpdatedAt)) {
      maiorUpdatedAt = maxDate;
    }

    // grava tudo em uma transação por página
    try {
      runInTransaction(() => {
        salvarFuncionarios(employees);
        salvarCalendario(calendars);
        salvarFerias(vacations);
        salvarExtras(extraWorkPeriods);
      });
    } catch (e) {
      console.error('Erro salvando página no SQLite:', e?.message || e);
      // continua tentando próximas páginas, mas reporta progresso
    }

    console.log(`✅ Página processada. Progresso: ${registrosSincronizados}/${totalRegistros}`);

    // avança cursores
    if (payload.hasMoreEmployees) page.employees++;
    if (payload.hasMoreCalendars) page.calendars++;
    if (payload.hasMoreVacations) page.vacations++;
    if (payload.hasMoreExtraWork) page.extras++;

    temMais = !!(payload.hasMoreEmployees || payload.hasMoreCalendars || payload.hasMoreVacations || payload.hasMoreExtraWork);

    onProgress({ registrosSincronizados, totalRegistros });
  }

  if (maiorUpdatedAt) {
    try {
      console.log(`📌 Salvando data da última sync: ${maiorUpdatedAt}`);
      await salvarUltimaSync(municipioId, maiorUpdatedAt);
    } catch (e) {
      console.error('Erro ao salvar ultima sync:', e?.message || e);
    }
  }

  onProgress({ registrosSincronizados, totalRegistros });

  if (process.send) {
    process.send({ tipo: 'sync-recebimento-finalizado', payload: { finalizado: true } });
  }

  console.log(`🎉 Sync finalizada. Total de registros: ${registrosSincronizados}`);
  return { registrosSincronizados, totalRegistros };
}

// ───────────────────────── DB ops ─────────────────────────
function obterUltimaSync(municipioId) {
  return new Promise(resolve => {
    db.get(
      `SELECT ultimaSync FROM sincronizacao WHERE municipioId = ?`,
      [municipioId],
      (err, row) => {
        if (err || !row) return resolve(null);
        resolve(row.ultimaSync);
      }
    );
  });
}

function salvarUltimaSync(municipioId, data) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO sincronizacao (municipioId, ultimaSync)
       VALUES (?, ?)
       ON CONFLICT(municipioId) DO UPDATE SET ultimaSync = excluded.ultimaSync`,
      [municipioId, data],
      err => (err ? reject(err) : resolve())
    );
  });
}

function salvarFuncionarios(lista) {
  if (!lista.length) return;
  const sql = `
    INSERT INTO funcionarios (id, nome, taxId, pisPasep, tipo, ativo, deletedAt, updatedAt, setorId, workDays)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      nome = excluded.nome,
      taxId = excluded.taxId,
      pisPasep = excluded.pisPasep,
      tipo = excluded.tipo,
      ativo = excluded.ativo,
      deletedAt = excluded.deletedAt,
      updatedAt = excluded.updatedAt,
      setorId = excluded.setorId,
      workDays = excluded.workDays
  `;
  const stmt = db.prepare ? db.prepare(sql) : null; // caso queira usar prepare direto
  for (const f of lista) {
    const params = [
      f.id, f.name, f.taxId, f.pisPasep, f.type,
      f.active ? 1 : 0,
      f.deletedAt,
      f.updatedAt,
      f.sectorId,
      JSON.stringify(f.workDays || [])
    ];
    if (stmt) stmt.run(params); else db.run(sql, params);
  }
}

function salvarCalendario(lista) {
  if (!lista.length) return;
  const sql = `
    INSERT INTO calendario_municipal (id, data, tipo, escopo, descricao, hora_inicio, hora_fim, deletedAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      data = excluded.data,
      tipo = excluded.tipo,
      escopo = excluded.escopo,
      descricao = excluded.descricao,
      hora_inicio = excluded.hora_inicio,
      hora_fim = excluded.hora_fim,
      deletedAt = excluded.deletedAt,
      updatedAt = excluded.updatedAt
  `;
  const stmt = db.prepare ? db.prepare(sql) : null;
  for (const c of lista) {
    const params = [
      c.id, c.date, c.type, c.scope, c.description,
      c.startTime, c.endTime, c.deletedAt, c.updatedAt
    ];
    if (stmt) stmt.run(params); else db.run(sql, params);
  }
}

function salvarFerias(lista) {
  if (!lista.length) return;
  const sql = `
    INSERT INTO ferias (id, funcionarioId, data_inicio, data_fim, observacao, deletedAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      funcionarioId = excluded.funcionarioId,
      data_inicio = excluded.data_inicio,
      data_fim = excluded.data_fim,
      observacao = excluded.observacao,
      deletedAt = excluded.deletedAt,
      updatedAt = excluded.updatedAt
  `;
  const stmt = db.prepare ? db.prepare(sql) : null;
  for (const v of lista) {
    const params = [
      v.id, v.employeeId, v.startDate, v.endDate, v.note,
      v.deletedAt, v.updatedAt
    ];
    if (stmt) stmt.run(params); else db.run(sql, params);
  }
}

function salvarExtras(lista) {
  if (!lista.length) return;
  const sql = `
    INSERT INTO periodos_extras (id, descricao, data_inicio, data_fim, escopo, deletedAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      descricao = excluded.descricao,
      data_inicio = excluded.data_inicio,
      data_fim = excluded.data_fim,
      escopo = excluded.escopo,
      deletedAt = excluded.deletedAt,
      updatedAt = excluded.updatedAt
  `;
  const stmt = db.prepare ? db.prepare(sql) : null;
  for (const e of lista) {
    const params = [ e.id, e.description, e.startDate, e.endDate, e.scope, e.deletedAt, e.updatedAt ];
    if (stmt) stmt.run(params); else db.run(sql, params);
  }
}

// ───────────────────────── Descobrir município ─────────────────────────
export async function obterMunicipioId() {
  const deviceId = process.env.DEVICE_ID;
  if (!deviceId) {
    console.error('DEVICE_ID não definido');
    process.exit(1);
  }
  try {
    const { data } = await axios.get(`${DEVICE_API_URL}/${deviceId}/vinculo`, { timeout: HTTP_TIMEOUT });
    if (!data?.success || !data.data?.municipalityId) throw new Error('Sem municipalityId');
    return data.data.municipalityId;
  } catch (e) {
    console.error('Erro ao obter município do device:', e?.message || e);
    process.exit(1);
  }
}

// ───────────────────────── IPC com o processo pai ─────────────────────────
let emExecucao = false;

process.on('message', async msg => {
  if (msg?.tipo !== 'iniciar-sync') return;
  if (emExecucao) return;

  emExecucao = true;
  try {
    const municipioId = await obterMunicipioId();
    await syncDadosRecebidosComProgresso(municipioId, progresso => {
      if (process.send) {
        process.send({ tipo: 'progresso-sync-recebimento', payload: progresso });
      }
    });
  } finally {
    emExecucao = false;
  }
});
