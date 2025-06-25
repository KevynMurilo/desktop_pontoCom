import db from './db.js';

export async function definirTipoParaHoje(cpf) {
  return new Promise((resolve, reject) => {
    const hoje = new Date();
    const dataFormatada = hoje.toISOString().split('T')[0]; // yyyy-MM-dd

    db.get(`
      SELECT type FROM registros 
      WHERE cpf = ?
        AND substr(created_at, 1, 10) = ?
      ORDER BY created_at DESC 
      LIMIT 1
    `, [cpf, dataFormatada], (err, row) => {
      if (err) return reject(err);
      if (!row) return resolve('INPUT');
      resolve(row.type === 'INPUT' ? 'OUTPUT' : 'INPUT');
    });
  });
}
