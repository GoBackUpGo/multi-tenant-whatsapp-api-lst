import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { Router, RouterModule } from '@angular/router';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [FormsModule, RouterModule],
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.css']
})
export class RegisterComponent {
  username: string = '';
  password: string = '';
  tenantName: string = ''; // Change tenantId to tenantName

  constructor(private apiService: ApiService, private router: Router) {}

  register() {
    this.apiService.register(this.username, this.password, this.tenantName).subscribe(
      (response) => {
        if (response.success) {
          this.router.navigate(['/login']);
        } else {
          alert('Registration failed: ' + response.message);
        }
      },
      (error) => {
        alert('Registration failed: ' + error.message);
      }
    );
  }
}
