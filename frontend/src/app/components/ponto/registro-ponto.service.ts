import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

export interface RegistroPontoDTO {
  cpf: string;
  imagem: File;
  deviceIdentifier: string;
}

@Injectable()
export class RegistroPontoService {
  private readonly baseUrl = 'http://localhost:8080/api';

  constructor(private http: HttpClient) { }

  verificarStatus(): Observable<boolean> {
    return this.http.get(`${this.baseUrl}/status`, { responseType: 'text' }).pipe(
      map(() => true),
      catchError(() => of(false))
    );
  }

  registrar(data: RegistroPontoDTO): Observable<any> {
    const formData = new FormData();
    formData.append('cpf', data.cpf);
    formData.append('imagem', data.imagem);
    formData.append('deviceIdentifier', data.deviceIdentifier);

    return this.http.post(`${this.baseUrl}/timerecord`, formData);
  }

  forcarSincronizacao(): Observable<any> {
    return this.http.post(`${this.baseUrl}/forcar-sincronizacao`, {});
  }

  verificarPendentesAntigos(): Observable<number> {
    return this.http.get<{ total: number }>(`${this.baseUrl}/registros-pendentes/aviso`).pipe(
      map(res => res.total),
      catchError(() => of(0))
    );
  }
}
