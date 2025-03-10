import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../services/api.service';
import { Router } from '@angular/router';
import { HttpClientModule, HttpErrorResponse } from '@angular/common/http';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [FormsModule, HttpClientModule, CommonModule, RouterModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent {
  phoneNumber: string = '';
  message: string = '';
  tenantId: string | null = '';
  qrCode: string = '';
  qrCodeScanned: boolean = false;
  username: string | null = '';
  email: string | null = '';
  phone: string | null = '';
  apiKey: string | null = '';
  receivedMessages: any[] = [];
  whatsappStatus: string = 'disconnected'; // Add WhatsApp status

  constructor(private apiService: ApiService, private router: Router) {}

  ngOnInit(): void {
    this.tenantId = localStorage.getItem('tenantId');
    this.username = localStorage.getItem('username');
    this.email = localStorage.getItem('email');
    this.phone = localStorage.getItem('phone');
    this.getApiKey();
    this.checkWhatsAppStatus(); // Check WhatsApp status on init
    this.autoGenerateAndRefreshQRCode();
  }

  getApiKey() {
    const token = localStorage.getItem('token');
    if (!token) {
      alert('Authorization token is missing');
      this.router.navigate(['/login']);
      return;
    }

    console.log('Token:', token); // Log the token for debugging

    this.apiService.getApiKey().subscribe(
      (response) => {
        console.log('API Key response:', response); // Log the response for debugging
        this.apiKey = response.apiKey;
      },
      (error) => {
        console.error('Failed to retrieve API key:', error); // Log the error for debugging
        alert('Failed to retrieve API key');
        this.logout(); // Ensure user is logged out and redirected to login
      }
    );
  }

  checkWhatsAppStatus() {
    if (!this.tenantId) {
      return;
    }

    this.apiService.isWhatsAppReady(this.tenantId).subscribe(
      (response) => {
        this.whatsappStatus = response.isReady ? 'connected' : 'disconnected';
        if (this.whatsappStatus === 'disconnected') {
          this.generateQRCode();
        }
      },
      (error) => {
        console.error('Failed to check WhatsApp status:', error);
        this.whatsappStatus = 'disconnected'; // Ensure status is set to disconnected on error
      }
    );
  }

  sendMessage() {
    if (!this.apiKey) {
      alert('API key is missing');
      return;
    }

    this.apiService.sendMessageWithApiKey(this.phoneNumber, this.message, this.apiKey).subscribe(
      (response) => {
        console.log('Message sent response:', response); // Log the response for debugging
        if (response && response.message === 'Message sent successfully') {
          alert('Message sent successfully');
        } else {
          alert('Failed to send message');
        }
      },
      (error: HttpErrorResponse) => {
        console.error('Error sending message:', error); // Log the error for debugging
        alert('Failed to send message');
      }
    );
  }

  receiveMessages() {
    if (!this.apiKey) {
      alert('API key is missing');
      return;
    }

    this.apiService.receiveMessagesWithApiKey(this.apiKey).subscribe(
      (response) => {
        this.receivedMessages = response;
      },
      (error) => {
        alert('Failed to receive messages');
      }
    );
  }

  autoGenerateAndRefreshQRCode() {
    if (!this.tenantId) {
      return;
    }

    setInterval(() => {
      if (this.tenantId && !this.qrCodeScanned && this.whatsappStatus === 'disconnected') {
        this.generateQRCode();
      }
    }, 60000); // Refresh QR code every 60 seconds if not scanned and WhatsApp is disconnected
  }

  generateQRCode() {
    this.apiService.generateQRCode(this.tenantId!).subscribe(
      (response) => {
        if (response && response.qrCode) {
          this.qrCode = response.qrCode.startsWith('data:image/png;base64,') ? response.qrCode : `data:image/png;base64,${response.qrCode}`;
        } else {
          alert('Failed to generate QR code');
        }
      },
      (error) => {
        console.error('Failed to generate QR code:', error); // Log the error for debugging
        alert('Failed to generate QR code');
      }
    );
  }

  scanQRCode(qrCode: string) {
    if (!this.tenantId) {
      alert('Unauthorized access');
      return;
    }

    this.apiService.scanQRCode(this.tenantId, qrCode).subscribe(
      (response) => {
        this.qrCodeScanned = true;
        alert('QR code scanned successfully');
      },
      (error) => {
        alert('Failed to scan QR code');
      }
    );
  }

  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('tenantId');
    localStorage.removeItem('username');
    localStorage.removeItem('email');
    localStorage.removeItem('phone');
    this.router.navigate(['/login']);
  }
}
