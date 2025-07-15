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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SPRING_API_BASE_URL = 'https://webhook-formosago.app.br/pontocom/api';

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
