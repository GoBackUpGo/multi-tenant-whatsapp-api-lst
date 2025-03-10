import { Component, OnInit } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AuthService } from '../auth/auth.service';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit {
  apiKey: string | null = null;

  constructor(private http: HttpClient, private authService: AuthService) {}

  ngOnInit(): void {
    this.getApiKey();
  }

  getApiKey(): void {
    const token = this.authService.getToken();
    const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);

    this.http.get<{ apiKey: string }>('http://localhost:4001/tenant/api-key', { headers })
      .subscribe(
        response => {
          this.apiKey = response.apiKey;
        },
        error => {
          console.error('Failed to retrieve API key:', error);
        }
      );
  }
}
