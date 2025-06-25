import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

import db from './db.js';
import { enviarRegistrosPendentes } from './sync.service.js';
import { getLocationByIP } from './geo.js';
import { definirTipoParaHoje } from './definirTipoParaHoje.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 8080;

app.use(cors());
app.use(express.json());

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.memoryStorage();
const upload = multer({ storage });

app.get('/api/status', (_, res) => res.send('OK'));

app.post('/api/timerecord', upload.single('imagem'), async (req, res) => {
  try {
    const { cpf, deviceIdentifier } = req.body;

    if (!req.file || !cpf) {
      return res.status(400).json({ message: 'CPF e imagem são obrigatórios.' });
    }

    const type = await definirTipoParaHoje(cpf);
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
      `INSERT INTO registros (cpf, imagemPath, latitude, longitude, deviceIdentifier, type, enviado, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      [cpf, caminhoImagem, latitude, longitude, deviceIdentifier, type, agoraBrasiliaISO],
      function (err) {
        if (err) {
          console.error('Erro ao salvar no banco:', err.message);
          return res.status(500).json({ message: 'Erro ao salvar localmente' });
        }
        res.json({ message: 'Registro salvo localmente', id: this.lastID, type });
      }
    );
  } catch (err) {
    console.error('❌ Erro no endpoint /api/timerecord:', err);
    res.status(500).json({ message: 'Erro interno no servidor' });
  }
});

app.post('/api/forcar-sincronizacao', async (req, res) => {
  try {
    await enviarRegistrosPendentes();
    res.send({ message: 'Sincronização manual concluída.' });
  } catch (err) {
    console.error('❌ Erro ao forçar sincronização:', err);
    res.status(500).send({ message: 'Erro ao sincronizar.', error: err.message });
  }
});

import { enviarRegistrosPorIntervalo } from './sync.service.js';

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

app.listen(PORT, () => {
  console.log(`Servidor local ouvindo em http://localhost:${PORT}`);
});
