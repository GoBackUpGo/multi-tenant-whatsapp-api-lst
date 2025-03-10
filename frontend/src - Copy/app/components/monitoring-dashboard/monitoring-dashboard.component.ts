import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common'; // Import CommonModule
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-monitoring-dashboard',
  standalone: true,
  imports: [FormsModule, CommonModule], // Include CommonModule
  templateUrl: './monitoring-dashboard.component.html',
  styleUrls: ['./monitoring-dashboard.component.css']
})
export class MonitoringDashboardComponent implements OnInit {
  tenantFilter: string = '';
  monitoringData: any;
  activeClients: any[] = []; // Define activeClients property
  disconnectedClients: any[] = []; // Define disconnectedClients property

  constructor(private apiService: ApiService) {}

  ngOnInit() {
    this.apiService.getMonitoringData('your-token-here').subscribe(data => {
      this.monitoringData = data;
      this.activeClients = data.activeClients;
      this.disconnectedClients = data.disconnectedClients;
    });
  }

  applyFilter() {
    // Implement the filter logic here
    console.log('Filter applied:', this.tenantFilter);
  }
}
