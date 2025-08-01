import axios from 'axios';
import db from './db.js';

const API_SYNC_URL = 'http://localhost:8082/api/sync/municipality';
const DEVICE_API_URL = 'http://localhost:8082/api/device/identifier';

const PAGE_SIZE = 50;

export async function syncDadosRecebidos(municipioId) {
    const since = await obterUltimaSync(municipioId);
    console.log(`🔄 Iniciando sincronização com backend (desde: ${since || 'INICIAL'})`);

    let page = {
        employees: 0,
        calendars: 0,
        vacations: 0,
        extras: 0
    };

    let temMais = true;
    let maiorUpdatedAt = since;

    while (temMais) {
        const response = await axios.get(`${API_SYNC_URL}/${municipioId}`, {
            params: {
                employeePage: page.employees,
                calendarPage: page.calendars,
                vacationPage: page.vacations,
                extraPage: page.extras,
                size: PAGE_SIZE,
                since
            }
        });

        const { employees, calendars, vacations, extraWorkPeriods } = response.data.data;

        await salvarFuncionarios(employees);
        await salvarCalendario(calendars);
        await salvarFerias(vacations);
        await salvarExtras(extraWorkPeriods);

        if (response.data.data.hasMoreEmployees) page.employees++;
        if (response.data.data.hasMoreCalendars) page.calendars++;
        if (response.data.data.hasMoreVacations) page.vacations++;
        if (response.data.data.hasMoreExtraWork) page.extras++;

        temMais =
            response.data.data.hasMoreEmployees ||
            response.data.data.hasMoreCalendars ||
            response.data.data.hasMoreVacations ||
            response.data.data.hasMoreExtraWork;

        const todos = [...employees, ...calendars, ...vacations, ...extraWorkPeriods];
        todos.forEach(e => {
            if (!maiorUpdatedAt || new Date(e.updatedAt) > new Date(maiorUpdatedAt)) {
                maiorUpdatedAt = e.updatedAt;
            }
        });
    }

    if (maiorUpdatedAt) {
        await salvarUltimaSync(municipioId, maiorUpdatedAt);
        console.log(`✅ Sincronização finalizada. Última sync: ${maiorUpdatedAt}`);
    }
}

// === Auxiliares de controle ===

function obterUltimaSync(municipioId) {
    return new Promise((resolve) => {
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
    db.run(
        `INSERT INTO sincronizacao (municipioId, ultimaSync) VALUES (?, ?)
         ON CONFLICT(municipioId) DO UPDATE SET ultimaSync = excluded.ultimaSync`,
        [municipioId, data]
    );
}

// === Salvar dados no SQLite ===

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

// === Identificação do dispositivo e execução programada ===

async function obterMunicipioId() {
    const deviceId = process.env.DEVICE_ID;
    if (!deviceId) {
        console.error('❌ DEVICE_ID não definido no ambiente');
        process.exit(1);
    }

    try {
        const { data } = await axios.get(`${DEVICE_API_URL}/${deviceId}/vinculo`);
        if (!data?.success || !data.data?.municipalityId) throw new Error('Resposta inválida');

        console.log('📡 Município vinculado:', data.data.municipalityName);
        return data.data.municipalityId;
    } catch (err) {
        console.error('❌ Erro ao obter município do dispositivo:', err.message);
        process.exit(1);
    }
}

if (process.argv[1]?.endsWith('sync.receive.service.js')) {
    obterMunicipioId().then(municipioId => {
        console.log('⏳ Serviço de sincronização de recebimento iniciado (a cada 1h)');
        setInterval(async () => {
            try {
                await syncDadosRecebidos(municipioId);
            } catch (err) {
                console.error('❌ Erro na sincronização de recebimento:', err.message);
            }
        }, 60 * 60 * 1000); // 1 hora

        syncDadosRecebidos(municipioId);
    });
}
