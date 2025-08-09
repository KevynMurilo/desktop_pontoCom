import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import axios from 'axios';

import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { getOrCreateMaster } from './security/keys.js';
import { encryptToFile } from './security/crypto-file.js';

import { fileURLToPath } from 'url';

import db from './db.js';
import { enviarRegistrosPendentes, enviarRegistrosPorIntervalo } from './sync.service.js';
import { getLocationByIP } from './geo.js';
import { obterMunicipioId, syncDadosRecebidosComProgresso } from './sync.receive.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SPRING_API_BASE_URL = 'https://backpontocerto.formosa.go.gov.br/api';

const app = express();

const PORT = process.env.APP_PORT || process.argv[2] || 8080;

const uploadDir = process.env.APP_UPLOADS_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true, mode: 0o700 });
  console.log(`📁 Pasta de uploads criada: ${uploadDir}`);
}

const storage = multer.memoryStorage();
const upload = multer({ storage });

app.use(helmet());
app.use(rateLimit({ windowMs: 60_000, max: 60 }));
app.use(cors()); 
app.use(express.json());

app.get('/api/status', (_, res) => res.send('OK'));
app.get('/api/health', (_, res) => res.send('OK'));

// Registro de ponto (salva imagem criptografada .enc)
app.post('/api/timerecord', upload.single('imagem'), async (req, res) => {
  try {
    const { cpf, deviceIdentifier } = req.body;
    if (!req.file || !cpf) {
      return res.status(400).json({ message: 'CPF e imagem são obrigatórios.' });
    }

    // 1) Funcionário ativo
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
      return res.status(403).json({ message: 'Seu cadastro foi desativado. Por favor, procure o administrador do sistema.' });
    }

    // 2) Localização (por IP)
    const { latitude, longitude } = await getLocationByIP();

    // 3) Converte para WEBP em memória
    const webpBuffer = await sharp(req.file.buffer).webp({ quality: 100 }).toBuffer();

    // 4) Criptografa e grava .enc
    const { key } = await getOrCreateMaster();
    const nomeArquivo = `${Date.now()}_${Math.random().toString(36).substring(2, 10)}.enc`;
    const caminhoImagem = path.join(uploadDir, nomeArquivo);
    await encryptToFile(key, webpBuffer, caminhoImagem);

    // 5) Salva registro no DB
    const agora = new Date();
    const offsetBrasiliaMs = -3 * 60 * 60 * 1000;
    const agoraBrasiliaISO = new Date(agora.getTime() + offsetBrasiliaMs).toISOString().split('.')[0];

    db.run(
      `INSERT INTO registros (cpf, imagemPath, latitude, longitude, deviceIdentifier, enviado, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      [cpf, caminhoImagem, latitude, longitude, deviceIdentifier, agoraBrasiliaISO],
      function (err) {
        if (err) {
          console.error('❌ Erro ao salvar no banco:', err?.message || err);
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

// Forçar sincronização manual
app.post('/api/forcar-sincronizacao', async (_req, res) => {
  try {
    await enviarRegistrosPendentes();
    res.send({ message: 'Sincronização manual concluída.' });
  } catch (err) {
    console.error('❌ Erro ao forçar sincronização:', err);
    res.status(500).send({ message: 'Erro ao sincronizar.', error: err.message });
  }
});

// Sincronização por intervalo
app.post('/api/forcar-sincronizacao-por-data', async (req, res) => {
  const { dataInicio, dataFim, incluirErros } = req.body;
  if (!dataInicio || !dataFim) {
    return res.status(400).json({ message: 'dataInicio e dataFim são obrigatórios.' });
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

// Sincronização de recebimento (com progresso)
app.post('/api/forcar-sincronizacao-recebimento', async (_req, res) => {
  try {
    const municipioId = await obterMunicipioId();
    const resultado = await syncDadosRecebidosComProgresso(municipioId, progresso => {
      if (process.send) {
        process.send({ tipo: 'progresso-sync-recebimento', payload: progresso });
      }
    });
    res.send({ message: 'Sincronização de recebimento concluída.', ...resultado });
  } catch (err) {
    console.error('❌ Erro ao forçar sincronização de recebimento:', err);
    res.status(500).send({ message: 'Erro na sincronização de recebimento.', error: err.message });
  }
});

// Aviso de pendência antiga
app.get('/api/registros-pendentes/aviso', (_req, res) => {
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
      res.json({ total: row?.total ?? 0 });
    }
  );
});

// Verificação de dispositivo
app.get('/api/device/verificar/:identifier', async (req, res) => {
  const { identifier } = req.params;
  try {
    const response = await axios.get(`${SPRING_API_BASE_URL}/device/identifier/${identifier}/vinculo`);
    if (response.data?.success) {
      res.json({ existe: true, device: response.data.data });
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

// Ouvir apenas em loopback (localhost)
app.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 Servidor local ouvindo em http://127.0.0.1:${PORT}`);
});
