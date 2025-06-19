import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

export interface RegistroPontoDTO {
  cpf: string;
  imagem: File;
  latitude: number;
  longitude: number;
  deviceIdentifier: string;
}

@Injectable()
export class RegistroPontoService {
  private readonly baseUrl = 'http://10.1.59.59:8080/api';

  constructor(private http: HttpClient) {}

  verificarStatus(): Observable<boolean> {
    return this.http.get(`${this.baseUrl}/status`).pipe(
      map(() => true),
      catchError(() => of(false))
    );
  }

  registrar(data: RegistroPontoDTO): Observable<any> {
    const formData = new FormData();
    formData.append('cpf', data.cpf);
    formData.append('imagem', data.imagem);
    formData.append('latitude', data.latitude.toString());
    formData.append('longitude', data.longitude.toString());
    formData.append('deviceIdentifier', data.deviceIdentifier);

    return this.http.post(`${this.baseUrl}/timerecord`, formData);
  }
}
