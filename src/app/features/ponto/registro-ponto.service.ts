import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface RegistroPontoDTO {
  cpf: string;
  imagem: File;
  latitude: number;
  longitude: number;
  deviceIdentifier: string;
}

@Injectable()
export class RegistroPontoService {
  constructor(private http: HttpClient) {}

  registrar(data: RegistroPontoDTO): Observable<any> {
    const formData = new FormData();
    formData.append('cpf', data.cpf);
    formData.append('imagem', data.imagem);
    formData.append('latitude', data.latitude.toString());
    formData.append('longitude', data.longitude.toString());
    formData.append('deviceIdentifier', data.deviceIdentifier);

    var response = this.http.post('http://10.1.59.59:8080/api/timerecord', formData);
    console.log(response);
    return response;
  }
}
