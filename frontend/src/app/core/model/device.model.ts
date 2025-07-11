export interface DeviceResponseDTO {
  id: string;
  identifier: string;
  description: string;
  active: boolean;
  lastSync: string;
  sectorId: string;
  sectorName: string;
  municipalityId: string;
  municipalityName: string;
  departmentId: string;
  departmentName: string;
}
