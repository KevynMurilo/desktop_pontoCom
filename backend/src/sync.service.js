import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import db from './db.js';
import { fileURLToPath } from 'url';

const API_PREFEITURA = 'https://webhook-formosago.app.br/pontocom/api/timerecord';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🟡 sync.service.js carregado');

export async function enviarRegistrosPendentes() {
  const agora = new Date();
  const tentativasLimites = [
    0,                      // 1ª tentativa: imediatamente
    10 * 60 * 1000,         // 2ª: +10 minutos
    60 * 60 * 1000,         // 3ª: +1 hora
    3 * 60 * 60 * 1000,     // 4ª: +3 horas
    6 * 60 * 60 * 1000      // 5ª: +6 horas
  ];

  db.all(
    `SELECT * FROM registros 
     WHERE enviado = 0 
       AND erro_definitivo = 0 
       AND (tentativas IS NULL OR tentativas < 5)
     ORDER BY created_at ASC, type ASC`,
    async (err, registros) => {
      if (err) {
        console.error('❌ Erro ao buscar registros pendentes:', err.message);
        return;
      }

      if (!registros || registros.length === 0) {
        console.log('📭 Nenhum registro pendente para sincronizar.');
        return;
      }

      for (const registro of registros) {
        const tentativas = registro.tentativas ?? 0;
        const ultimaTentativa = registro.ultima_tentativa ? new Date(registro.ultima_tentativa) : null;
        const tempoDecorrido = ultimaTentativa ? agora - ultimaTentativa : Infinity;

        const limiteTempo = tentativasLimites[tentativas] ?? Infinity;
        if (tempoDecorrido < limiteTempo) {
          continue; 
        }

        console.log(`🔁 Tentando enviar registro ID ${registro.id} (${registro.type})`);

        try {
          if (!fs.existsSync(registro.imagemPath)) {
            console.warn(`⚠️ Imagem não encontrada para ID ${registro.id}: ${registro.imagemPath}`);
            marcarComoErroDefinitivo(registro.id, 'Imagem não encontrada localmente');
            continue;
          }

          const form = new FormData();
          form.append('cpf', registro.cpf);
          form.append('latitude', registro.latitude);
          form.append('longitude', registro.longitude);
          form.append('deviceIdentifier', registro.deviceIdentifier);
          form.append('imagem', fs.createReadStream(registro.imagemPath));
          form.append('received', registro.created_at);
          form.append('type', registro.type);

          const response = await axios.post(API_PREFEITURA, form, {
            headers: form.getHeaders()
          });

          if (response.status >= 200 && response.status < 300) {
            db.run('UPDATE registros SET enviado = 1 WHERE id = ?', [registro.id]);
            console.log(`✅ Registro ID ${registro.id} enviado com sucesso.`);
          } else {
            const mensagem = response.data?.message || response.statusText;
            console.error(`❌ Falha no envio do registro ID ${registro.id}. Status: ${response.status} - ${mensagem}`);
            tratarErroEnvio(registro.id, tentativas, response.status, mensagem);
          }

        } catch (e) {
          const status = e.response?.status;
          const mensagem = e.response?.data?.message || e.response?.statusText || e.message;

          if (e.response) {
            console.error(`❌ Erro ao enviar ID ${registro.id}: ${mensagem} (status: ${status})`);
            tratarErroEnvio(registro.id, tentativas, status, mensagem);
          } else {
            console.warn(`🌐 Backend indisponível ao enviar ID ${registro.id}: ${e.message}`);
          }
        }
      }
    }
  );
}

export async function enviarRegistrosPorIntervalo(dataInicio, dataFim, incluirErros = false) {
  const inicioISO = new Date(dataInicio).toISOString();
  const fimISO = new Date(dataFim).toISOString();

  const query = `
    SELECT * FROM registros 
     WHERE enviado = 0 
       ${incluirErros ? '' : 'AND erro_definitivo = 0'}
       AND created_at BETWEEN ? AND ?
     ORDER BY created_at ASC, type ASC`;

  db.all(query, [inicioISO, fimISO], async (err, registros) => {
    if (err) {
      console.error('❌ Erro ao buscar registros por intervalo:', err.message);
      return;
    }

    if (!registros || registros.length === 0) {
      console.log('📭 Nenhum registro pendente no intervalo.');
      return;
    }

    for (const registro of registros) {
      console.log(`🔁 [FORÇADO] Enviando registro ID ${registro.id} (${registro.type})`);

      try {
        if (!fs.existsSync(registro.imagemPath)) {
          console.warn(`⚠️ Imagem não encontrada para ID ${registro.id}: ${registro.imagemPath}`);
          marcarComoErroDefinitivo(registro.id, 'Imagem não encontrada localmente');
          continue;
        }

        const form = new FormData();
        form.append('cpf', registro.cpf);
        form.append('latitude', registro.latitude);
        form.append('longitude', registro.longitude);
        form.append('deviceIdentifier', registro.deviceIdentifier);
        form.append('imagem', fs.createReadStream(registro.imagemPath));
        form.append('received', registro.created_at);
        form.append('type', registro.type);

        const response = await axios.post(API_PREFEITURA, form, {
          headers: form.getHeaders()
        });

        if (response.status >= 200 && response.status < 300) {
          db.run('UPDATE registros SET enviado = 1 WHERE id = ?', [registro.id]);
          console.log(`✅ Registro ID ${registro.id} reenviado com sucesso.`);
        } else {
          const mensagem = response.data?.message || response.statusText;
          console.error(`❌ Falha no envio ID ${registro.id}: ${mensagem}`);
          tratarErroEnvio(registro.id, registro.tentativas ?? 0, response.status, mensagem);
        }

      } catch (e) {
        const status = e.response?.status;
        const mensagem = e.response?.data?.message || e.response?.statusText || e.message;

        if (e.response) {
          console.error(`❌ Erro ao reenviar ID ${registro.id}: ${mensagem}`);
          tratarErroEnvio(registro.id, registro.tentativas ?? 0, status, mensagem);
        } else {
          console.warn(`🌐 Backend indisponível ao reenviar ID ${registro.id}: ${e.message}`);
        }
      }
    }
  });
}

function tratarErroEnvio(id, tentativas, status, mensagem) {
  const agora = new Date().toISOString();
  const ERROS_PERMANENTES = [403, 404, 409];
  let erroDefinitivo = 0;

  if (ERROS_PERMANENTES.includes(status) || tentativas + 1 >= 5) {
    erroDefinitivo = 1;
    console.warn(`🚫 Erro definitivo para ID ${id} (status: ${status}): ${mensagem}`);
  }

  db.run(`
    UPDATE registros 
    SET 
      tentativas = COALESCE(tentativas, 0) + 1,
      ultima_tentativa = ?,
      erro_mensagem = ?,
      erro_definitivo = ?
    WHERE id = ?
  `, [agora, mensagem, erroDefinitivo, id]);
}

function marcarComoErroDefinitivo(id, mensagem) {
  const agora = new Date().toISOString();
  db.run(`
    UPDATE registros 
    SET 
      erro_definitivo = 1,
      erro_mensagem = ?,
      ultima_tentativa = ?
    WHERE id = ?
  `, [mensagem, agora, id]);
}

// ⏳ Execução automática
if (process.argv[1]?.endsWith('sync.service.js')) {
  console.log('⏳ Serviço de sincronização iniciado em modo automático (intervalo de 10s)');
  setInterval(() => {
    console.log('🔄 Executando sincronização automática...');
    enviarRegistrosPendentes();
  }, 10000);
}

/*
  ESTRATÉGIA FINAL

  - Registros são enviados em ordem cronológica crescente (e tipo INPUT antes de OUTPUT)
  - Sem travar usuário local (registro continua sendo salvo mesmo que backend esteja offline)
  - 'type' já vem do client, não precisa calcular no backend
  - Evita buracos de tempo ou registros invertidos
  - Evita flood com tentativas infinitas (limite de 3 + 24h)
  - Imagens faltando viram erro definitivo
*/
/*
  TENTATIVAS PROGRESSIVAS:
  1ª: imediato
  2ª: após 10min
  3ª: após 1h
  4ª: após 3h
  5ª: após 6h
  Depois disso: erro definitivo
*/