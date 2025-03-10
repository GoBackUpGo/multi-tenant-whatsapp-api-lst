import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';

import { routes } from './app/routes'; // تعريف المسارات
console.log('Application bootstrapping started');

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes), // توفير التوجيه
    provideHttpClient(),   // توفير HttpClient
  ],
}).catch((err) => console.error(err));
