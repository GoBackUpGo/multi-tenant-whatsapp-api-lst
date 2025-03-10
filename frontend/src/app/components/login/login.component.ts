// filepath: /src/app/components/login/login.component.ts
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { Router } from '@angular/router';
import { HttpClientModule } from '@angular/common/http';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-login',
  standalone: true, // تعريف المكون كـ Standalone
  imports: [FormsModule, HttpClientModule, RouterModule], // توفير الوحدات اللازمة
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent {
  username: string = '';
  password: string = '';
  errorMessage: string = '';

  constructor(private apiService: ApiService, private router: Router) {}

  login() {
    this.apiService.login(this.username, this.password).subscribe(
      (response) => {
        localStorage.setItem('token', response.token);
        localStorage.setItem('tenantId', response.tenantId); // Store tenantId in local storage
        localStorage.setItem('username', this.username); // Store username in local storage
        this.router.navigate(['/dashboard']);
      },
      (error) => {
        alert('Invalid username or password');
      }
    );
  }
}

