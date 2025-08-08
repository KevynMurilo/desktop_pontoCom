import axios from 'axios';
import db from './db.js';
import fs from 'fs';
import path from 'path';

const logsDir = process.env.APP_LOGS_DIR || path.join('.', 'logs');
const logFile = fs.createWriteStream(path.join(logsDir, 'sync-receive.log'), { flags: 'a' });
const errFile = fs.createWriteStream(path.join(logsDir, 'sync-receive-error.log'), { flags: 'a' });

console.log = (...args) => {
  const msg = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
  logFile.write(msg);
  process.stdout.write(msg);
};

console.error = (...args) => {
  const msg = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
  errFile.write(msg);
  process.stderr.write(msg);
};

const API_SYNC_URL = 'https://backpontocerto.formosa.go.gov.br/api/sync/municipality';
const DEVICE_API_URL = 'https://backpontocerto.formosa.go.gov.br/api/device/identifier';
const PAGE_SIZE = 50;

export async function syncDadosRecebidosComProgresso(municipioId, onProgress = () => {}) {
  const since = await obterUltimaSync(municipioId);
  console.log(`\u{1F4E1} Iniciando sync de recebimento para município ${municipioId} a partir de ${since || 'início dos tempos'}`);

  let page = { employees: 0, calendars: 0, vacations: 0, extras: 0 };
  let registrosSincronizados = 0;
  let totalRegistros = 0;
  let temMais = true;
  let maiorUpdatedAt = since;
  let totalCalculado = false;

  while (temMais) {
    console.log(`\u27A1\uFE0F Buscando página: emp=${page.employees}, cal=${page.calendars}, fer=${page.vacations}, ext=${page.extras}`);

    const params = {
      employeePage: page.employees,
      calendarPage: page.calendars,
      vacationPage: page.vacations,
      extraPage: page.extras,
      size: PAGE_SIZE,
      lastSync: since
    };

    const response = await axios.get(`${API_SYNC_URL}/${municipioId}`, { params });

    const {
      employees, calendars, vacations, extraWorkPeriods,
      totalEmployees, totalCalendars, totalVacations, totalExtraWork
    } = response.data.data;

    console.log(`\u{1F4E5} Recebidos: ${employees.length} funcionarios, ${calendars.length} feriados, ${vacations.length} férias, ${extraWorkPeriods.length} extras`);

    const totalPagina = employees.length + calendars.length + vacations.length + extraWorkPeriods.length;
    registrosSincronizados += totalPagina;

    if (!totalCalculado) {
      totalRegistros =
        (totalEmployees ?? 0) +
        (totalCalendars ?? 0) +
        (totalVacations ?? 0) +
        (totalExtraWork ?? 0);
      console.log(`\u{1F4CA} Total estimado a sincronizar: ${totalRegistros}`);
      totalCalculado = true;
    }

    const todosUpdated = [
      ...employees.map(e => e.updatedAt),
      ...calendars.map(c => c.updatedAt),
      ...vacations.map(v => v.updatedAt),
      ...extraWorkPeriods.map(e => e.updatedAt)
    ].filter(date => !!date && typeof date === 'string' && date.length >= 10);

    const maxDate = todosUpdated.length > 0
      ? todosUpdated.reduce((a, b) => (a > b ? a : b))
      : null;

    if (maxDate && (!maiorUpdatedAt || maxDate > maiorUpdatedAt)) {
      maiorUpdatedAt = maxDate;
    }

    await salvarFuncionarios(employees);
    await salvarCalendario(calendars);
    await salvarFerias(vacations);
    await salvarExtras(extraWorkPeriods);

    console.log(`\u2705 Página processada. Total sincronizado até agora: ${registrosSincronizados}/${totalRegistros}`);

    if (response.data.data.hasMoreEmployees) page.employees++;
    if (response.data.data.hasMoreCalendars) page.calendars++;
    if (response.data.data.hasMoreVacations) page.vacations++;
    if (response.data.data.hasMoreExtraWork) page.extras++;

    temMais =
      response.data.data.hasMoreEmployees ||
      response.data.data.hasMoreCalendars ||
      response.data.data.hasMoreVacations ||
      response.data.data.hasMoreExtraWork;

    onProgress({ registrosSincronizados, totalRegistros });
  }

  if (maiorUpdatedAt) {
    try {
      console.log(`\u{1F4CC} Salvando data da última sync: ${maiorUpdatedAt}`);
      await salvarUltimaSync(municipioId, maiorUpdatedAt);
    } catch (e) {
      console.error('Erro ao salvar ultima sync:', e);
    }
  }

  onProgress({ registrosSincronizados, totalRegistros });

  if (process.send) {
    process.send({
      tipo: 'sync-recebimento-finalizado',
      payload: { finalizado: true }
    });
  }

  console.log(`\u{1F389} Sync finalizada. Total de registros: ${registrosSincronizados}`);

  return { registrosSincronizados, totalRegistros };
}

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
      err => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

async function salvarFuncionarios(lista) {
  for (const f of lista) {
    db.run(`
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
    `, [
      f.id, f.name, f.taxId, f.pisPasep, f.type,
      f.active ? 1 : 0,
      f.deletedAt,
      f.updatedAt,
      f.sectorId,
      JSON.stringify(f.workDays || [])
    ]);
  }
}

async function salvarCalendario(lista) {
  for (const c of lista) {
    db.run(`
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
    `, [
      c.id, c.date, c.type, c.scope, c.description,
      c.startTime, c.endTime, c.deletedAt, c.updatedAt
    ]);
  }
}

async function salvarFerias(lista) {
  for (const v of lista) {
    db.run(`
      INSERT INTO ferias (id, funcionarioId, data_inicio, data_fim, observacao, deletedAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        funcionarioId = excluded.funcionarioId,
        data_inicio = excluded.data_inicio,
        data_fim = excluded.data_fim,
        observacao = excluded.observacao,
        deletedAt = excluded.deletedAt,
        updatedAt = excluded.updatedAt
    `, [
      v.id, v.employeeId, v.startDate, v.endDate, v.note,
      v.deletedAt, v.updatedAt
    ]);
  }
}

async function salvarExtras(lista) {
  for (const e of lista) {
    db.run(`
      INSERT INTO periodos_extras (id, descricao, data_inicio, data_fim, escopo, deletedAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        descricao = excluded.descricao,
        data_inicio = excluded.data_inicio,
        data_fim = excluded.data_fim,
        escopo = excluded.escopo,
        deletedAt = excluded.deletedAt,
        updatedAt = excluded.updatedAt
    `, [
      e.id, e.description, e.startDate, e.endDate,
      e.scope, e.deletedAt, e.updatedAt
    ]);
  }
}

export async function obterMunicipioId() {
  const deviceId = process.env.DEVICE_ID;
  if (!deviceId) process.exit(1);

  try {
    const { data } = await axios.get(`${DEVICE_API_URL}/${deviceId}/vinculo`);
    if (!data?.success || !data.data?.municipalityId) throw new Error();
    return data.data.municipalityId;
  } catch {
    process.exit(1);
  }
}

let emExecucao = false;

process.on('message', async msg => {
  if (msg?.tipo !== 'iniciar-sync') return;
  if (emExecucao) return;

  emExecucao = true;

  try {
    const municipioId = await obterMunicipioId();

    await syncDadosRecebidosComProgresso(municipioId, progresso => {
      if (process.send) {
        process.send({
          tipo: 'progresso-sync-recebimento',
          payload: progresso
        });
      }
    });
  } finally {
    emExecucao = false;
  }
});
