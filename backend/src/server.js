import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import axios from 'axios';

import { fileURLToPath } from 'url';

import db from './db.js';
import { enviarRegistrosPendentes, enviarRegistrosPorIntervalo } from './sync.service.js';
import { getLocationByIP } from './geo.js';
import { obterMunicipioId, syncDadosRecebidosComProgresso } from './sync.receive.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SPRING_API_BASE_URL = 'http://localhost:8082/api';

const app = express();

// ✅ Porta dinâmica via Electron ou fallback local
const PORT = process.env.APP_PORT || process.argv[2] || 8080;

// ✅ Caminho de uploads (em %APPDATA% ou local)
const uploadDir = process.env.APP_UPLOADS_DIR || path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadDir)) {
  try {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log(`📁 Pasta de uploads criada: ${uploadDir}`);
  } catch (err) {
    console.error(`❌ Erro ao criar diretório de uploads: ${uploadDir}`, err);
    process.exit(1);
  }
}

// ✅ Configura multer para armazenar em memória
const storage = multer.memoryStorage();
const upload = multer({ storage });

app.use(cors());
app.use(express.json());

app.get('/api/status', (_, res) => res.send('OK'));
app.get('/api/health', (_, res) => res.send('OK'));

// ✅ Registro de ponto
app.post('/api/timerecord', upload.single('imagem'), async (req, res) => {
  try {
    const { cpf, deviceIdentifier } = req.body;

    if (!req.file || !cpf) {
      return res.status(400).json({ message: 'CPF e imagem são obrigatórios.' });
    }

    // === 1. Busca funcionário ativo ===
    const funcionario = await new Promise((resolve, reject) => {
      db.get(`SELECT * FROM funcionarios WHERE taxId = ? AND deletedAt IS NULL`, [cpf], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });

    if (!funcionario) {
      return res.status(404).json({ message: 'Funcionário não encontrado neste dispositivo.' });
    }

    if (funcionario.deletedAt || funcionario.ativo !== 1) {
      return res.status(403).json({
        message: 'Seu cadastro foi desativado. Por favor, procure o administrador do sistema.'
      });
    }

    // === 2. Verifica se hoje é dia de trabalho ===
    const hoje = new Date();
    const diaSemana = hoje.getDay(); // 0 = domingo ... 6 = sábado
    const workDays = JSON.parse(funcionario.workDays || '[]');

    if (!workDays.includes(diaSemana)) {
      return res.status(403).json({ message: 'Hoje não é um dia de trabalho do funcionário.' });
    }

    // === 3. Verifica se há feriado ===
    const hojeISO = hoje.toISOString().split('T')[0];

    const feriado = await new Promise((resolve, reject) => {
      db.get(`
        SELECT * FROM calendario_municipal
        WHERE data = ? AND deletedAt IS NULL AND (
          escopo = 'MUNICIPAL'
          OR (escopo = 'DEPARTAMENTO' AND descricao = (
              SELECT departamento FROM setores WHERE id = ?
          ))
          OR (escopo = 'SETOR' AND descricao = (
              SELECT nome FROM setores WHERE id = ?
          ))
        )
      `, [hojeISO, funcionario.setorId, funcionario.setorId], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });

    if (feriado) {
      // === 4. Se há feriado, verifica se há período extra ===
      const extra = await new Promise((resolve, reject) => {
        db.get(`
          SELECT * FROM periodos_extras
          WHERE data_inicio <= ? AND data_fim >= ? AND deletedAt IS NULL AND (
            escopo = 'MUNICIPAL'
            OR (escopo = 'DEPARTAMENTO' AND descricao = (
                SELECT departamento FROM setores WHERE id = ?
            ))
            OR (escopo = 'SETOR' AND descricao = (
                SELECT nome FROM setores WHERE id = ?
            ))
          )
        `, [hojeISO, hojeISO, funcionario.setorId, funcionario.setorId], (err, row) => {
          if (err) return reject(err);
          resolve(row);
        });
      });

      if (!extra) {
        return res.status(403).json({ message: 'Hoje é feriado e não há período extra para permitir o ponto.' });
      }
    }

    // === 5. Salva imagem e ponto ===
    const { latitude, longitude } = await getLocationByIP();

    const nomeArquivo = `${Date.now()}_${Math.random().toString(36).substring(2, 10)}.webp`;
    const caminhoImagem = path.join(uploadDir, nomeArquivo);

    await sharp(req.file.buffer)
      .webp({ quality: 100 })
      .toFile(caminhoImagem);

    const agora = new Date();
    const offsetBrasiliaMs = -3 * 60 * 60 * 1000;
    const agoraBrasiliaISO = new Date(agora.getTime() + offsetBrasiliaMs).toISOString().split('.')[0];

    db.run(
      `INSERT INTO registros (cpf, imagemPath, latitude, longitude, deviceIdentifier, enviado, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      [cpf, caminhoImagem, latitude, longitude, deviceIdentifier, agoraBrasiliaISO],
      function (err) {
        if (err) {
          console.error('❌ Erro ao salvar no banco:', err.message);
          return res.status(500).json({ message: 'Erro ao salvar localmente' });
        }
        res.json({ message: 'Registro salvo localmente', id: this.lastID });
      }
    );
  } catch (err) {
    console.error('❌ Erro no endpoint /api/timerecord:', err);
    res.status(500).json({ message: 'Erro interno no servidor' });
  }
});

app.post('/api/sync-receber/manual', async (req, res) => {
  try {
    const municipioId = await obterMunicipioId(); // você já tem essa função
    const resultado = await syncDadosRecebidosComProgresso(municipioId, (progresso) => {
      // opcional: salvar progresso em algum lugar acessível via GET
    });

    res.json({ message: 'Sincronização concluída com sucesso.', ...resultado });
  } catch (err) {
    console.error('❌ Erro ao sincronizar manualmente:', err);
    res.status(500).json({ message: 'Erro ao sincronizar.', error: err.message });
  }
});


// ✅ Forçar sincronização manual
app.post('/api/forcar-sincronizacao', async (req, res) => {
  try {
    await enviarRegistrosPendentes();
    res.send({ message: 'Sincronização manual concluída.' });
  } catch (err) {
    console.error('❌ Erro ao forçar sincronização:', err);
    res.status(500).send({ message: 'Erro ao sincronizar.', error: err.message });
  }
});

// ✅ Sincronização por intervalo
app.post('/api/forcar-sincronizacao-por-data', async (req, res) => {
  const { dataInicio, dataFim, incluirErros } = req.body;

  if (!dataInicio || !dataFim) {
    return res.status(400).json({ message: 'dataInicio e dataFim são obrigatórios no corpo da requisição.' });
  }

  try {
    const flag = incluirErros === true || incluirErros === 'true';
    console.log(`📅 Forçando sincronização entre ${dataInicio} e ${dataFim} ${flag ? '(incluindo erros definitivos)' : ''}`);
    await enviarRegistrosPorIntervalo(dataInicio, dataFim, flag);
    res.send({ message: 'Sincronização manual por intervalo concluída.' });
  } catch (err) {
    console.error('❌ Erro ao forçar sincronização por intervalo:', err);
    res.status(500).send({ message: 'Erro ao sincronizar.', error: err.message });
  }
});

// ✅ Aviso de pendência antiga
app.get('/api/registros-pendentes/aviso', (req, res) => {
  const seisHorasAtras = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

  db.get(
    `SELECT COUNT(*) as total FROM registros 
     WHERE enviado = 0 AND erro_definitivo = 0 AND created_at <= ?`,
    [seisHorasAtras],
    (err, row) => {
      if (err) {
        console.error('❌ Erro ao buscar pendentes antigos:', err.message);
        return res.status(500).json({ message: 'Erro interno' });
      }
      res.json({ total: row.total });
    }
  );
});

// ✅ Verificação de dispositivo
app.get('/api/device/verificar/:identifier', async (req, res) => {
  const { identifier } = req.params;

  try {
    const response = await axios.get(`${SPRING_API_BASE_URL}/device/identifier/${identifier}/vinculo`);
    if (response.data?.success) {
      res.json({
        existe: true,
        device: response.data.data,
      });
    } else {
      res.status(404).json({ existe: false, message: 'Dispositivo não encontrado no servidor remoto.' });
    }
  } catch (err) {
    if (err.response?.status === 404) {
      return res.status(404).json({ existe: false, message: 'Dispositivo não encontrado.' });
    }

    console.error('❌ Erro ao verificar dispositivo remoto:', err);
    res.status(500).json({ message: 'Erro ao conectar com o servidor remoto.' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor local ouvindo em http://localhost:${PORT}`);
});
