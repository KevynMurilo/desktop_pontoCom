import { Component, signal, computed, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RegistroPontoService } from './registro-ponto.service';
import { NgxMaskDirective, provideNgxMask } from 'ngx-mask';
import { ConfiguracoesComponent } from '../configuracoes/configuracoes.component';
import { interval } from 'rxjs';

@Component({
  selector: 'app-registro-ponto',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    NgxMaskDirective,
    ConfiguracoesComponent
  ],
  templateUrl: './registro-ponto.component.html',
  providers: [RegistroPontoService, provideNgxMask()]
})
export class RegistroPontoComponent {
  private fb = inject(FormBuilder);
  private service = inject(RegistroPontoService);

  form = this.fb.group({
    cpf: ['', [Validators.required, Validators.pattern(/^\d{11}$/)]]
  });

  carregandoCamera = signal(true);
  fotoTirada = signal(false);
  fotoCapturada = computed(() => this.fotoTirada());
  mostrarConfiguracoes = signal(false);

  statusOnline = signal(false);
  imagemCapturada: string | null = null;
  videoElement!: HTMLVideoElement;
  stream!: MediaStream;

  deviceIdentifier = (window as any).device?.getId?.() || 'desconhecido';
  dispositivosVideo: MediaDeviceInfo[] = [];
  dispositivoSelecionadoId: string | null = null;

  async ngAfterViewInit() {
    await this.listarDispositivos();

    const salvo = localStorage.getItem('cameraSelecionada');
    if (salvo && this.dispositivosVideo.some(d => d.deviceId === salvo)) {
      this.dispositivoSelecionadoId = salvo;
    } else if (this.dispositivosVideo.length > 0) {
      this.dispositivoSelecionadoId = this.dispositivosVideo[0].deviceId;
    }

    this.iniciarVideoComPermissao();
    this.verificarStatus();
    interval(10000).subscribe(() => this.verificarStatus());
  }

  verificarStatus() {
    this.service.verificarStatus().subscribe(online => this.statusOnline.set(online));
  }

  async listarDispositivos() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    this.dispositivosVideo = devices.filter(d => d.kind === 'videoinput');
  }

  iniciarVideoComPermissao() {
    navigator.permissions?.query({ name: 'camera' as PermissionName })
      .then((result) => {
        if (result.state === 'denied') {
          alert('Permissão de câmera negada.');
          return;
        }
        this.solicitarPermissaoECapturar();
      })
      .catch(() => {
        this.solicitarPermissaoECapturar();
      });
  }

  solicitarPermissaoECapturar() {
    requestAnimationFrame(() => {
      this.videoElement = document.getElementById('video') as HTMLVideoElement;
      if (!this.videoElement) {
        console.error('Elemento <video> não encontrado.');
        return;
      }

      this.carregandoCamera.set(true);

      const constraints: MediaStreamConstraints = {
        video: {
          deviceId: this.dispositivoSelecionadoId ? { exact: this.dispositivoSelecionadoId } : undefined
        }
      };

      navigator.mediaDevices.getUserMedia(constraints)
        .then(stream => {
          this.stream = stream;
          this.videoElement.srcObject = stream;
          this.videoElement.onloadedmetadata = () => {
            this.videoElement.play();
            this.carregandoCamera.set(false);
          };
        })
        .catch(err => {
          console.error('Erro ao acessar a câmera:', err);
          alert(`Erro ao acessar a câmera: ${err.name} - ${err.message}`);
          this.carregandoCamera.set(false);
        });
    });
  }

  tirarFoto() {
    const canvas = document.createElement('canvas');
    canvas.width = this.videoElement.videoWidth;
    canvas.height = this.videoElement.videoHeight;
    canvas.getContext('2d')?.drawImage(this.videoElement, 0, 0);
    this.imagemCapturada = canvas.toDataURL('image/jpeg');
    this.fotoTirada.set(true);
    this.videoElement.srcObject = null;
    this.stream.getTracks().forEach(track => track.stop());
  }

  repetirFoto() {
    this.imagemCapturada = null;
    this.fotoTirada.set(false);
    this.carregandoCamera.set(true);
    requestAnimationFrame(() => {
      this.solicitarPermissaoECapturar();
    });
  }

  registrarPonto = async () => {
    if (!this.form.valid || !this.imagemCapturada) return;

    const blob = await (await fetch(this.imagemCapturada)).blob();
    const file = new File([blob], 'foto.jpg', { type: 'image/jpeg' });

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const cpfLimpo = this.form.value.cpf!;
        this.service.registrar({
          cpf: cpfLimpo,
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
  };

  fecharModalConfiguracoes() {
    this.mostrarConfiguracoes.set(false);
  }

  onSelecionarDispositivo(deviceId: string) {
    this.dispositivoSelecionadoId = deviceId;
    localStorage.setItem('cameraSelecionada', deviceId);
    this.repetirFoto();
  }
}
