import { Component, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RegistroPontoService } from './registro-ponto.service';
import { NgxMaskDirective, provideNgxMask } from 'ngx-mask';

@Component({
  selector: 'app-registro-ponto',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, NgxMaskDirective],
  templateUrl: './registro-ponto.component.html',
  providers: [RegistroPontoService, provideNgxMask()],
})
export class RegistroPontoComponent {
  private fb = inject(FormBuilder);
  private service = inject(RegistroPontoService);

  form = this.fb.group({
    cpf: ['', [Validators.required, Validators.pattern(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/)]],
  });

  fotoTirada = signal(false);
  fotoCapturada = computed(() => this.fotoTirada());

  imagemCapturada: string | null = null;
  videoElement!: HTMLVideoElement;
  stream!: MediaStream;
  deviceIdentifier = 'abc123';

  ngAfterViewInit() {
    this.solicitarPermissaoECapturar();
  }

  solicitarPermissaoECapturar() {
    this.videoElement = document.getElementById('video') as HTMLVideoElement;

    if (!navigator.mediaDevices?.getUserMedia) {
      alert('Este navegador não suporta acesso à câmera.');
      return;
    }

    navigator.permissions?.query({ name: 'camera' as PermissionName }).then((result) => {
      if (result.state === 'denied') {
        alert('Permissão de câmera negada.');
        return;
      }
      this.iniciarCamera();
    }).catch(() => {
      this.iniciarCamera();
    });
  }

  iniciarCamera() {
    navigator.mediaDevices.getUserMedia({ video: true })
      .then(stream => {
        this.stream = stream;
        this.videoElement.srcObject = stream;
        this.videoElement.play();
      })
      .catch(() => alert('Erro ao acessar a câmera.'));
  }

  tirarFoto() {
    const canvas = document.createElement('canvas');
    canvas.width = this.videoElement.videoWidth;
    canvas.height = this.videoElement.videoHeight;
    canvas.getContext('2d')?.drawImage(this.videoElement, 0, 0);
    this.imagemCapturada = canvas.toDataURL('image/jpeg');
    this.fotoTirada.set(true);

    // Para a câmera
    this.videoElement.srcObject = null;
    this.stream.getTracks().forEach(track => track.stop());
  }

  repetirFoto() {
    this.imagemCapturada = null;
    this.fotoTirada.set(false);
    setTimeout(() => this.solicitarPermissaoECapturar(), 0);
  }

  public async registrarPonto() {
    if (!this.form.valid || !this.imagemCapturada) return;

    const blob = await (await fetch(this.imagemCapturada)).blob();
    const file = new File([blob], 'foto.jpg', { type: 'image/jpeg' });

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.service.registrar({
          cpf: this.form.value.cpf!,
          imagem: file,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          deviceIdentifier: this.deviceIdentifier
        }).subscribe({
          next: () => alert('Ponto registrado com sucesso!'),
          error: err => alert(err?.error?.message || 'Erro ao registrar ponto')
        });
      },
      () => {
        alert("Erro ao obter localização. Ative o GPS.");
      }
    );
  }
}
