import { RegistroPontoViewModel } from './registro-ponto.viewmodel';

export class RegistroPontoCamera {
  constructor(private vm: RegistroPontoViewModel) { }

  async listarDispositivos() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    this.vm.dispositivosVideo = devices.filter(d => d.kind === 'videoinput');
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
      .catch(() => this.solicitarPermissaoECapturar());
  }

  solicitarPermissaoECapturar(): void {
    const video = document.getElementById('video') as HTMLVideoElement;
    if (!video) {
      setTimeout(() => this.solicitarPermissaoECapturar(), 100);
      return;
    }

    this.pararStreamAtual();
    this.vm.carregandoCamera.set(true);
    this.vm.videoElement = video;

    const constraints: MediaStreamConstraints = {
      video: {
        deviceId: this.vm.dispositivoSelecionadoId ? { exact: this.vm.dispositivoSelecionadoId } : undefined
      }
    };

    navigator.mediaDevices.getUserMedia(constraints)
      .then(stream => {
        this.vm.stream = stream;
        video.srcObject = stream;
        video.onloadedmetadata = () => {
          video.play();
          this.vm.carregandoCamera.set(false);
        };
      })
      .catch(err => {
        alert(`Erro ao acessar a câmera: ${err.message}`);
        this.vm.carregandoCamera.set(false);
      });
  }

  tirarFoto() {
    this.vm.mostrarFlash.set(true);
    setTimeout(() => {
      const audio = new Audio('assets/camera-shutter-roger.mp3');
      audio.play();

      const canvas = document.createElement('canvas');
      canvas.width = this.vm.videoElement.videoWidth;
      canvas.height = this.vm.videoElement.videoHeight;
      canvas.getContext('2d')?.drawImage(this.vm.videoElement, 0, 0);
      this.vm.imagemCapturada = canvas.toDataURL('image/jpeg');
      this.vm.fotoTirada.set(true);

      this.pararStreamAtual();
      setTimeout(() => this.vm.mostrarFlash.set(false), 150);
    }, 250);
  }

  repetirFoto() {
    this.reiniciarCamera();
  }

  reiniciarCamera() {
    this.vm.fotoTirada.set(false);
    this.vm.imagemCapturada = null;
    this.vm.carregandoCamera.set(true);
    setTimeout(() => {
      const video = document.getElementById('video');
      if (video) this.iniciarVideoComPermissao();
      else setTimeout(() => this.reiniciarCamera(), 100);
    }, 100);
  }

  pararStreamAtual() {
    if (this.vm.stream) {
      this.vm.stream.getTracks().forEach(track => track.stop());
      this.vm.stream = null!;
    }
    if (this.vm.videoElement) {
      this.vm.videoElement.pause();
      this.vm.videoElement.srcObject = null;
    }
  }
}
