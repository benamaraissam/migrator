import { bootstrapApplication } from '@angular/platform-browser';
import { AppConfig } from './app/core/config/app-config';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

AppConfig.load()
  .then(() => bootstrapApplication(AppComponent, appConfig()))
  .catch((err) => console.error(err));
