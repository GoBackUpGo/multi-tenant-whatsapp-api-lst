// filepath: /src/app/services/api.service.ts
import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ApiService {
  private baseUrl = 'http://localhost:4000';
  private http = inject(HttpClient);

  login(username: string, password: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/auth/login`, { username, password });
  }

  register(username: string, password: string, tenantName: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/auth/register`, { username, password, tenantName });
  }

  sendMessage(phoneNumber: string, message: string, tenantId: string): Observable<any> {
    const token = localStorage.getItem('token') || '';
    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
    return this.http.post(`${this.baseUrl}/messages/send`, { phoneNumber, message, tenantId }, { headers });
  }

  generateQRCode(tenantId: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/whatsapp/generate-qr/${tenantId}`);
  }

  scanQRCode(tenantId: string, qrCode: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/whatsapp/scan-qr`, { tenantId, qrCode });
  }

  adminLogin(username: string, password: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/admin/login`, { username, password });
  }

  getMonitoringData(token: string): Observable<any> {
    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
    return this.http.get(`${this.baseUrl}/monitor/clients`, { headers });
  }

  getNotifications(tenantId: string | null): Observable<any> {
    return this.http.get(`${this.baseUrl}/notifications/${tenantId}`);
  }

  markNotificationsAsRead(tenantId: string | null): Observable<any> {
    return this.http.post(`${this.baseUrl}/notifications/read/${tenantId}`, {});
  }

  getApiKey(): Observable<any> {
    const token = localStorage.getItem('token') || '';
    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
    return this.http.get(`${this.baseUrl}/tenant/api-key`, { headers });
  }

  sendMessageWithApiKey(phoneNumber: string, message: string, apiKey: string): Observable<any> {
    const token = localStorage.getItem('token') || '';
    const headers = new HttpHeaders({ 'x-api-key': apiKey, Authorization: `Bearer ${token}` });
    return this.http.post(`${this.baseUrl}/messages/send`, { phoneNumber, message }, { headers });
  }

  receiveMessagesWithApiKey(apiKey: string): Observable<any> {
    const headers = new HttpHeaders({ 'x-api-key': apiKey });
    return this.http.get(`${this.baseUrl}/messages/receive`, { headers });
  }

  // Add function to check WhatsApp status
  isWhatsAppReady(tenantId: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/whatsapp/is-ready/${tenantId}`);
  }
}
