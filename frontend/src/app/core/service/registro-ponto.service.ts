import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, from, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { RegistroPontoDTO } from '../model/registro.model';
import { DeviceResponseDTO } from '../model/device.model';

@Injectable()
export class RegistroPontoService {
  constructor(private http: HttpClient) { }

  private getBaseUrl$(): Observable<string> {
    return from(window.backendApi.getApiBaseUrl());
  }

  verificarStatus(): Observable<boolean> {
    return this.getBaseUrl$().pipe(
      switchMap(baseUrl =>
        this.http.get(`${baseUrl}/status`, { responseType: 'text' }).pipe(
          map(() => true),
          catchError(() => of(false))
        )
      )
    );
  }

  sincronizarRecebimento(): Observable<any> {
    return this.getBaseUrl$().pipe(
      switchMap(baseUrl =>
        this.http.post(`${baseUrl}/sync-receber/manual`, {})
      )
    );
  }

  registrar(data: RegistroPontoDTO): Observable<any> {
    const formData = new FormData();
    formData.append('cpf', data.cpf);
    formData.append('imagem', data.imagem);
    formData.append('deviceIdentifier', data.deviceIdentifier);

    return this.getBaseUrl$().pipe(
      switchMap(baseUrl =>
        this.http.post(`${baseUrl}/timerecord`, formData)
      )
    );
  }

  forcarSincronizacao(): Observable<any> {
    return this.getBaseUrl$().pipe(
      switchMap(baseUrl =>
        this.http.post(`${baseUrl}/forcar-sincronizacao`, {})
      )
    );
  }

  verificarPendentesAntigos(): Observable<number> {
    return this.getBaseUrl$().pipe(
      switchMap(baseUrl =>
        this.http.get<{ total: number }>(`${baseUrl}/registros-pendentes/aviso`).pipe(
          map(res => res.total),
          catchError(() => of(0))
        )
      )
    );
  }

  verificarDispositivo(identifier: string): Observable<DeviceResponseDTO | null> {
    return this.getBaseUrl$().pipe(
      switchMap(baseUrl =>
        this.http.get<{ existe: boolean; device: DeviceResponseDTO }>(`${baseUrl}/device/verificar/${identifier}`).pipe(
          map(res => res.existe ? res.device : null),
          catchError(() => of(null))
        )
      )
    );
  }

  verificarVinculoDispositivo(identifier: string): Observable<DeviceResponseDTO | null> {
    return this.verificarDispositivo(identifier);
  }
}
